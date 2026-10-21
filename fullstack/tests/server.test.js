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
  const missing = await request('GET', '/.well-known/assetlinks.json');
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error, 'assetlinks_not_configured');

  const fingerprint = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0'))
    .join(':').toUpperCase();
  process.env.ANDROID_SHA256_FINGERPRINTS = fingerprint;
  try {
    const served = await request('GET', '/.well-known/assetlinks.json');
    assert.equal(served.status, 200);
    const statements = await served.json();
    assert.equal(statements[0].target.package_name, 'com.havs.ai');
    assert.deepEqual(statements[0].target.sha256_cert_fingerprints, [fingerprint]);
  } finally {
    delete process.env.ANDROID_SHA256_FINGERPRINTS;
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
});
