'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'havs-server-test-'));
process.env.HAVS_DATA_DIR = dataDir;
process.env.NODE_ENV = 'development';
process.env.ALLOW_DEV_OTP = 'true';
process.env.AI_PROVIDER = 'mock';

const { server, db } = require('../server');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
let base;

function makePdf(pageCount) {
  const objects = [];
  const pageIds = [];
  let next = 3;
  for (let i = 0; i < pageCount; i += 1) {
    pageIds.push(next);
    next += 2;
  }
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`;
  for (let i = 0; i < pageCount; i += 1) {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents ${contentId} 0 R >>`;
    objects[contentId] = '<< /Length 0 >>\nstream\n\nendstream';
  }
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

async function request(method, pathname, body, cookie, headers = {}) {
  const response = await fetch(base + pathname, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return response;
}

function setCookies(response) {
  return response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
}

function rawPost(pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers }
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function login(email) {
  const requested = await request('POST', '/api/auth/request-code', { email });
  assert.equal(requested.status, 200);
  const verified = await request('POST', '/api/auth/verify', { email, code: '123456' });
  assert.equal(verified.status, 200);
  return setCookies(verified)[0].split(';')[0];
}

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('dev OTP login sets HttpOnly SameSite session and rejects a wrong code', async () => {
  const requested = await request('POST', '/api/auth/request-code', { email: 'login@example.com' });
  assert.equal(requested.status, 200);
  assert.equal((await requested.json()).devCode, '123456');

  const wrong = await request('POST', '/api/auth/verify', { email: 'login@example.com', code: '000000' });
  assert.equal(wrong.status, 401);

  const verified = await request('POST', '/api/auth/verify', { email: 'login@example.com', code: '123456' });
  assert.equal(verified.status, 200);
  const cookie = setCookies(verified)[0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Secure/);

  const directDevOtp = await rawPost('/api/auth/verify', { email: 'direct-vps@example.com', code: '123456' }, {
    Host: '103-20-102-229.sslip.io',
    'X-Forwarded-Proto': 'https'
  });
  assert.equal(directDevOtp.status, 200);

  const directWrongOtp = await rawPost('/api/auth/verify', { email: 'direct-vps@example.com', code: '654321' }, {
    Host: '103-20-102-229.sslip.io',
    'X-Forwarded-Proto': 'https'
  });
  assert.equal(directWrongOtp.status, 401);
});

test('session cookie is Secure behind HTTPS and for a non-local host', async () => {
  await request('POST', '/api/auth/request-code', { email: 'proxy@example.com' });
  const proxied = await request('POST', '/api/auth/verify', { email: 'proxy@example.com', code: '123456' }, null, {
    'X-Forwarded-Proto': 'https'
  });
  assert.match(setCookies(proxied)[0], /Secure/);

  await request('POST', '/api/auth/request-code', { email: 'public@example.com' });
  const publicHost = await rawPost('/api/auth/verify', { email: 'public@example.com', code: '123456' }, {
    Host: 'havs.example.com'
  });
  assert.match(String(publicHost.headers['set-cookie'][0]), /Secure/);
});

test('session cookie is not Secure when nginx reports plain HTTP', async () => {
  await request('POST', '/api/auth/request-code', { email: 'plain-http@example.com' });
  const verified = await rawPost('/api/auth/verify', { email: 'plain-http@example.com', code: '123456' }, {
    Host: 'havs.example.com',
    'X-Forwarded-Proto': 'http'
  });
  assert.doesNotMatch(String(verified.headers['set-cookie'][0]), /Secure/);
});

test('a non-local host refuses OTP without a mailer and does not log the code', async () => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  try {
    const response = await rawPost('/api/auth/request-code', { email: 'remote@example.com' }, {
      Host: 'havs.example.com'
    });
    assert.equal(response.status, 503);
    assert.equal(JSON.parse(response.text).error, 'email_not_configured');
    assert.equal(lines.some((line) => line.includes('remote@example.com')), false);
  } finally {
    console.log = original;
  }
});

