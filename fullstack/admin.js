'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ADMIN_COOKIE = 'havs_admin_session';
const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

const PALETTE_KEYS = ['bg', 'panel', 'panel2', 'line', 'text', 'muted', 'accent', 'accent2', 'onAccent', 'danger', 'ok'];
const DEFAULT_PALETTE = {
  dark: {
    bg: '#081005',
    panel: '#0f1a0b',
    panel2: '#152411',
    line: '#233a1c',
    text: '#f4f7f1',
    muted: '#a9b7a2',
    accent: '#ea580c',
    accent2: '#00a10d',
    onAccent: '#081005',
    danger: '#ff5c5c',
    ok: '#00a10d'
  },
  light: {
    bg: '#f6f7f0',
    panel: '#ffffff',
    panel2: '#eef1e4',
    line: '#d7ddc9',
    text: '#142011',
    muted: '#5f6b58',
    accent: '#ea580c',
    accent2: '#00a10d',
    onAccent: '#081005',
    danger: '#ff5c5c',
    ok: '#00a10d'
  }
};

const ROLES = ['student', 'parent', 'teacher'];
const PROVIDERS = ['commandcode', 'deepseek', 'openai-compatible', 'mock'];
const KINDS = ['chat', 'vision'];
const REASONING = ['', 'off', 'low', 'medium', 'high'];

