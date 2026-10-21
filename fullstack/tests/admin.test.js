'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'havs-admin-test-'));
process.env.HAVS_DATA_DIR = dataDir;
process.env.NODE_ENV = 'development';
process.env.ALLOW_DEV_OTP = 'true';
process.env.AI_PROVIDER = 'mock';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'admin';
process.env.SETTINGS_KEY = 'havs-admin-test-settings-key';

const { server, db } = require('../server');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
let base;
let adminCookie = '';
let csrf = '';

function cookiesOf(response) {
  return response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
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

async function adminRequest(method, pathname, body, options = {}) {
  const headers = {};
  if (adminCookie) headers.Cookie = adminCookie;
  if (csrf && method !== 'GET' && !options.skipCsrf) headers['X-CSRF-Token'] = csrf;
  return request(method, pathname, body, null, headers);
}

async function adminLogin() {
  const response = await request('POST', '/api/admin/login', { username: 'admin', password: 'admin' });
  assert.equal(response.status, 200);
  const body = await response.json();
  adminCookie = cookiesOf(response)[0].split(';')[0];
  csrf = body.csrf;
  assert.ok(csrf);
  return body;
}

async function loginUser(email) {
  const requested = await request('POST', '/api/auth/request-code', { email });
  assert.equal(requested.status, 200);
  const verified = await request('POST', '/api/auth/verify', { email, code: '123456' });
  assert.equal(verified.status, 200);
  const body = await verified.json();
  return { cookie: cookiesOf(verified)[0].split(';')[0], userId: body.user.id, profile: body.profile };
}

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await adminLogin();
  assert.equal(login.mustChangePassword, true);
  const changed = await adminRequest('POST', '/api/admin/password', {
    currentPassword: 'admin',
    newPassword: 'admin123'
  });
  assert.equal(changed.status, 200);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test('serves the admin page and a dynamic theme stylesheet', async () => {
  const page = await request('GET', '/admin');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /admin-root/);

  const css = await request('GET', '/theme.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  assert.match(await css.text(), /--accent:#ea580c/);
});

test('admin APIs require a session and mutations require CSRF', async () => {
  const anonymous = await request('GET', '/api/admin/overview');
  assert.equal(anonymous.status, 401);

  const withoutCsrf = await adminRequest('PUT', '/api/admin/appearance', { palette: { dark: {}, light: {} } }, { skipCsrf: true });
  assert.equal(withoutCsrf.status, 403);

  const session = await adminRequest('GET', '/api/admin/session');
  assert.equal(session.status, 200);
  const body = await session.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.username, 'admin');
  assert.ok(body.csrf);
});