test('assetlinks is only served when a valid signing fingerprint is configured', async () => {
  const prevFingerprints = process.env.ANDROID_SHA256_FINGERPRINTS;
  const prevPackage = process.env.ANDROID_PACKAGE_NAME;
  delete process.env.ANDROID_SHA256_FINGERPRINTS;
  delete process.env.ANDROID_PACKAGE_NAME;
  try {
    const missing = await request('GET', '/.well-known/assetlinks.json');
    assert.equal(missing.status, 503);
    assert.equal((await missing.json()).error, 'assetlinks_not_configured');

    const fingerprint = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0'))
      .join(':').toUpperCase();
    process.env.ANDROID_SHA256_FINGERPRINTS = fingerprint;
    const served = await request('GET', '/.well-known/assetlinks.json');
    assert.equal(served.status, 200);
    const statements = await served.json();
    assert.equal(statements[0].target.package_name, 'com.havs.ai');
    assert.deepEqual(statements[0].target.sha256_cert_fingerprints, [fingerprint]);
  } finally {
    if (prevFingerprints === undefined) delete process.env.ANDROID_SHA256_FINGERPRINTS;
    else process.env.ANDROID_SHA256_FINGERPRINTS = prevFingerprints;
    if (prevPackage === undefined) delete process.env.ANDROID_PACKAGE_NAME;
    else process.env.ANDROID_PACKAGE_NAME = prevPackage;
  }
});

test('upload rejects missing session, unsupported types, empty data and broken PDFs', async () => {
  const cookie = await login('uploader@example.com');

  const anonymous = await request('POST', '/api/uploads', { filename: 'a.png', mime: 'image/png', dataBase64: PNG });
  assert.equal(anonymous.status, 401);

  const unsupported = await request('POST', '/api/uploads', { filename: 'a.gif', mime: 'image/gif', dataBase64: PNG }, cookie);
  assert.equal(unsupported.status, 400);
  assert.equal((await unsupported.json()).error, 'unsupported_type');

  const empty = await request('POST', '/api/uploads', { filename: 'a.png', mime: 'image/png', dataBase64: '' }, cookie);
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error, 'invalid_size');

  const brokenPdf = await request('POST', '/api/uploads', {
    filename: 'broken.pdf', mime: 'application/pdf',
    dataBase64: Buffer.from('this is not a pdf').toString('base64')
  }, cookie);
  assert.equal(brokenPdf.status, 400);
  assert.equal((await brokenPdf.json()).error, 'pdf_parse_failed');
});

test('upload serves files only to their owner', async () => {
  const owner = await login('owner@example.com');
  const uploaded = await request('POST', '/api/uploads', {
    filename: 'pixel.png', mime: 'image/png', dataBase64: PNG
  }, owner);
  assert.equal(uploaded.status, 200);
  const body = await uploaded.json();
  assert.equal(body.pageCount, null);

  assert.equal((await request('GET', body.url)).status, 401);
  assert.equal((await request('GET', body.url, null, owner)).status, 200);
  const stranger = await login('stranger@example.com');
  assert.equal((await request('GET', body.url, null, stranger)).status, 404);
});

test('PDF uploads report page counts and enforce the page limit', async () => {
  const cookie = await login('pdf@example.com');

  const single = await request('POST', '/api/uploads', {
    filename: 'one.pdf', mime: 'application/pdf', dataBase64: makePdf(1).toString('base64')
  }, cookie);
  assert.equal(single.status, 200);
  assert.equal((await single.json()).pageCount, 1);

  const tooMany = await request('POST', '/api/uploads', {
    filename: 'many.pdf', mime: 'application/pdf', dataBase64: makePdf(51).toString('base64')
  }, cookie);
  assert.equal(tooMany.status, 400);
  const tooManyBody = await tooMany.json();
  assert.equal(tooManyBody.error, 'pdf_too_many_pages');
  assert.equal(tooManyBody.pages, 51);
  assert.equal(tooManyBody.max, 50);
});

test('creating an exam prep from an upload stores the material reference', async () => {
  const cookie = await login('wizard@example.com');
  const uploaded = await request('POST', '/api/uploads', {
    filename: 'material.pdf', mime: 'application/pdf', dataBase64: makePdf(1).toString('base64')
  }, cookie);
  const upload = await uploaded.json();

  const created = await request('POST', '/api/preps', {
    title: 'De tu tai lieu', subject: 'math', uploadId: upload.id, source: 'upload'
  }, cookie);
  assert.equal(created.status, 200);
  const prepId = (await created.json()).id;
  const row = db.prepare('SELECT material_upload_id, source FROM preps WHERE id = ?').get(prepId);
  assert.equal(row.material_upload_id, upload.id);
  assert.equal(row.source, 'upload');
});