function createAdmin({ db, send, readJson, parseCookies, secureCookie, now, uid, dataDir, uploadDir, ai }) {
  /* ------------------------------------------------------------------ schema */

  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_accounts (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_default_password INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      csrf TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id TEXT,
      username TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      meta_json TEXT,
      ip TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      provider TEXT NOT NULL,
      base_url TEXT,
      api_key_enc TEXT,
      model TEXT,
      fallback_model TEXT,
      reasoning_effort TEXT,
      enabled INTEGER DEFAULT 1,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_ai_providers_kind ON ai_providers(kind, enabled, is_default);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at);
  `);

  function addColumn(table, column, definition) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); } catch {}
  }
  addColumn('users', 'disabled', 'INTEGER DEFAULT 0');
  addColumn('users', 'deleted_at', 'INTEGER');

  /* --------------------------------------------------------------- utilities */

  const loginBuckets = new Map();

  const str = (value, max = 200) => String(value == null ? '' : value).trim().slice(0, max);
  const int = (value, fallback = 0) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
  };
  const bool = (value, fallback = false) => value === undefined ? fallback : !!value;
  const parseJson = (value, fallback) => {
    try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  };
  const same = (a, b) => {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  };
  const clientIp = (req) => {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.socket?.remoteAddress || '';
  };
  const pageParams = (url, defaultSize = 25) => {
    const page = Math.max(1, int(url.searchParams.get('page'), 1));
    const pageSize = Math.min(100, Math.max(1, int(url.searchParams.get('pageSize'), defaultSize)));
    return { page, pageSize, offset: (page - 1) * pageSize };
  };
  const totalOf = (sql, params) => Number(db.prepare(sql).get(...params)?.c || 0);

  function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  function verifyPassword(password, stored) {
    const [salt, hash] = String(stored || '').split(':');
    if (!salt || !hash) return false;
    try {
      const actual = crypto.scryptSync(String(password), salt, 64);
      const expected = Buffer.from(hash, 'hex');
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }

  function audit(session, action, targetType, targetId, meta, req) {
    db.prepare(
      'INSERT INTO admin_audit (admin_id, username, action, target_type, target_id, meta_json, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      session?.admin_id || null,
      session?.username || null,
      action,
      targetType || null,
      targetId == null ? null : String(targetId),
      JSON.stringify(meta || {}).slice(0, 8000),
      clientIp(req),
      now()
    );
  }

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  function adminSession(req) {
    const token = parseCookies(req)[ADMIN_COOKIE];
    if (!token) return null;
    db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now());
    const row = db.prepare(`
      SELECT s.*, a.username, a.is_default_password
      FROM admin_sessions s JOIN admin_accounts a ON a.id = s.admin_id
      WHERE s.token = ?
    `).get(token);
    if (!row || row.expires_at <= now()) return null;
    return row;
  }

  function requireAdmin(req, res, options = {}) {
    const session = adminSession(req);
    if (!session) {
      send(res, 401, { error: 'admin_unauthorized' });
      return null;
    }
    if (options.csrf) {
      const provided = String(req.headers['x-csrf-token'] || '');
      if (!same(provided, session.csrf)) {
        send(res, 403, { error: 'csrf_invalid' });
        return null;
      }
    }
    return session;
  }

  function cookieHeader(req, token, maxAge) {
    const secure = secureCookie(req) ? '; Secure' : '';
    return `${ADMIN_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${secure}`;
  }

  function seedAdmin() {
    const count = Number(db.prepare('SELECT COUNT(*) AS c FROM admin_accounts').get().c || 0);
    if (count) return;
    const username = str(process.env.ADMIN_USERNAME || 'admin', 32) || 'admin';
    const password = String(process.env.ADMIN_PASSWORD || 'admin');
    const isDefault = username === 'admin' && password === 'admin';
    db.prepare(
      'INSERT INTO admin_accounts (id, username, password_hash, is_default_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(uid(), username, hashPassword(password), isDefault ? 1 : 0, now(), now());
    if (isDefault) {
      console.warn('WARNING: default admin account is admin/admin. Change it at /admin immediately.');
    }
  }

  function seedProviders() {
    const marker = db.prepare("SELECT value FROM app_settings WHERE key = 'ai_seeded'").get();
    if (marker) return;
    const count = Number(db.prepare('SELECT COUNT(*) AS c FROM ai_providers').get().c || 0);
    if (count) {
      db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('ai_seeded', '1', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(now());
      return;
    }
    const selected = ai.defaults?.selected;
    const chat = ai.defaults?.[selected];
    const vision = ai.defaults?.vision;
    if ((selected !== 'commandcode' && selected !== 'deepseek') || !chat) return;

    transaction(() => {
      db.prepare(`
        INSERT INTO ai_providers (id, name, kind, provider, base_url, api_key_enc, model, fallback_model, reasoning_effort, enabled, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uid(),
        selected === 'commandcode' ? 'Command Code' : 'DeepSeek',
        'chat',
        selected,
        chat.baseUrl || '',
        null,
        chat.model || '',
        '',
        '',
        1,
        1,
        now(),
        now()
      );

      if (vision?.model) {
        db.prepare(`
          INSERT INTO ai_providers (id, name, kind, provider, base_url, api_key_enc, model, fallback_model, reasoning_effort, enabled, is_default, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          uid(),
          'Vision (Command Code)',
          'vision',
          'commandcode',
          vision.baseUrl || '',
          null,
          vision.model,
          vision.fallbackModel || '',
          vision.reasoningEffort || '',
          1,
          1,
          now(),
          now()
        );
      }

      db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('ai_seeded', '1', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(now());
    });
    console.log(`Seeded AI providers from ENV (${selected}${vision?.model ? ' + vision' : ''})`);
  }

  /* ------------------------------------------------------------------- theme */

  function getPalette() {
    const row = db.prepare("SELECT value, updated_at FROM app_settings WHERE key = 'theme_palette'").get();
    const saved = row ? parseJson(row.value, {}) : {};
    return {
      palette: {
        dark: { ...DEFAULT_PALETTE.dark, ...(saved.dark || {}) },
        light: { ...DEFAULT_PALETTE.light, ...(saved.light || {}) }
      },
      updatedAt: row?.updated_at || null
    };
  }

  function validatePalette(input) {
    if (!input || typeof input !== 'object') throw new Error('invalid_palette');
    const result = {};
    for (const mode of ['dark', 'light']) {
      const source = input[mode];
      if (!source || typeof source !== 'object') throw new Error(`invalid_palette:${mode}`);
      result[mode] = {};
      for (const key of PALETTE_KEYS) {
        const value = String(source[key] || DEFAULT_PALETTE[mode][key]);
        if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`invalid_palette:${mode}.${key}`);
        result[mode][key] = value.toLowerCase();
      }
    }
    return result;
  }

  function hexToRgb(hex) {
    const value = String(hex).replace('#', '');
    return `${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(value.slice(2, 4), 16)}, ${Number.parseInt(value.slice(4, 6), 16)}`;
  }

  function themeVars(palette) {
    return [
      `--bg:${palette.bg}`,
      `--bg-rgb:${hexToRgb(palette.bg)}`,
      `--panel:${palette.panel}`,
      `--panel-2:${palette.panel2}`,
      `--line:${palette.line}`,
      `--text:${palette.text}`,
      `--muted:${palette.muted}`,
      `--accent:${palette.accent}`,
      `--accent-rgb:${hexToRgb(palette.accent)}`,
      `--accent-2:${palette.accent2}`,
      `--accent-2-rgb:${hexToRgb(palette.accent2)}`,
      `--on-accent:${palette.onAccent}`,
      `--danger:${palette.danger}`,
      `--danger-rgb:${hexToRgb(palette.danger)}`,
      `--ok:${palette.ok}`
    ].join(';');
  }

  function themeCss() {
    const { palette } = getPalette();
    return `:root{${themeVars(palette.dark)}}\nhtml[data-theme="light"]{${themeVars(palette.light)}}\n`;
  }

  function sendThemeCss(res) {
    res.writeHead(200, {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    res.end(themeCss());
  }

  /* --------------------------------------------------------------------- AI */

  function envKeyFor(row) {
    if (row.kind === 'vision') {
      return row.provider === 'commandcode' ? (ai.defaults?.vision?.apiKey || '') : '';
    }
    if (row.provider === 'commandcode') return ai.defaults?.commandcode?.apiKey || '';
    if (row.provider === 'deepseek') return ai.defaults?.deepseek?.apiKey || '';
    return '';
  }

  function providerView(row) {
    const dbKey = !!row.api_key_enc;
    const envKey = envKeyFor(row);
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      provider: row.provider,
      baseUrl: row.base_url || '',
      model: row.model || '',
      fallbackModel: row.fallback_model || '',
      reasoningEffort: row.reasoning_effort || '',
      enabled: !!row.enabled,
      isDefault: !!row.is_default,
      hasKey: dbKey || !!envKey,
      keyHint: dbKey ? secretsHint(row.api_key_enc) : envKey ? 'ENV' : '',
      keySource: dbKey ? 'db' : envKey ? 'env' : 'none',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function secretsHint(payload) {
    const value = secretsProvider ? secretsProvider.decrypt(payload) : null;
    if (!value) return '';
    return `••••${value.slice(-4)}`;
  }

  function validateProvider(body, existing) {
    const kind = String(body.kind ?? existing?.kind ?? '').trim();
    if (!KINDS.includes(kind)) throw new Error('invalid_kind');
    const provider = String(body.provider ?? existing?.provider ?? '').trim();
    if (!PROVIDERS.includes(provider)) throw new Error('invalid_provider');
    const name = str(body.name ?? existing?.name ?? provider, 80) || provider;
    const baseUrl = str(body.baseUrl ?? existing?.base_url ?? '', 300).replace(/\/$/, '');
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) throw new Error('invalid_base_url');
    const model = str(body.model ?? existing?.model ?? '', 200);
    if (provider !== 'mock' && !model) throw new Error('missing_model');
    const reasoningEffort = str(body.reasoningEffort ?? existing?.reasoning_effort ?? '', 20);
    if (!REASONING.includes(reasoningEffort)) throw new Error('invalid_reasoning_effort');
    return {
      kind,
      provider,
      name,
      baseUrl: provider === 'mock' ? '' : baseUrl,
      model: provider === 'mock' ? 'mock' : model,
      fallbackModel: str(body.fallbackModel ?? existing?.fallback_model ?? '', 200),
      reasoningEffort,
      enabled: bool(body.enabled, existing ? !!existing.enabled : true),
      isDefault: bool(body.isDefault, existing ? !!existing.is_default : false)
    };
  }

  function saveProviderDefault(id, kind) {
    db.prepare('UPDATE ai_providers SET is_default = 0 WHERE kind = ?').run(kind);
    db.prepare('UPDATE ai_providers SET is_default = 1, updated_at = ? WHERE id = ?').run(now(), id);
  }

  /* ------------------------------------------------------------------- users */

  const USER_SELECT = `
    SELECT u.id, u.email, u.created_at, u.disabled, u.deleted_at,
      p.role, p.name, p.plan, p.usage_minutes, p.usage_limit, p.school, p.class_name,
      (SELECT COUNT(*) FROM chats c WHERE c.user_id = u.id) AS chat_count,
      (SELECT COUNT(*) FROM preps pr WHERE pr.user_id = u.id) AS prep_count,
      (SELECT COUNT(*) FROM uploads up WHERE up.user_id = u.id) AS upload_count,
      (SELECT COUNT(*) FROM lab_apps la WHERE la.user_id = u.id) AS lab_count,
      (SELECT COUNT(*) FROM attempts at WHERE at.user_id = u.id) AS attempt_count
    FROM users u LEFT JOIN profiles p ON p.user_id = u.id
  `;

  function userWhere(url) {
    const q = str(url.searchParams.get('q'), 200);
    const role = str(url.searchParams.get('role'), 32);
    const plan = str(url.searchParams.get('plan'), 32);
    const status = str(url.searchParams.get('status'), 20) || 'active';
    const clauses = [];
    const params = [];
    if (q) {
      clauses.push('(u.email LIKE ? OR p.name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (role) { clauses.push('p.role = ?'); params.push(role); }
    if (plan) { clauses.push('p.plan = ?'); params.push(plan); }
    if (status === 'deleted') clauses.push('u.deleted_at IS NOT NULL');
    else if (status === 'disabled') clauses.push('u.deleted_at IS NULL AND COALESCE(u.disabled, 0) = 1');
    else if (status !== 'all') clauses.push('u.deleted_at IS NULL AND COALESCE(u.disabled, 0) = 0');
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }

  function userCounts(userId) {
    const one = (sql) => Number(db.prepare(sql).get(userId)?.c || 0);
    return {
      chats: one('SELECT COUNT(*) AS c FROM chats WHERE user_id = ?'),
      messages: Number(db.prepare('SELECT COUNT(*) AS c FROM messages m JOIN chats c ON c.id = m.chat_id WHERE c.user_id = ?').get(userId)?.c || 0),
      preps: one('SELECT COUNT(*) AS c FROM preps WHERE user_id = ?'),
      uploads: one('SELECT COUNT(*) AS c FROM uploads WHERE user_id = ?'),
      labApps: one('SELECT COUNT(*) AS c FROM lab_apps WHERE user_id = ?'),
      attempts: one('SELECT COUNT(*) AS c FROM attempts WHERE user_id = ?'),
      events: one('SELECT COUNT(*) AS c FROM events WHERE user_id = ?')
    };
  }

  /* ---------------------------------------------------------------- dispatch */

  async function routeAdmin(req, res, p, url) {
    const method = req.method;
    const mutating = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);

    if (p === '/theme.css') {
      if (method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
      return sendThemeCss(res);
    }

    if (!p.startsWith('/api/admin/')) return;

    if (p === '/api/admin/login' && method === 'POST') {
      const body = await readJson(req);
      const username = str(body.username, 32);
      const password = String(body.password || '');
      const key = `${clientIp(req)}|${username.toLowerCase()}`;
      const bucket = loginBuckets.get(key);
      if (bucket && bucket.resetAt > now()) {
        if (bucket.count >= LOGIN_MAX_ATTEMPTS) {
          return send(res, 429, { error: 'rate_limited', retryAfter: Math.ceil((bucket.resetAt - now()) / 1000) });
        }
      } else {
        loginBuckets.set(key, { count: 0, resetAt: now() + LOGIN_WINDOW_MS });
      }

      const account = db.prepare('SELECT * FROM admin_accounts WHERE username = ?').get(username);
      if (!account || !verifyPassword(password, account.password_hash)) {
        const current = loginBuckets.get(key);
        current.count += 1;
        audit(null, 'admin.login_failed', 'admin', username, { ip: clientIp(req) }, req);
        return send(res, 401, { error: 'invalid_credentials' });
      }

      loginBuckets.delete(key);
      db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now());
      const token = crypto.randomBytes(32).toString('hex');
      const csrf = crypto.randomBytes(32).toString('hex');
      db.prepare(
        'INSERT INTO admin_sessions (token, admin_id, csrf, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
      ).run(token, account.id, csrf, now(), now() + ADMIN_SESSION_MS);
      audit({ admin_id: account.id, username: account.username }, 'admin.login', 'admin', account.id, {}, req);
      return send(res, 200, {
        username: account.username,
        csrf,
        mustChangePassword: !!account.is_default_password
      }, { 'Set-Cookie': cookieHeader(req, token, Math.floor(ADMIN_SESSION_MS / 1000)) });
    }

    if (p === '/api/admin/session' && method === 'GET') {
      const session = adminSession(req);
      if (!session) return send(res, 200, { authenticated: false });
      return send(res, 200, {
        authenticated: true,
        username: session.username,
        csrf: session.csrf,
        mustChangePassword: !!session.is_default_password
      });
    }

    if (p === '/api/admin/logout' && method === 'POST') {
      const session = requireAdmin(req, res, { csrf: true });
      if (!session) return;
      db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(session.token);
      audit(session, 'admin.logout', 'admin', session.admin_id, {}, req);
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
    }

    const session = requireAdmin(req, res, { csrf: mutating });
    if (!session) return;

    if (p === '/api/admin/password' && method === 'POST') {
      const body = await readJson(req);
      const account = db.prepare('SELECT * FROM admin_accounts WHERE id = ?').get(session.admin_id);
      if (!account || !verifyPassword(String(body.currentPassword || ''), account.password_hash)) {
        return send(res, 401, { error: 'invalid_current_password' });
      }
      const next = String(body.newPassword || '');
      if (next.length < 6) return send(res, 400, { error: 'password_too_short' });
      db.prepare('UPDATE admin_accounts SET password_hash = ?, is_default_password = 0, updated_at = ? WHERE id = ?')
        .run(hashPassword(next), now(), account.id);
      db.prepare('DELETE FROM admin_sessions WHERE admin_id = ? AND token <> ?').run(account.id, session.token);
      audit(session, 'admin.password_changed', 'admin', account.id, {}, req);
      return send(res, 200, { ok: true, mustChangePassword: false });
    }

    if (session.is_default_password) {
      return send(res, 403, { error: 'password_change_required' });
    }

    if (p === '/api/admin/accounts' && method === 'GET') {
      const items = db.prepare('SELECT id, username, is_default_password, created_at, updated_at FROM admin_accounts ORDER BY created_at ASC').all();
      return send(res, 200, { items });
    }

    if (p === '/api/admin/accounts' && method === 'POST') {
      const body = await readJson(req);
      const username = str(body.username, 32);
      const password = String(body.password || '');
      if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return send(res, 400, { error: 'invalid_username' });
      if (password.length < 6) return send(res, 400, { error: 'password_too_short' });
      if (db.prepare('SELECT id FROM admin_accounts WHERE username = ?').get(username)) {
        return send(res, 409, { error: 'username_taken' });
      }
      const id = uid();
      db.prepare('INSERT INTO admin_accounts (id, username, password_hash, is_default_password, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
        .run(id, username, hashPassword(password), now(), now());
      audit(session, 'admin.account_created', 'admin', id, { username }, req);
      return send(res, 200, { id, username });
    }

    const accountPassword = p.match(/^\/api\/admin\/accounts\/([^/]+)\/password$/);
    if (accountPassword && method === 'POST') {
      const body = await readJson(req);
      const password = String(body.password || '');
      if (password.length < 6) return send(res, 400, { error: 'password_too_short' });
      const account = db.prepare('SELECT id, username FROM admin_accounts WHERE id = ?').get(accountPassword[1]);
      if (!account) return send(res, 404, { error: 'not_found' });
      db.prepare('UPDATE admin_accounts SET password_hash = ?, is_default_password = 0, updated_at = ? WHERE id = ?')
        .run(hashPassword(password), now(), account.id);
      db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(account.id);
      audit(session, 'admin.account_password_reset', 'admin', account.id, { username: account.username }, req);
      return send(res, 200, { ok: true });
    }

    const accountDelete = p.match(/^\/api\/admin\/accounts\/([^/]+)$/);
    if (accountDelete && method === 'DELETE') {
      if (accountDelete[1] === session.admin_id) return send(res, 400, { error: 'cannot_delete_self' });
      const count = Number(db.prepare('SELECT COUNT(*) AS c FROM admin_accounts').get().c || 0);
      if (count <= 1) return send(res, 400, { error: 'last_admin' });
      const account = db.prepare('SELECT id, username FROM admin_accounts WHERE id = ?').get(accountDelete[1]);
      if (!account) return send(res, 404, { error: 'not_found' });
      transaction(() => {
        db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(account.id);
        db.prepare('DELETE FROM admin_accounts WHERE id = ?').run(account.id);
        audit(session, 'admin.account_deleted', 'admin', account.id, { username: account.username }, req);
      });
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/overview' && method === 'GET') {
      const count = (sql) => Number(db.prepare(sql).get()?.c || 0);
      return send(res, 200, {
        users: {
          total: count('SELECT COUNT(*) AS c FROM users'),
          active: count('SELECT COUNT(*) AS c FROM users WHERE COALESCE(disabled,0)=0 AND deleted_at IS NULL'),
          disabled: count('SELECT COUNT(*) AS c FROM users WHERE COALESCE(disabled,0)=1 AND deleted_at IS NULL'),
          deleted: count('SELECT COUNT(*) AS c FROM users WHERE deleted_at IS NOT NULL')
        },
        chats: count('SELECT COUNT(*) AS c FROM chats'),
        messages: count('SELECT COUNT(*) AS c FROM messages'),
        preps: count('SELECT COUNT(*) AS c FROM preps'),
        uploads: count('SELECT COUNT(*) AS c FROM uploads'),
        labApps: count('SELECT COUNT(*) AS c FROM lab_apps'),
        attempts: count('SELECT COUNT(*) AS c FROM attempts'),
        events: count('SELECT COUNT(*) AS c FROM events'),
        ai: ai.describe(),
        audit: db.prepare('SELECT id, username, action, target_type, target_id, created_at FROM admin_audit ORDER BY id DESC LIMIT 10').all()
      });
    }

    if (p === '/api/admin/audit' && method === 'GET') {
      const { page, pageSize, offset } = pageParams(url);
      const action = str(url.searchParams.get('action'), 80);
      const adminId = str(url.searchParams.get('adminId'), 80);
      const clauses = [];
      const params = [];
      if (action) { clauses.push('action LIKE ?'); params.push(`%${action}%`); }
      if (adminId) { clauses.push('admin_id = ?'); params.push(adminId); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const total = totalOf(`SELECT COUNT(*) AS c FROM admin_audit ${where}`, params);
      const items = db.prepare(`SELECT * FROM admin_audit ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
        .all(...params, pageSize, offset)
        .map((row) => ({ ...row, meta: parseJson(row.meta_json, {}) }));
      return send(res, 200, { items, total, page, pageSize });
    }

    if (p === '/api/admin/users' && method === 'GET') {
      const { page, pageSize, offset } = pageParams(url);
      const { where, params } = userWhere(url);
      const total = totalOf(`SELECT COUNT(*) AS c FROM users u LEFT JOIN profiles p ON p.user_id = u.id ${where}`, params);
      const items = db.prepare(`${USER_SELECT} ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`)
        .all(...params, pageSize, offset);
      return send(res, 200, { items, total, page, pageSize });
    }

    const userPath = p.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (userPath && method === 'GET') {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userPath[1]);
      if (!user) return send(res, 404, { error: 'not_found' });
      delete user.password_hash;
      const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id) || null;
      return send(res, 200, {
        user,
        profile,
        counts: userCounts(user.id),
        parentLinks: db.prepare(`
          SELECT pl.*, pu.email AS parent_email, cu.email AS child_user_email, cp.name AS child_name
          FROM parent_links pl
          LEFT JOIN users pu ON pu.id = pl.parent_user_id
          LEFT JOIN users cu ON cu.id = pl.child_user_id
          LEFT JOIN profiles cp ON cp.user_id = pl.child_user_id
          WHERE pl.parent_user_id = ? OR pl.child_user_id = ? OR pl.child_email = ?
          ORDER BY pl.created_at DESC
        `).all(user.id, user.id, user.email),
        recentChats: db.prepare('SELECT id, subject, title, created_at FROM chats WHERE user_id = ? ORDER BY created_at DESC LIMIT 5').all(user.id),
        recentPreps: db.prepare('SELECT id, title, subject, status, share_id, created_at FROM preps WHERE user_id = ? ORDER BY created_at DESC LIMIT 5').all(user.id),
        recentUploads: db.prepare('SELECT id, filename, mime, created_at FROM uploads WHERE user_id = ? ORDER BY created_at DESC LIMIT 5').all(user.id)
      });
    }

    if (userPath && method === 'PATCH') {
      const body = await readJson(req);
      const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(userPath[1]);
      if (!user) return send(res, 404, { error: 'not_found' });
      db.prepare('INSERT OR IGNORE INTO profiles (user_id, updated_at) VALUES (?, ?)').run(user.id, now());
      const before = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id);
      const sets = [];
      const params = [];
      const textFields = { name: 'name', plan: 'plan', school: 'school', className: 'class_name' };
      for (const [key, column] of Object.entries(textFields)) {
        if (body[key] !== undefined) { sets.push(`${column} = ?`); params.push(str(body[key], 120)); }
      }
      if (body.role !== undefined) {
        const role = str(body.role, 20);
        if (!ROLES.includes(role)) return send(res, 400, { error: 'invalid_role' });
        sets.push('role = ?'); params.push(role);
      }
      for (const [key, column] of Object.entries({ usageLimit: 'usage_limit', usageMinutes: 'usage_minutes' })) {
        if (body[key] !== undefined) {
          const value = int(body[key], 0);
          if (value < 0) return send(res, 400, { error: 'invalid_value' });
          sets.push(`${column} = ?`); params.push(value);
        }
      }
      if (!sets.length) return send(res, 400, { error: 'no_fields' });
      sets.push('updated_at = ?'); params.push(now(), user.id);
      db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE user_id = ?`).run(...params);
      const after = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id);
      audit(session, 'user.updated', 'user', user.id, { email: user.email, before, after }, req);
      return send(res, 200, { user: db.prepare('SELECT * FROM users WHERE id = ?').get(user.id), profile: after });
    }

    const userAction = p.match(/^\/api\/admin\/users\/([^/]+)\/(disable|enable|soft-delete|restore|logout-all)$/);
    if (userAction && method === 'POST') {
      const user = db.prepare('SELECT id, email, disabled, deleted_at FROM users WHERE id = ?').get(userAction[1]);
      if (!user) return send(res, 404, { error: 'not_found' });
      const action = userAction[2];
      if (action === 'disable') db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(user.id);
      if (action === 'enable') db.prepare('UPDATE users SET disabled = 0 WHERE id = ?').run(user.id);
      if (action === 'soft-delete') db.prepare('UPDATE users SET disabled = 1, deleted_at = ? WHERE id = ?').run(now(), user.id);
      if (action === 'restore') db.prepare('UPDATE users SET disabled = 0, deleted_at = NULL WHERE id = ?').run(user.id);
      if (action === 'logout-all' || action === 'disable' || action === 'soft-delete') {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      }
      audit(session, `user.${action.replace('-', '_')}`, 'user', user.id, { email: user.email }, req);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/chats' && method === 'GET') {
      const { page, pageSize, offset } = pageParams(url);
      const q = str(url.searchParams.get('q'), 200);
      const userId = str(url.searchParams.get('userId'), 80);
      const clauses = [];
      const params = [];
      if (q) { clauses.push('(c.title LIKE ? OR u.email LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
      if (userId) { clauses.push('c.user_id = ?'); params.push(userId); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const total = totalOf(`SELECT COUNT(*) AS c FROM chats c JOIN users u ON u.id = c.user_id ${where}`, params);
      const items = db.prepare(`
        SELECT c.id, c.user_id, u.email, c.subject, c.title, c.created_at,
          (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count
        FROM chats c JOIN users u ON u.id = c.user_id ${where}
        ORDER BY c.created_at DESC LIMIT ? OFFSET ?
      `).all(...params, pageSize, offset);
      return send(res, 200, { items, total, page, pageSize });
    }

    const chatPath = p.match(/^\/api\/admin\/chats\/([^/]+)$/);
    if (chatPath && method === 'GET') {
      const chat = db.prepare('SELECT c.*, u.email FROM chats c JOIN users u ON u.id = c.user_id WHERE c.id = ?').get(chatPath[1]);
      if (!chat) return send(res, 404, { error: 'not_found' });
      const messages = db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC').all(chat.id);
      return send(res, 200, { chat, messages });
    }
    if (chatPath && method === 'PATCH') {
      const body = await readJson(req);
      const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatPath[1]);
      if (!chat) return send(res, 404, { error: 'not_found' });
      const title = body.title !== undefined ? str(body.title, 120) : chat.title;
      const subject = body.subject !== undefined ? str(body.subject, 40) : chat.subject;
      db.prepare('UPDATE chats SET title = ?, subject = ? WHERE id = ?').run(title, subject, chat.id);
      audit(session, 'chat.updated', 'chat', chat.id, { before: { title: chat.title, subject: chat.subject }, after: { title, subject } }, req);
      return send(res, 200, { ok: true });
    }
    if (chatPath && method === 'DELETE') {
      const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatPath[1]);
      if (!chat) return send(res, 404, { error: 'not_found' });
      transaction(() => {
        db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chat.id);
        db.prepare('DELETE FROM chats WHERE id = ?').run(chat.id);
        audit(session, 'chat.deleted', 'chat', chat.id, { user_id: chat.user_id, title: chat.title }, req);
      });
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/preps' && method === 'GET') {
      const { page, pageSize, offset } = pageParams(url);
      const q = str(url.searchParams.get('q'), 200);
      const userId = str(url.searchParams.get('userId'), 80);
      const status = str(url.searchParams.get('status'), 30);
      const shared = str(url.searchParams.get('shared'), 10);
      const clauses = [];
      const params = [];
      if (q) { clauses.push('(p.title LIKE ? OR u.email LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
      if (userId) { clauses.push('p.user_id = ?'); params.push(userId); }
      if (status) { clauses.push('p.status = ?'); params.push(status); }
      if (shared === '1') clauses.push('p.share_id IS NOT NULL');
      if (shared === '0') clauses.push('p.share_id IS NULL');
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const total = totalOf(`SELECT COUNT(*) AS c FROM preps p JOIN users u ON u.id = p.user_id ${where}`, params);
      const items = db.prepare(`
        SELECT p.id, p.user_id, u.email, p.title, p.subject, p.exam_date, p.status, p.share_id,
          p.school, p.curriculum, p.created_at, p.updated_at,
          (SELECT COUNT(*) FROM attempts a WHERE a.prep_id = p.id) AS attempt_count
        FROM preps p JOIN users u ON u.id = p.user_id ${where}
        ORDER BY p.created_at DESC LIMIT ? OFFSET ?
      `).all(...params, pageSize, offset);
      return send(res, 200, { items, total, page, pageSize });
    }

    const prepPath = p.match(/^\/api\/admin\/preps\/([^/]+)$/);
    if (prepPath && method === 'GET') {
      const prep = db.prepare('SELECT p.*, u.email FROM preps p JOIN users u ON u.id = p.user_id WHERE p.id = ?').get(prepPath[1]);
      if (!prep) return send(res, 404, { error: 'not_found' });
      return send(res, 200, {
        prep: {
          ...prep,
          plan: parseJson(prep.plan_json, null),
          lessons: parseJson(prep.lessons_json, []),
          challenges: parseJson(prep.challenges_json, []),
          mockExams: parseJson(prep.mock_json, []),
          mastery: parseJson(prep.mastery_json, {})
        }
      });
    }
    if (prepPath && method === 'PATCH') {
      const body = await readJson(req);
      const prep = db.prepare('SELECT * FROM preps WHERE id = ?').get(prepPath[1]);
      if (!prep) return send(res, 404, { error: 'not_found' });
      const fields = {
        title: ['title', 120],
        subject: ['subject', 40],
        examDate: ['exam_date', 40],
        status: ['status', 30],
        school: ['school', 120],
        curriculum: ['curriculum', 120]
      };
      const sets = [];
      const params = [];
      for (const [key, [column, max]] of Object.entries(fields)) {
        if (body[key] !== undefined) { sets.push(`${column} = ?`); params.push(str(body[key], max)); }
      }
      if (!sets.length) return send(res, 400, { error: 'no_fields' });
      sets.push('updated_at = ?'); params.push(now(), prep.id);
      db.prepare(`UPDATE preps SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      audit(session, 'prep.updated', 'prep', prep.id, { fields: Object.keys(fields).filter((key) => body[key] !== undefined) }, req);
      return send(res, 200, { ok: true });
    }
    if (prepPath && method === 'DELETE') {
      const prep = db.prepare('SELECT * FROM preps WHERE id = ?').get(prepPath[1]);
      if (!prep) return send(res, 404, { error: 'not_found' });
      transaction(() => {
        db.prepare('DELETE FROM attempts WHERE prep_id = ?').run(prep.id);
        db.prepare('DELETE FROM calendar_events WHERE prep_id = ?').run(prep.id);
        db.prepare('DELETE FROM preps WHERE id = ?').run(prep.id);
        audit(session, 'prep.deleted', 'prep', prep.id, { user_id: prep.user_id, title: prep.title }, req);
      });
      return send(res, 200, { ok: true });
    }

    const prepUnshare = p.match(/^\/api\/admin\/preps\/([^/]+)\/unshare$/);
    if (prepUnshare && method === 'POST') {
      const prep = db.prepare('SELECT id, share_id FROM preps WHERE id = ?').get(prepUnshare[1]);
      if (!prep) return send(res, 404, { error: 'not_found' });
      db.prepare('UPDATE preps SET share_id = NULL, updated_at = ? WHERE id = ?').run(now(), prep.id);
      audit(session, 'prep.unshared', 'prep', prep.id, { share_id: prep.share_id }, req);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/uploads' && method === 'GET') {
      const { page, pageSize, offset } = pageParams(url);
      const q = str(url.searchParams.get('q'), 200);
      const userId = str(url.searchParams.get('userId'), 80);
      const mime = str(url.searchParams.get('mime'), 80);
      const clauses = [];
      const params = [];
      if (q) { clauses.push('(up.filename LIKE ? OR u.email LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
      if (userId) { clauses.push('up.user_id = ?'); params.push(userId); }
      if (mime) { clauses.push('up.mime = ?'); params.push(mime); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const total = totalOf(`SELECT COUNT(*) AS c FROM uploads up JOIN users u ON u.id = up.user_id ${where}`, params);
      const items = db.prepare(`
        SELECT up.*, u.email FROM uploads up JOIN users u ON u.id = up.user_id ${where}
        ORDER BY up.created_at DESC LIMIT ? OFFSET ?
      `).all(...params, pageSize, offset).map((row) => {
        let size = null;
        let exists = false;
        try { const stat = fs.statSync(row.path); size = stat.size; exists = true; } catch {}
        delete row.extracted_text;
        delete row.path;
        return { ...row, size, exists };
      });
      return send(res, 200, { items, total, page, pageSize });
    }

    const uploadPath = p.match(/^\/api\/admin\/uploads\/([^/]+)$/);
    if (uploadPath && method === 'DELETE') {
      const row = db.prepare('SELECT * FROM uploads WHERE id = ?').get(uploadPath[1]);
      if (!row) return send(res, 404, { error: 'not_found' });
      transaction(() => {
        db.prepare('DELETE FROM uploads WHERE id = ?').run(row.id);
        try {
          const absolute = path.resolve(row.path);
          const root = path.resolve(uploadDir) + path.sep;
          if (absolute.startsWith(root)) fs.unlinkSync(absolute);
        } catch {}
        audit(session, 'upload.deleted', 'upload', row.id, { user_id: row.user_id, filename: row.filename }, req);
      });
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/lab-apps' && method === 'GET') {
      const { page, pageSize, offset } = pageParams(url);
      const q = str(url.searchParams.get('q'), 200);
      const userId = str(url.searchParams.get('userId'), 80);
      const visibility = str(url.searchParams.get('visibility'), 20);
      const clauses = [];
      const params = [];
      if (q) { clauses.push('(la.name LIKE ? OR la.slug LIKE ? OR u.email LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
      if (userId) { clauses.push('la.user_id = ?'); params.push(userId); }
      if (visibility) { clauses.push('la.visibility = ?'); params.push(visibility); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const total = totalOf(`SELECT COUNT(*) AS c FROM lab_apps la JOIN users u ON u.id = la.user_id ${where}`, params);
      const items = db.prepare(`
        SELECT la.id, la.user_id, u.email, la.slug, la.name, la.prompt, la.visibility, la.created_at, la.updated_at
        FROM lab_apps la JOIN users u ON u.id = la.user_id ${where}
        ORDER BY la.created_at DESC LIMIT ? OFFSET ?
      `).all(...params, pageSize, offset);
      return send(res, 200, { items, total, page, pageSize });
    }

    const labPath = p.match(/^\/api\/admin\/lab-apps\/([^/]+)$/);
    if (labPath && method === 'GET') {
      const app = db.prepare('SELECT la.*, u.email FROM lab_apps la JOIN users u ON u.id = la.user_id WHERE la.id = ?').get(labPath[1]);
      if (!app) return send(res, 404, { error: 'not_found' });
      return send(res, 200, { app });
    }
    if (labPath && method === 'PATCH') {
      const body = await readJson(req);
      const app = db.prepare('SELECT * FROM lab_apps WHERE id = ?').get(labPath[1]);
      if (!app) return send(res, 404, { error: 'not_found' });
      const name = body.name !== undefined ? str(body.name, 120) : app.name;
      const visibility = body.visibility !== undefined ? str(body.visibility, 20) : app.visibility;
      if (!['private', 'public'].includes(visibility)) return send(res, 400, { error: 'invalid_visibility' });
      db.prepare('UPDATE lab_apps SET name = ?, visibility = ?, updated_at = ? WHERE id = ?').run(name, visibility, now(), app.id);
      audit(session, 'lab.updated', 'lab_app', app.id, { before: { name: app.name, visibility: app.visibility }, after: { name, visibility } }, req);
      return send(res, 200, { ok: true });
    }
    if (labPath && method === 'DELETE') {
      const app = db.prepare('SELECT * FROM lab_apps WHERE id = ?').get(labPath[1]);
      if (!app) return send(res, 404, { error: 'not_found' });
      transaction(() => {
        db.prepare('DELETE FROM lab_apps WHERE id = ?').run(app.id);
        audit(session, 'lab.deleted', 'lab_app', app.id, { user_id: app.user_id, slug: app.slug, name: app.name }, req);
      });
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/calendar' && method === 'GET') {
      const { page, pageSize, offset } = pageParams(url);
      const userId = str(url.searchParams.get('userId'), 80);
      const from = str(url.searchParams.get('from'), 40);
      const to = str(url.searchParams.get('to'), 40);
      const clauses = [];
      const params = [];
      if (userId) { clauses.push('ce.user_id = ?'); params.push(userId); }
      if (from) { clauses.push('ce.event_date >= ?'); params.push(from); }
      if (to) { clauses.push('ce.event_date <= ?'); params.push(to); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const total = totalOf(`SELECT COUNT(*) AS c FROM calendar_events ce JOIN users u ON u.id = ce.user_id ${where}`, params);
      const items = db.prepare(`
        SELECT ce.*, u.email FROM calendar_events ce JOIN users u ON u.id = ce.user_id ${where}
        ORDER BY ce.event_date DESC LIMIT ? OFFSET ?
      `).all(...params, pageSize, offset);
      return send(res, 200, { items, total, page, pageSize });
    }
    const calendarPath = p.match(/^\/api\/admin\/calendar\/([^/]+)$/);
    if (calendarPath && method === 'DELETE') {
      const event = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(calendarPath[1]);
      if (!event) return send(res, 404, { error: 'not_found' });
      db.prepare('DELETE FROM calendar_events WHERE id = ?').run(event.id);
      audit(session, 'calendar.deleted', 'calendar_event', event.id, { user_id: event.user_id, title: event.title }, req);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/attempts' && method === 'GET') {
      const { page, pageSize, offset } = pageParams(url);
      const userId = str(url.searchParams.get('userId'), 80);
      const prepId = str(url.searchParams.get('prepId'), 80);
      const clauses = [];
      const params = [];
      if (userId) { clauses.push('a.user_id = ?'); params.push(userId); }
      if (prepId) { clauses.push('a.prep_id = ?'); params.push(prepId); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const total = totalOf(`SELECT COUNT(*) AS c FROM attempts a JOIN users u ON u.id = a.user_id ${where}`, params);
      const items = db.prepare(`
        SELECT a.*, u.email, p.title AS prep_title
        FROM attempts a JOIN users u ON u.id = a.user_id LEFT JOIN preps p ON p.id = a.prep_id
        ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?
      `).all(...params, pageSize, offset);
      return send(res, 200, { items, total, page, pageSize });
    }
    const attemptPath = p.match(/^\/api\/admin\/attempts\/([^/]+)$/);
    if (attemptPath && method === 'DELETE') {
      const attempt = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attemptPath[1]);
      if (!attempt) return send(res, 404, { error: 'not_found' });
      db.prepare('DELETE FROM attempts WHERE id = ?').run(attempt.id);
      audit(session, 'attempt.deleted', 'attempt', attempt.id, { user_id: attempt.user_id, prep_id: attempt.prep_id }, req);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/parent-links' && method === 'GET') {
      const { page, pageSize, offset } = pageParams(url);
      const total = totalOf('SELECT COUNT(*) AS c FROM parent_links', []);
      const items = db.prepare(`
        SELECT pl.*, pu.email AS parent_email, cu.email AS child_user_email, cp.name AS child_name
        FROM parent_links pl
        LEFT JOIN users pu ON pu.id = pl.parent_user_id
        LEFT JOIN users cu ON cu.id = pl.child_user_id
        LEFT JOIN profiles cp ON cp.user_id = pl.child_user_id
        ORDER BY pl.created_at DESC LIMIT ? OFFSET ?
      `).all(pageSize, offset);
      return send(res, 200, { items, total, page, pageSize });
    }
    const linkPath = p.match(/^\/api\/admin\/parent-links\/([^/]+)$/);
    if (linkPath && method === 'DELETE') {
      const link = db.prepare('SELECT * FROM parent_links WHERE id = ?').get(linkPath[1]);
      if (!link) return send(res, 404, { error: 'not_found' });
      db.prepare('DELETE FROM parent_links WHERE id = ?').run(link.id);
      audit(session, 'parent_link.deleted', 'parent_link', link.id, { parent_user_id: link.parent_user_id, child_email: link.child_email }, req);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/events' && method === 'GET') {
      const { page, pageSize, offset } = pageParams(url);
      const name = str(url.searchParams.get('name'), 80);
      const from = int(url.searchParams.get('from'), 0);
      const to = int(url.searchParams.get('to'), 0);
      const clauses = [];
      const params = [];
      if (name) { clauses.push('name LIKE ?'); params.push(`%${name}%`); }
      if (from) { clauses.push('created_at >= ?'); params.push(from); }
      if (to) { clauses.push('created_at <= ?'); params.push(to); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const total = totalOf(`SELECT COUNT(*) AS c FROM events ${where}`, params);
      const items = db.prepare(`SELECT * FROM events ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
        .all(...params, pageSize, offset)
        .map((row) => ({ ...row, props: parseJson(row.props, {}) }));
      return send(res, 200, { items, total, page, pageSize });
    }
    const eventPath = p.match(/^\/api\/admin\/events\/([^/]+)$/);
    if (eventPath && method === 'DELETE') {
      const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventPath[1]);
      if (!event) return send(res, 404, { error: 'not_found' });
      db.prepare('DELETE FROM events WHERE id = ?').run(event.id);
      audit(session, 'event.deleted', 'event', event.id, { name: event.name, user_id: event.user_id }, req);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/appearance' && method === 'GET') {
      const current = getPalette();
      return send(res, 200, { ...current, defaults: DEFAULT_PALETTE });
    }
    if (p === '/api/admin/appearance' && method === 'PUT') {
      const body = await readJson(req);
      let palette;
      try { palette = validatePalette(body.palette); } catch (error) {
        return send(res, 400, { error: 'invalid_palette', detail: error.message });
      }
      db.prepare(`
        INSERT INTO app_settings (key, value, updated_at) VALUES ('theme_palette', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(JSON.stringify(palette), now());
      audit(session, 'theme.updated', 'app_settings', 'theme_palette', {}, req);
      return send(res, 200, { palette, updatedAt: now() });
    }
    if (p === '/api/admin/appearance/reset' && method === 'POST') {
      db.prepare("DELETE FROM app_settings WHERE key = 'theme_palette'").run();
      audit(session, 'theme.reset', 'app_settings', 'theme_palette', {}, req);
      return send(res, 200, { palette: DEFAULT_PALETTE, updatedAt: null });
    }

    if (p === '/api/admin/ai/providers' && method === 'GET') {
      const items = db.prepare('SELECT * FROM ai_providers ORDER BY kind, is_default DESC, created_at ASC').all();
      return send(res, 200, { items: items.map(providerView), active: ai.describe() });
    }
    if (p === '/api/admin/ai/providers' && method === 'POST') {
      const body = await readJson(req);
      let fields;
      try { fields = validateProvider(body, null); } catch (error) {
        return send(res, 400, { error: error.message });
      }
      const id = uid();
      const apiKeyEnc = body.apiKey ? secretEncrypt(body.apiKey) : null;
      transaction(() => {
        if (fields.isDefault) db.prepare('UPDATE ai_providers SET is_default = 0 WHERE kind = ?').run(fields.kind);
        db.prepare(`
          INSERT INTO ai_providers (id, name, kind, provider, base_url, api_key_enc, model, fallback_model, reasoning_effort, enabled, is_default, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, fields.name, fields.kind, fields.provider, fields.baseUrl, apiKeyEnc, fields.model, fields.fallbackModel, fields.reasoningEffort, fields.enabled ? 1 : 0, fields.isDefault ? 1 : 0, now(), now());
        audit(session, 'ai.created', 'ai_provider', id, { name: fields.name, kind: fields.kind, provider: fields.provider }, req);
      });
      const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id);
      return send(res, 200, { provider: providerView(row) });
    }

    const aiProviderPath = p.match(/^\/api\/admin\/ai\/providers\/([^/]+)$/);
    if (aiProviderPath && method === 'PATCH') {
      const body = await readJson(req);
      const existing = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(aiProviderPath[1]);
      if (!existing) return send(res, 404, { error: 'not_found' });
      let fields;
      try { fields = validateProvider(body, existing); } catch (error) {
        return send(res, 400, { error: error.message });
      }
      const apiKeyEnc = body.clearKey ? null : (body.apiKey ? secretEncrypt(body.apiKey) : existing.api_key_enc);
      transaction(() => {
        if (fields.isDefault) db.prepare('UPDATE ai_providers SET is_default = 0 WHERE kind = ?').run(fields.kind);
        db.prepare(`
          UPDATE ai_providers SET name = ?, kind = ?, provider = ?, base_url = ?, api_key_enc = ?, model = ?, fallback_model = ?, reasoning_effort = ?, enabled = ?, is_default = ?, updated_at = ?
          WHERE id = ?
        `).run(fields.name, fields.kind, fields.provider, fields.baseUrl, apiKeyEnc, fields.model, fields.fallbackModel, fields.reasoningEffort, fields.enabled ? 1 : 0, fields.isDefault ? 1 : 0, now(), existing.id);
        audit(session, 'ai.updated', 'ai_provider', existing.id, { name: fields.name, kind: fields.kind, provider: fields.provider }, req);
      });
      const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(existing.id);
      return send(res, 200, { provider: providerView(row) });
    }
    if (aiProviderPath && method === 'DELETE') {
      const existing = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(aiProviderPath[1]);
      if (!existing) return send(res, 404, { error: 'not_found' });
      transaction(() => {
        db.prepare('DELETE FROM ai_providers WHERE id = ?').run(existing.id);
        audit(session, 'ai.deleted', 'ai_provider', existing.id, { name: existing.name, kind: existing.kind }, req);
      });
      return send(res, 200, { ok: true });
    }

    const aiDefault = p.match(/^\/api\/admin\/ai\/providers\/([^/]+)\/default$/);
    if (aiDefault && method === 'POST') {
      const existing = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(aiDefault[1]);
      if (!existing) return send(res, 404, { error: 'not_found' });
      transaction(() => {
        saveProviderDefault(existing.id, existing.kind);
        audit(session, 'ai.default', 'ai_provider', existing.id, { kind: existing.kind }, req);
      });
      return send(res, 200, { ok: true });
    }

    const aiTest = p.match(/^\/api\/admin\/ai\/providers\/([^/]+)\/test$/);
    if (aiTest && method === 'POST') {
      const existing = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(aiTest[1]);
      if (!existing) return send(res, 404, { error: 'not_found' });
      const result = await ai.testProvider({
        provider: existing.provider,
        baseUrl: existing.base_url,
        apiKey: secretDecrypt(existing.api_key_enc) || '',
        model: existing.model
      });
      audit(session, 'ai.tested', 'ai_provider', existing.id, { ok: result.ok, status: result.status || null }, req);
      return send(res, 200, result);
    }

    if (p === '/api/admin/ai/status' && method === 'GET') {
      return send(res, 200, { active: ai.describe() });
    }

    return send(res, 404, { error: 'not_found' });
  }

  let secretsProvider = null;

  function secretEncrypt(value) {
    if (!secretsProvider) throw new Error('secrets_not_initialized');
    return secretsProvider.encrypt(value);
  }

  function secretDecrypt(value) {
    if (!secretsProvider) throw new Error('secrets_not_initialized');
    return secretsProvider.decrypt(value);
  }

  function handle(req, res, p, url) {
    if (p !== '/theme.css' && !p.startsWith('/api/admin/')) return false;
    Promise.resolve(routeAdmin(req, res, p, url)).catch((error) => {
      console.error('admin route error:', error);
      if (!res.headersSent) send(res, 500, { error: 'internal_error' });
      else res.end();
    });
    return true;
  }

  function init(secrets) {
    secretsProvider = secrets;
    seedAdmin();
    seedProviders();
  }

  return { handle, init, themeCss, getPalette, DEFAULT_PALETTE };
}

module.exports = { createAdmin, DEFAULT_PALETTE };