test('appearance changes are served by /theme.css and can be reset', async () => {
  const current = await (await adminRequest('GET', '/api/admin/appearance')).json();
  const palette = JSON.parse(JSON.stringify(current.palette));
  palette.dark.accent = '#112233';
  palette.light.accent = '#445566';

  const saved = await adminRequest('PUT', '/api/admin/appearance', { palette });
  assert.equal(saved.status, 200);

  const css = await (await request('GET', '/theme.css')).text();
  assert.match(css, /--accent:#112233/);
  assert.match(css, /--accent:#445566/);

  const reset = await adminRequest('POST', '/api/admin/appearance/reset');
  assert.equal(reset.status, 200);
  assert.match(await (await request('GET', '/theme.css')).text(), /--accent:#ea580c/);
});

test('AI providers are masked, active, and deletable', async () => {
  const created = await adminRequest('POST', '/api/admin/ai/providers', {
    name: 'Test provider',
    kind: 'chat',
    provider: 'openai-compatible',
    baseUrl: 'https://example.invalid/v1',
    model: 'test-model',
    apiKey: 'sk-test-secret',
    isDefault: true,
    enabled: true
  });
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  assert.ok(createdBody.provider.id);
  assert.match(createdBody.provider.keyHint, /cret$/);

  const list = await adminRequest('GET', '/api/admin/ai/providers');
  assert.equal(list.status, 200);
  const listBody = await list.json();
  const serialized = JSON.stringify(listBody);
  assert.equal(serialized.includes('sk-test-secret'), false);
  assert.equal(listBody.items[0].hasKey, true);

  const health = await (await request('GET', '/api/health')).json();
  assert.equal(health.provider, 'openai-compatible');
  assert.equal(health.model, 'test-model');

  const removed = await adminRequest('DELETE', `/api/admin/ai/providers/${createdBody.provider.id}`);
  assert.equal(removed.status, 200);
  const afterDelete = await (await request('GET', '/api/health')).json();
  assert.equal(afterDelete.provider, 'mock');
});

test('admins can update, disable, soft-delete, and restore users', async () => {
  const email = 'student@example.com';
  const user = await loginUser(email);

  let list = await (await adminRequest('GET', `/api/admin/users?q=${encodeURIComponent(email)}`)).json();
  assert.equal(list.total, 1);
  const userRow = list.items.find((item) => item.email === email);
  assert.ok(userRow);

  const patched = await adminRequest('PATCH', `/api/admin/users/${user.userId}`, {
    name: 'Student One',
    role: 'teacher',
    plan: 'plus',
    usageLimit: 99,
    usageMinutes: 5,
    school: 'Test School',
    className: 'A1'
  });
  assert.equal(patched.status, 200);
  const patchedBody = await patched.json();
  assert.equal(patchedBody.profile.role, 'teacher');
  assert.equal(patchedBody.profile.plan, 'plus');
  assert.equal(patchedBody.profile.usage_limit, 99);

  assert.equal((await adminRequest('POST', `/api/admin/users/${user.userId}/disable`)).status, 200);
  const oldSession = await (await request('GET', '/api/auth/session', null, user.cookie)).json();
  assert.equal(oldSession.authenticated, false);
  assert.equal((await request('POST', '/api/auth/request-code', { email })).status, 403);

  assert.equal((await adminRequest('POST', `/api/admin/users/${user.userId}/enable`)).status, 200);
  const again = await loginUser(email);
  assert.equal((await request('GET', '/api/profile', null, again.cookie)).status, 200);

  assert.equal((await adminRequest('POST', `/api/admin/users/${user.userId}/soft-delete`)).status, 200);
  list = await (await adminRequest('GET', `/api/admin/users?q=${encodeURIComponent(email)}`)).json();
  assert.equal(list.total, 0);
  const deleted = await (await adminRequest('GET', `/api/admin/users?q=${encodeURIComponent(email)}&status=deleted`)).json();
  assert.equal(deleted.total, 1);

  assert.equal((await adminRequest('POST', `/api/admin/users/${user.userId}/restore`)).status, 200);
  list = await (await adminRequest('GET', `/api/admin/users?q=${encodeURIComponent(email)}`)).json();
  assert.equal(list.total, 1);
});

test('content lists and hard deletes clean up dependent rows and files', async () => {
  const user = await loginUser('content@example.com');

  const chat = await (await request('POST', '/api/chats', { subject: 'math', title: 'Admin test chat' }, user.cookie)).json();
  db.prepare('INSERT INTO messages (id, chat_id, role, content, image_url, tools_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(`msg-${Date.now()}`, chat.id, 'user', 'hello admin', null, null, Date.now());

  const prep = await (await request('POST', '/api/preps', { title: 'Admin test prep', subject: 'math', examDate: '2026-11-01' }, user.cookie)).json();
  db.prepare('UPDATE preps SET share_id = ? WHERE id = ?').run('share-test', prep.id);
  db.prepare('INSERT INTO attempts (id, user_id, prep_id, kind, item_id, answers_json, details_json, score, total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(`attempt-${Date.now()}`, user.userId, prep.id, 'challenge', 'c1', '{}', '[]', 1, 2, Date.now());

  const upload = await (await request('POST', '/api/uploads', { filename: 'admin-test.png', mime: 'image/png', dataBase64: PNG }, user.cookie)).json();
  const uploadRow = db.prepare('SELECT path FROM uploads WHERE id = ?').get(upload.id);
  assert.ok(fs.existsSync(uploadRow.path));

  const lab = await (await request('POST', '/api/lab/apps', { name: 'Admin test lab', prompt: 'demo' }, user.cookie)).json();

  const chats = await (await adminRequest('GET', `/api/admin/chats?q=${encodeURIComponent('Admin test chat')}`)).json();
  assert.ok(chats.items.some((item) => item.id === chat.id));
  const preps = await (await adminRequest('GET', `/api/admin/preps?q=${encodeURIComponent('Admin test prep')}`)).json();
  assert.ok(preps.items.some((item) => item.id === prep.id));
  const uploads = await (await adminRequest('GET', `/api/admin/uploads?q=${encodeURIComponent('admin-test.png')}`)).json();
  assert.ok(uploads.items.some((item) => item.id === upload.id));
  const labs = await (await adminRequest('GET', `/api/admin/lab-apps?q=${encodeURIComponent('Admin test lab')}`)).json();
  assert.ok(labs.items.some((item) => item.id === lab.app.id));

  assert.equal((await adminRequest('DELETE', `/api/admin/chats/${chat.id}`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM messages WHERE chat_id = ?').get(chat.id).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM chats WHERE id = ?').get(chat.id).c, 0);

  assert.equal((await adminRequest('POST', `/api/admin/preps/${prep.id}/unshare`)).status, 200);
  assert.equal(db.prepare('SELECT share_id FROM preps WHERE id = ?').get(prep.id).share_id, null);
  assert.equal((await adminRequest('DELETE', `/api/admin/preps/${prep.id}`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM preps WHERE id = ?').get(prep.id).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM attempts WHERE prep_id = ?').get(prep.id).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM calendar_events WHERE prep_id = ?').get(prep.id).c, 0);

  assert.equal((await adminRequest('DELETE', `/api/admin/uploads/${upload.id}`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM uploads WHERE id = ?').get(upload.id).c, 0);
  assert.equal(fs.existsSync(uploadRow.path), false);

  assert.equal((await adminRequest('PATCH', `/api/admin/lab-apps/${lab.app.id}`, { visibility: 'public' })).status, 200);
  assert.equal(db.prepare('SELECT visibility FROM lab_apps WHERE id = ?').get(lab.app.id).visibility, 'public');
  assert.equal((await adminRequest('DELETE', `/api/admin/lab-apps/${lab.app.id}`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM lab_apps WHERE id = ?').get(lab.app.id).c, 0);

  const audit = await (await adminRequest('GET', '/api/admin/audit?pageSize=100')).json();
  const actions = new Set(audit.items.map((item) => item.action));
  for (const action of ['chat.deleted', 'prep.unshared', 'prep.deleted', 'upload.deleted', 'lab.updated', 'lab.deleted']) {
    assert.ok(actions.has(action), `missing audit action ${action}`);
  }
});

test('admin password can be changed and old credentials stop working', async () => {
  const changed = await adminRequest('POST', '/api/admin/password', {
    currentPassword: 'admin123',
    newPassword: 'admin456'
  });
  assert.equal(changed.status, 200);

  const oldLogin = await request('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  assert.equal(oldLogin.status, 401);
  const newLogin = await request('POST', '/api/admin/login', { username: 'admin', password: 'admin456' });
  assert.equal(newLogin.status, 200);
});