test('exam prep generation falls back to a local plan when the AI provider is mock', async () => {
  const cookie = await login('planner@example.com');
  const created = await request('POST', '/api/preps', {
    title: 'De khong tai lieu', subject: 'math'
  }, cookie);
  const prepId = (await created.json()).id;

  const generated = await request('POST', `/api/preps/${prepId}/generate`, {}, cookie);
  assert.equal(generated.status, 200);
  const body = await generated.json();
  assert.ok(Array.isArray(body.plan.days));
  assert.ok(body.plan.days.length > 0);
  assert.equal(body.plan.generatedBy, 'fallback');
});

test('uploads accept files above 8MB and reject above the configured cap', async () => {
  const cookie = await login('bigfile@example.com');
  const accepted = await request('POST', '/api/uploads', {
    filename: 'big.png', mime: 'image/png', dataBase64: Buffer.alloc(9 * 1024 * 1024, 7).toString('base64')
  }, cookie);
  assert.equal(accepted.status, 200);

  const rejected = await request('POST', '/api/uploads', {
    filename: 'huge.png', mime: 'image/png', dataBase64: Buffer.alloc(21 * 1024 * 1024, 7).toString('base64')
  }, cookie);
  assert.equal(rejected.status, 400);
  const body = await rejected.json();
  assert.equal(body.error, 'invalid_size');
  assert.equal(body.max, 20);
});

test('prep detail exposes the attached material', async () => {
  const cookie = await login('material@example.com');
  const uploaded = await request('POST', '/api/uploads', {
    filename: 'de-thi.pdf', mime: 'application/pdf', dataBase64: makePdf(1).toString('base64')
  }, cookie);
  const upload = await uploaded.json();
  const created = await request('POST', '/api/preps', {
    title: 'Co tai lieu', subject: 'math', uploadId: upload.id
  }, cookie);
  const prepId = (await created.json()).id;
  const detail = await request('GET', `/api/exam-preps/${prepId}`, null, cookie);
  assert.equal(detail.status, 200);
  const { prep } = await detail.json();
  assert.equal(prep.material.filename, 'de-thi.pdf');
  assert.equal(prep.material.pages, 1);
});

test('an existing prep can be given a material before regenerating', async () => {
  const cookie = await login('attach@example.com');
  const uploaded = await request('POST', '/api/uploads', {
    filename: 'bo-sung.pdf', mime: 'application/pdf', dataBase64: makePdf(1).toString('base64')
  }, cookie);
  const upload = await uploaded.json();
  const created = await request('POST', '/api/preps', { title: 'Chua co tai lieu', subject: 'math' }, cookie);
  const prepId = (await created.json()).id;

  const attached = await request('POST', `/api/exam-preps/${prepId}/material`, { uploadId: upload.id }, cookie);
  assert.equal(attached.status, 200);
  assert.equal((await attached.json()).material.filename, 'bo-sung.pdf');

  const detail = await request('GET', `/api/exam-preps/${prepId}`, null, cookie);
  const { prep } = await detail.json();
  assert.equal(prep.material.id, upload.id);

  const invalid = await request('POST', `/api/exam-preps/${prepId}/material`, { uploadId: 'missing' }, cookie);
  assert.equal(invalid.status, 400);
});

test('AI plans become lessons with sections, a worked example and practice', async () => {
  const cookie = await login('lessons@example.com');
  const created = await request('POST', '/api/preps', { title: 'On tap ham so', subject: 'math' }, cookie);
  const prepId = (await created.json()).id;
  const plan = {
    version: 2,
    title: 'On tap ham so',
    subject: 'math',
    examDate: '2026-11-08',
    summary: 'Tom tat noi dung',
    topics: ['Ham bac hai', 'Do thi'],
    days: [{
      day: 1,
      focus: 'Ham bac hai',
      topics: ['Dinh nghia', 'Do thi'],
      tasks: ['Doc lai dinh nghia', 'Ve do thi'],
      lesson: {
        intro: 'Hom nay on lai dinh nghia ham bac hai.',
        sections: [{ heading: 'Dinh nghia', body: 'Ham so y = ax^2 + bx + c voi a khac 0.' }],
        example: { problem: 'Tim dinh cua (P)', steps: ['Tinh x = -b/2a'], answer: 'x = 1' }
      },
      practice: [{ question: 'Tim dinh cua y = x^2 - 2x', answer: 'x = 1' }]
    }],
    practice: [{ question: 'Tom tat dinh nghia', answer: 'Xem bai hoc.' }],
    tips: ['Hoc deu moi ngay']
  };
  db.prepare('UPDATE preps SET plan_json = ? WHERE id = ?').run(JSON.stringify(plan), prepId);

  const detail = await request('GET', `/api/exam-preps/${prepId}`, null, cookie);
  assert.equal(detail.status, 200);
  const { prep } = await detail.json();
  assert.equal(prep.lessons.length, 1);
  const lesson = prep.lessons[0];
  assert.equal(lesson.intro, 'Hom nay on lai dinh nghia ham bac hai.');
  assert.equal(lesson.sections.length, 1);
  assert.match(lesson.sections[0].body, /ax\^2/);
  assert.equal(lesson.example.answer, 'x = 1');
  assert.equal(lesson.practice[0].question, 'Tim dinh cua y = x^2 - 2x');
  assert.match(lesson.content, /Dinh nghia:/);
  assert.deepEqual(prep.plan.topics, ['Ham bac hai', 'Do thi']);
});

test('regenerating a prep keeps completed lessons marked', async () => {
  const cookie = await login('progress@example.com');
  const created = await request('POST', '/api/preps', { title: 'Giu tien do', subject: 'math' }, cookie);
  const prepId = (await created.json()).id;
  await request('POST', `/api/preps/${prepId}/generate`, {}, cookie);

  const completed = await request('POST', `/api/exam-preps/${prepId}/lessons/lesson-1/complete`, {}, cookie);
  assert.equal(completed.status, 200);

  const regenerated = await request('POST', `/api/exam-preps/${prepId}/generate`, {}, cookie);
  assert.equal(regenerated.status, 200);
  const { prep } = await regenerated.json();
  assert.equal(prep.lessons[0].done, true);
});

test('users can create, rename, and delete their own chats while isolating other users', async () => {
  const owner = await login('chat-owner@example.com');
  const other = await login('chat-other@example.com');

  const created = await request('POST', '/api/chats', { title: 'Hàm số bậc 2', subject: 'math' }, owner);
  assert.equal(created.status, 200);
  const { id: chatId } = await created.json();
  assert.ok(chatId);

  const forbiddenPatch = await request('PATCH', `/api/chats/${chatId}`, { title: 'Hack' }, other);
  assert.equal(forbiddenPatch.status, 404);

  const renamed = await request('PATCH', `/api/chats/${chatId}`, { title: 'Đạo hàm & Cực trị', subject: 'physics' }, owner);
  assert.equal(renamed.status, 200);
  const renamedBody = await renamed.json();
  assert.equal(renamedBody.chat.title, 'Đạo hàm & Cực trị');
  assert.equal(renamedBody.chat.subject, 'physics');

  const forbiddenDelete = await request('DELETE', `/api/chats/${chatId}`, null, other);
  assert.equal(forbiddenDelete.status, 404);

  const deleted = await request('DELETE', `/api/chats/${chatId}`, null, owner);
  assert.equal(deleted.status, 200);

  const afterDelete = await request('GET', `/api/chats/${chatId}/messages`, null, owner);
  assert.equal(afterDelete.status, 404);
});

test('multiple devices for the same user can connect concurrently and receive realtime broadcasts', async () => {
  const email = 'multidevice@example.com';
  const deviceAndroid = await login(email);
  const deviceDesktop = await login(email);
  assert.notEqual(deviceAndroid, deviceDesktop);

  const [sessionA, sessionB, healthRes] = await Promise.all([
    request('GET', '/api/auth/session', null, deviceAndroid),
    request('GET', '/api/auth/session', null, deviceDesktop),
    request('GET', '/api/health')
  ]);
  assert.equal((await sessionA.json()).authenticated, true);
  assert.equal((await sessionB.json()).authenticated, true);
  const health = await healthRes.json();
  assert.equal(health.ok, true);
  assert.equal(health.multiDevice, true);

  const created = await request('POST', '/api/chats', { title: 'Đồng bộ PC & Mobile', subject: 'math' }, deviceDesktop);
  const { id: chatId } = await created.json();
  const listOnAndroid = await request('GET', '/api/chats', null, deviceAndroid);
  const chats = (await listOnAndroid.json()).chats;
  assert.ok(chats.some((c) => c.id === chatId && c.title === 'Đồng bộ PC & Mobile'));

  const voicesRes = await request('GET', '/api/voices', null, deviceDesktop);
  assert.equal(voicesRes.status, 200);
  const { voices } = await voicesRes.json();
  assert.ok(voices.length >= 4);
  assert.ok(voices.every((v) => v.locale === 'vi-VN'), 'all default voices must be Vietnamese (vi-VN)');
});
