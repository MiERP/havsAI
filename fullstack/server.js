'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');
const { createSecretStore } = require('./lib/secrets');
const { createAi } = require('./lib/ai');
const { createAdmin } = require('./admin');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.HAVS_DATA_DIR ? path.resolve(process.env.HAVS_DATA_DIR) : path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'havs.db');
const LEGACY_DB_PATH = path.join(DATA_DIR, 'astra.db');
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
  fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
}

// Minimal .env loader for fullstack/.env. Existing environment variables win.
(function loadDotEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
})();

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ALLOW_DEV_OTP = !IS_PRODUCTION && process.env.ALLOW_DEV_OTP === 'true';
const PDF_MAX_PAGES = Number(process.env.PDF_MAX_PAGES || 50);
const PDF_VISION_PAGES = Number(process.env.PDF_VISION_PAGES || 3);
const PDF_VISION_CONCURRENCY = Number(process.env.PDF_VISION_CONCURRENCY || 2);
const CHAT_MAX_TOKENS = Number(process.env.CHAT_MAX_TOKENS || 4096);
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 20);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const MAX_UPLOAD_BODY = Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 65536;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY, role TEXT, name TEXT, age INTEGER, country TEXT, locale TEXT,
  subjects TEXT, voice TEXT, goal TEXT, exam_date TEXT, onboarding_step INTEGER DEFAULT 0,
  onboarding_done INTEGER DEFAULT 0, plan TEXT DEFAULT 'free', usage_minutes INTEGER DEFAULT 0,
  usage_limit INTEGER DEFAULT 30, theme TEXT DEFAULT 'dark', child_email TEXT, school TEXT,
  class_name TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, subject TEXT, title TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
  image_url TEXT, tools_json TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, filename TEXT, mime TEXT, path TEXT,
  page_count INTEGER, extracted_text TEXT, extracted_kind TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS preps (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, subject TEXT, exam_date TEXT,
  status TEXT DEFAULT 'draft', plan_json TEXT, updated_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS parent_links (
  id TEXT PRIMARY KEY, parent_user_id TEXT NOT NULL, child_user_id TEXT, child_email TEXT NOT NULL,
  status TEXT DEFAULT 'active', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, name TEXT, props TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, prep_id TEXT, kind TEXT, item_id TEXT,
  answers_json TEXT, details_json TEXT, score INTEGER DEFAULT 0, total INTEGER DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, event_date TEXT, kind TEXT,
  prep_id TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lab_apps (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, slug TEXT UNIQUE, name TEXT, prompt TEXT,
  html TEXT, visibility TEXT DEFAULT 'private', created_at INTEGER NOT NULL, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS prep_materials (
  prep_id TEXT NOT NULL, upload_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (prep_id, upload_id)
);
CREATE INDEX IF NOT EXISTS idx_prep_materials ON prep_materials(prep_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_calendar_user ON calendar_events(user_id, event_date);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, created_at);
`);

function ensureColumn(table, column, definition) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`); } catch {}
}
ensureColumn('profiles', 'child_email', 'child_email TEXT');
ensureColumn('profiles', 'school', 'school TEXT');
ensureColumn('profiles', 'class_name', 'class_name TEXT');
ensureColumn('profiles', 'settings_json', 'settings_json TEXT');
ensureColumn('profiles', 'study_time', 'study_time TEXT');
ensureColumn('profiles', 'interests', 'interests TEXT');
ensureColumn('profiles', 'notifications', 'notifications INTEGER DEFAULT 1');
ensureColumn('messages', 'tools_json', 'tools_json TEXT');
ensureColumn('preps', 'plan_json', 'plan_json TEXT');
ensureColumn('preps', 'updated_at', 'updated_at INTEGER');
ensureColumn('preps', 'material_upload_id', 'material_upload_id TEXT');
ensureColumn('preps', 'plan_days', 'plan_days INTEGER');
try {
  db.exec(`INSERT OR IGNORE INTO prep_materials (prep_id, upload_id, created_at)
    SELECT id, material_upload_id, COALESCE(created_at, 0) FROM preps WHERE material_upload_id IS NOT NULL`);
} catch {}
ensureColumn('preps', 'source', 'source TEXT');
ensureColumn('preps', 'share_id', 'share_id TEXT');
ensureColumn('preps', 'school', 'school TEXT');
ensureColumn('preps', 'curriculum', 'curriculum TEXT');
ensureColumn('preps', 'lessons_json', 'lessons_json TEXT');
ensureColumn('preps', 'challenges_json', 'challenges_json TEXT');
ensureColumn('preps', 'mock_json', 'mock_json TEXT');
ensureColumn('preps', 'mastery_json', 'mastery_json TEXT');
ensureColumn('preps', 'source_share_id', 'source_share_id TEXT');
ensureColumn('uploads', 'extracted_text', 'extracted_text TEXT');
ensureColumn('uploads', 'extracted_kind', 'extracted_kind TEXT');
ensureColumn('uploads', 'page_count', 'page_count INTEGER');
ensureColumn('attempts', 'details_json', 'details_json TEXT');

const realtimeClients = new Map();

const otpCodes = new Map();
const now = () => Date.now();
const uid = () => crypto.randomUUID();
const token = () => crypto.randomBytes(24).toString('hex');

async function deliverOtp(req, email, code) {
  const text = `Mã đăng nhập havsAI của bạn là ${code}. Mã có hiệu lực trong 5 phút.`;
  const from = process.env.OTP_FROM_EMAIL;
  if (process.env.SMTP_URL && from) {
    try {
      const nodemailer = require('nodemailer');
      const transport = nodemailer.createTransport(process.env.SMTP_URL);
      await transport.sendMail({ from, to: email, subject: 'Mã đăng nhập havsAI', text });
      return { ok: true };
    } catch (error) {
      console.error('OTP SMTP error:', error.message);
      return { ok: false, error: 'email_send_failed' };
    }
  }
  if (process.env.RESEND_API_KEY && from) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: email, subject: 'Mã đăng nhập havsAI', text }),
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) {
        console.error('OTP email error:', response.status);
        return { ok: false, error: 'email_send_failed' };
      }
      return { ok: true };
    } catch (error) {
      console.error('OTP email error:', error.message);
      return { ok: false, error: 'email_send_failed' };
    }
  }
  const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  if (!IS_PRODUCTION && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) {
    console.log('OTP', email, code);
    return { ok: true };
  }
  return { ok: false, error: 'email_not_configured' };
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(data);
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function secureCookie(req) {
  if (process.env.COOKIE_SECURE !== undefined) return process.env.COOKIE_SECURE === 'true';
  if (req.socket && req.socket.encrypted) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (proto === 'https') return true;
  if (proto === 'http') return false;
  const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  return !['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); } catch { throw new Error('invalid_json'); }
}

const secrets = createSecretStore(DATA_DIR);
const ai = createAi({ db, secrets });
const admin = createAdmin({
  db, send, readJson, parseCookies, secureCookie, now, uid,
  dataDir: DATA_DIR, uploadDir: UPLOAD_DIR, ai
});
admin.init(secrets);

function currentUser(req) {
  const cookies = parseCookies(req);
  const value = cookies.havs_session || cookies.astra_session;
  if (!value) return null;
  const row = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(value);
  if (!row) return null;
  const user = db.prepare('SELECT id, email, created_at, disabled, deleted_at FROM users WHERE id = ?').get(row.user_id);
  if (!user || user.disabled || user.deleted_at) return null;
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id);
  return { user, profile };
}

function requireUser(req, res) {
  const ctx = currentUser(req);
  if (!ctx) { send(res, 401, { error: 'unauthorized' }); return null; }
  return ctx;
}

function publicProfile(profile) {
  if (!profile) return null;
  return {
    role: profile.role,
    name: profile.name,
    age: profile.age,
    country: profile.country,
    locale: profile.locale,
    subjects: profile.subjects ? JSON.parse(profile.subjects) : [],
    voice: profile.voice,
    goal: profile.goal,
    examDate: profile.exam_date,
    onboardingStep: profile.onboarding_step,
    onboardingDone: !!profile.onboarding_done,
    childEmail: profile.child_email,
    school: profile.school,
    className: profile.class_name,
    plan: profile.plan,
    usageMinutes: profile.usage_minutes,
    usageLimit: profile.usage_limit,
    theme: profile.theme,
    studyTime: profile.study_time,
    interests: profile.interests ? parseJsonValue(profile.interests, []) : [],
    notifications: profile.notifications !== 0,
    settings: parseJsonValue(profile.settings_json, {})
  };
}

const SUBJECTS = ['math', 'physics', 'chemistry', 'biology', 'english', 'literature', 'history', 'geography', 'cs'];
const VOICES = [
  { id: 'neil', name: 'Nam Minh (Tiếng Việt · Nam)', locale: 'vi-VN', gender: 'male' },
  { id: 'aria', name: 'Hoài My (Tiếng Việt · Nữ)', locale: 'vi-VN', gender: 'female' },
  { id: 'minh', name: 'Quốc Anh (Tiếng Việt · Nam)', locale: 'vi-VN', gender: 'male' },
  { id: 'lena', name: 'Thanh Hà (Tiếng Việt · Nữ)', locale: 'vi-VN', gender: 'female' }
];

function splitTtsChunks(text, maxLen = 170) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1600);
  if (!cleaned) return [];
  const rawParts = cleaned.split(/(?<=[.!?।;:\n])\s+|(?<=,\s)/);
  const chunks = [];
  let current = '';
  for (const part of rawParts) {
    if (!part) continue;
    if ((current + ' ' + part).trim().length <= maxLen) {
      current = (current + ' ' + part).trim();
    } else {
      if (current) chunks.push(current);
      if (part.length <= maxLen) {
        current = part;
      } else {
        for (let i = 0; i < part.length; i += maxLen) {
          chunks.push(part.slice(i, i + maxLen));
        }
        current = '';
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, 10);
}

async function synthesizeChunk(chunk) {
  const ttsUrl = `https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=${encodeURIComponent(chunk)}`;
  const response = await fetch(ttsUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`tts_http_${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function synthesizeVietnameseMp3(text) {
  const chunks = splitTtsChunks(text);
  if (!chunks.length) return null;
  const buffers = [];
  for (const chunk of chunks) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        buffers.push(await synthesizeChunk(chunk));
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (lastError) throw lastError;
  }
  return Buffer.concat(buffers);
}

function touchUsage(userId) {
  db.prepare('UPDATE profiles SET usage_minutes = usage_minutes + 1, updated_at = ? WHERE user_id = ?').run(now(), userId);
  return db.prepare('SELECT plan, usage_minutes, usage_limit FROM profiles WHERE user_id = ?').get(userId);
}

function mockReply(subject, text) {
  const s = (subject || 'math').toLowerCase();
  if (/hi|hello|chào|xin chào/i.test(text)) {
    return `Chào bạn! Mình là havsAI, gia sư AI của bạn. Hôm nay bạn muốn học môn gì? Mình có thể giải thích từng bước, luyện đề hoặc tóm tắt kiến thức.`;
  }
  if (s === 'math') {
    return `Cùng giải từng bước nhé.\n\n1. Xác định dữ kiện và đại lượng cần tìm.\n2. Chọn công thức phù hợp.\n3. Thay số và tính toán cẩn thận.\n4. Kiểm tra lại kết quả và đơn vị.\n\nVới câu hỏi "${text.slice(0, 120)}", bạn cho mình biết bạn đang học lớp mấy và đang dùng công thức nào, mình sẽ đi chi tiết hơn.`;
  }
  if (s === 'physics') {
    return `Mình sẽ chia bài này thành 3 phần: hiện tượng, định luật liên quan, và các bước tính.\n\n- Tóm tắt đề: ${text.slice(0, 120)}\n- Công thức gợi ý: chọn định luật bảo toàn hoặc phương trình chuyển động phù hợp.\n- Bạn gửi thêm số liệu (khối lượng, vận tốc, thời gian) để mình thay số giúp nhé.`;
  }
  if (s === 'chemistry') {
    return `Với hóa học, mình sẽ đi theo: xác định chất, viết phương trình, cân bằng, rồi tính theo mol.\n\nBạn gửi đề đầy đủ hoặc ảnh chụp để mình đọc số liệu chính xác nhé.`;
  }
  return `Mình đã đọc câu hỏi của bạn. Để trả lời sát nhất, mình sẽ:\n1. Tóm tắt yêu cầu.\n2. Chỉ ra kiến thức trọng tâm.\n3. Hướng dẫn từng bước.\n4. Đưa ví dụ tương tự để bạn tự luyện.\n\nBạn muốn mình đi nhanh hay giải thích kỹ từng bước?`;
}

function parentChildren(parentUserId) {
  const links = db.prepare('SELECT * FROM parent_links WHERE parent_user_id = ? ORDER BY created_at DESC').all(parentUserId);
  return links.map((link) => {
    let child = null;
    if (link.child_user_id) {
      const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(link.child_user_id);
      const profile = db.prepare('SELECT name, role, usage_minutes FROM profiles WHERE user_id = ?').get(link.child_user_id);
      if (user) {
        child = {
          id: user.id,
          email: user.email,
          name: profile?.name || 'Học sinh',
          usageMinutes: profile?.usage_minutes || 0,
          chats: db.prepare('SELECT COUNT(*) AS c FROM chats WHERE user_id = ?').get(user.id).c,
          preps: db.prepare('SELECT COUNT(*) AS c FROM preps WHERE user_id = ?').get(user.id).c
        };
      }
    }
    return { id: link.id, email: link.child_email, status: link.child_user_id ? 'linked' : 'pending', child };
  });
}

function fallbackPlan(prep) {
  const subject = prep.subject || 'math';
  return {
    title: prep.title || `Ôn tập ${subject}`,
    subject,
    examDate: prep.exam_date || '',
    summary: 'Kế hoạch 5 ngày tập trung vào kiến thức trọng tâm, luyện đề và sửa lỗi sai.',
    days: [
      { day: 1, focus: 'Kiến thức nền', tasks: ['Hệ thống công thức trọng tâm', 'Làm 10 câu cơ bản', 'Ghi lại lỗi sai'] },
      { day: 2, focus: 'Dạng bài thường gặp', tasks: ['Luyện 15 câu theo dạng', 'Tóm tắt phương pháp', 'Hỏi havsAI chỗ chưa hiểu'] },
      { day: 3, focus: 'Đề tổng hợp', tasks: ['Làm 1 đề 45 phút', 'Chấm và phân loại lỗi', 'Ôn lại phần yếu'] },
      { day: 4, focus: 'Tăng tốc', tasks: ['Làm đề tính giờ', 'Sửa lỗi lặp lại', 'Ghi chú mẹo làm nhanh'] },
      { day: 5, focus: 'Tổng duyệt', tasks: ['Xem lại sổ tay lỗi', 'Làm 1 đề nhẹ', 'Nghỉ ngơi đủ giấc'] }
    ],
    practice: [
      { question: 'Nêu 3 công thức quan trọng nhất của chủ đề này.', answer: 'Tự viết lại và kiểm tra với havsAI.' },
      { question: 'Làm một câu vận dụng trong đề mẫu.', answer: 'So sánh từng bước với lời giải.' }
    ],
    tips: ['Học 25 phút, nghỉ 5 phút', 'Ghi lỗi sai vào một nơi duy nhất', 'Hỏi havsAI ngay khi bí quá 5 phút']
  };
}

const PLAN_SCHEMA =
  '{"version":2,"title":string,"subject":string,"examDate":string,"summary":string,"topics":[string],' +
  '"days":[{"day":number,"focus":string,"topics":[string],"tasks":[string],' +
  '"lesson":{"intro":string,"sections":[{"heading":string,"body":string}],' +
  '"example":{"problem":string,"steps":[string],"answer":string}},' +
  '"practice":[{"question":string,"answer":string}]}],' +
  '"practice":[{"question":string,"answer":string}],"tips":[string]}';

const PLAN_SYSTEM =
  'Bạn là havsAI, chuyên gia lập kế hoạch và soạn bài ôn thi cho học sinh Việt Nam. ' +
  'Chỉ trả về một đối tượng JSON hợp lệ, không kèm markdown hay giải thích. Schema: ' +
  PLAN_SCHEMA +
  '. Viết công thức bằng LaTeX trong $...$ (ví dụ $\\frac{1}{2}$, $x^{2}$, $v = \\frac{s}{t}$), không dùng ảnh.';

function resolvePlanDays(prep, materialCount) {
  const explicit = Number(prep.plan_days);
  if (Number.isFinite(explicit) && explicit >= 3 && explicit <= 14) return Math.round(explicit);
  const base = Math.min(14, Math.max(5, 3 + Math.max(1, materialCount) * 2));
  const exam = prep.exam_date ? new Date(prep.exam_date) : null;
  if (exam && !Number.isNaN(exam.getTime())) {
    const daysLeft = Math.ceil((exam.getTime() - Date.now()) / 86400000);
    if (daysLeft >= 2) return Math.min(base, Math.min(14, daysLeft));
  }
  return base;
}

function buildPlanPrompt(prep, materialName, materialText, days) {
  const lines = [
    `Môn: ${prep.subject || 'chung'}`,
    `Tên kỳ ôn: ${prep.title || ''}`,
    `Ngày thi: ${prep.exam_date || 'chưa rõ'}`
  ];
  if (materialText) {
    lines.push(
      `Tài liệu của học sinh (${materialName || 'tài liệu tải lên'}):`,
      materialText,
      'Yêu cầu: bám sát tài liệu trên. Mỗi ngày lấy 1-2 chủ đề thật sự có trong tài liệu và trải đều toàn bộ tài liệu cho đủ số ngày.'
    );
  } else {
    lines.push('Không có tài liệu đính kèm: dựa vào chuẩn kiến thức phổ thông của môn này.');
  }
  const perDay = days > 7
    ? '1 mục sections ngắn (tối đa 3 câu) và 1 câu practice'
    : '2 mục sections (heading và body giải thích, có công thức LaTeX) và 2 câu practice (question và answer)';
  lines.push(
    `Tạo đúng ${days} ngày (day = 1..${days}). Mỗi ngày: 1-2 chủ đề, 3-5 nhiệm vụ, và một bài học tự học gồm intro 2-3 câu, ` +
    `${perDay}, một ví dụ có problem, steps, answer. Cuối cùng thêm 3 câu luyện tập tổng và 3 mẹo. ` +
    'Viết ngắn gọn để vừa 8000 token.'
  );
  return lines.join('\n');
}

async function generatePrepPlan(prep, userId) {
  let error = '';
  const materialNames = [];
  const materialParts = [];
  const materialIds = prepMaterialIds(prep);
  const budget = materialIds.length > 1 ? Math.floor(24000 / materialIds.length) : 14000;
  for (const uploadId of materialIds) {
    try {
      const row = findUpload(userId, uploadId);
      if (!row) continue;
      materialNames.push(row.filename || 'tài liệu');
      const material = /^image\//i.test(row.mime || '')
        ? await analyzeImageUpload(userId, uploadId)
        : await extractUploadText(userId, uploadId);
      if (material?.text) {
        materialParts.push(`--- ${row.filename || 'tài liệu'} ---\n${String(material.text).slice(0, Math.max(3000, budget))}`);
      }
    } catch (cause) {
      error = `material_${cause.message}`;
    }
  }
  const materialText = materialParts.join('\n\n').slice(0, 24000);
  const materialName = materialNames.join(', ');
  const days = resolvePlanDays(prep, materialIds.length);

  const prompt = buildPlanPrompt(prep, materialName, materialText, days);
  let result = await callModelJson(PLAN_SYSTEM, prompt, { maxTokens: 8000 });
  let plan = parseJsonLoose(result.content);
  if (!plan || !Array.isArray(plan.days) || !plan.days.length) {
    const retry = await callModelJson(
      PLAN_SYSTEM,
      prompt + '\n\nLần trả lời trước bị lỗi hoặc bị cắt. Hãy trả về JSON hợp lệ và NGẮN HƠN: mỗi sections body tối đa 2 câu, mỗi trường tối đa 40 từ.',
      { maxTokens: 8000 }
    );
    const retryPlan = parseJsonLoose(retry.content);
    if (retryPlan && Array.isArray(retryPlan.days) && retryPlan.days.length) {
      plan = retryPlan;
      result = retry;
    } else if (retry.error) {
      result = retry;
    }
  }
  if (result.error) error = result.error;
  const usedAi = Boolean(plan && Array.isArray(plan.days) && plan.days.length);
  if (usedAi) {
    plan.version = 2;
    plan.days = plan.days.slice(0, days);
    plan.plannedDays = days;
  } else {
    if (!error) {
      error = result.finish === 'length'
        ? 'truncated'
        : `invalid_json_${String(result.content || '').length}`;
    }
    plan = fallbackPlan(prep);
  }
  plan.generatedBy = usedAi ? 'ai' : 'fallback';
  if (materialName) plan.materialName = materialName;
  if (!usedAi && error) plan.error = String(error).slice(0, 160);
  return { plan, usedAi };
}

function buildLessonFromDay(day, index, fallbackPractice) {
  const lesson = day.lesson && typeof day.lesson === 'object' ? day.lesson : {};
  const intro = typeof lesson.intro === 'string' ? lesson.intro : '';
  const sections = Array.isArray(lesson.sections)
    ? lesson.sections.filter((section) => section && (section.heading || section.body))
    : [];
  const example = lesson.example && typeof lesson.example === 'object' && (lesson.example.problem || lesson.example.steps)
    ? lesson.example
    : null;
  let practice = Array.isArray(day.practice)
    ? day.practice.filter((item) => item && item.question)
    : [];
  if (!practice.length && Array.isArray(fallbackPractice)) {
    const pool = fallbackPractice.filter((item) => item && item.question);
    practice = pool.slice(index, index + 2);
    if (!practice.length) practice = pool.slice(0, 2);
  }
  const content = [
    intro,
    ...sections.map((section) => `${section.heading ? `${section.heading}: ` : ''}${section.body || ''}`)
  ].filter(Boolean).join('\n\n') || (day.tasks || []).map((task) => `• ${task}`).join('\n');
  return {
    id: `lesson-${index + 1}`,
    title: `Ngày ${day.day || index + 1}: ${day.focus || 'Ôn tập'}`,
    focus: day.focus || '',
    topics: Array.isArray(day.topics) ? day.topics : [],
    intro,
    sections,
    example,
    practice,
    content,
    tasks: day.tasks || [],
    done: false
  };
}

function currentProviderConfig() {
  return ai.resolve('chat');
}

function decodeEntities(text) {
  return String(text)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function normalizeResultUrl(href) {
  let value = href.startsWith('//') ? `https:${href}` : href;
  try {
    const url = new URL(value);
    const target = url.searchParams.get('uddg');
    if (target) return decodeURIComponent(target);
  } catch {}
  return value;
}

async function webSearch(query) {
  const q = String(query || '').slice(0, 200).trim();
  if (!q) return [];
  const results = [];
  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/152 Mobile Safari/537.36' },
      signal: AbortSignal.timeout(9000)
    });
    if (response.ok) {
      const html = await response.text();
      const anchor = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      const snippets = [...html.matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => decodeEntities(m[1]));
      let match;
      let index = 0;
      while ((match = anchor.exec(html)) && results.length < 5) {
        results.push({ title: decodeEntities(match[2]).slice(0, 160), url: normalizeResultUrl(match[1]), snippet: (snippets[index++] || '').slice(0, 300) });
      }
    }
  } catch {}
  if (!results.length) {
    try {
      const response = await fetch(`https://vi.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&utf8=1&srlimit=5`, { signal: AbortSignal.timeout(8000) });
      if (response.ok) {
        const json = await response.json();
        for (const item of json?.query?.search || []) {
          results.push({ title: item.title, url: `https://vi.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`, snippet: decodeEntities(item.snippet).slice(0, 300) });
        }
      }
    } catch {}
  }
  return results.slice(0, 5);
}

function extractPdfText(buffer) {
  const raw = buffer.toString('latin1');
  const chunks = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let stream;
  while ((stream = streamRe.exec(raw)) && chunks.join('').length < 12000) {
    const data = Buffer.from(stream[1], 'latin1');
    let decoded = '';
    try { decoded = zlib.inflateSync(data).toString('latin1'); }
    catch { try { decoded = zlib.inflateRawSync(data).toString('latin1'); } catch { continue; } }
    const strings = [];
    const textRe = /\((?:\\.|[^\\()])*\)\s*Tj|\[(?:[^\]]*)\]\s*TJ/g;
    let match;
    while ((match = textRe.exec(decoded))) strings.push(match[0]);
    if (strings.length) chunks.push(strings.join(' '));
  }
  return chunks.join('\n').replace(/\\[nrtbf]/g, ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 10000);
}

let pdfjsPromise = null;
let canvasLib = null;

async function getPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

function getCanvas() {
  if (!canvasLib) canvasLib = require('@napi-rs/canvas');
  return canvasLib;
}

async function openPdf(buffer) {
  const pdfjs = await getPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false });
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('pdf_timeout')), 30000);
  });
  try {
    return await Promise.race([task.promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function countPdfPages(buffer) {
  let doc = null;
  try {
    doc = await openPdf(buffer);
    return { pages: doc.numPages, encrypted: false };
  } catch (error) {
    if (String(error?.name || '').includes('Password')) return { pages: 0, encrypted: true };
    throw error;
  } finally {
    try { await doc?.destroy(); } catch {}
  }
}

async function readPdfText(buffer) {
  let doc = null;
  try {
    doc = await openPdf(buffer);
    const pages = doc.numPages;
    const limit = Math.min(pages, PDF_MAX_PAGES);
    const chunks = [];
    for (let i = 1; i <= limit; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
      if (text) chunks.push(`--- Trang ${i} ---\n${text}`);
    }
    return { pages, text: chunks.join('\n\n').slice(0, 30000) };
  } finally {
    try { await doc?.destroy(); } catch {}
  }
}

async function renderPdfPage(buffer, pageNumber, scale = 2) {
  let doc = null;
  try {
    doc = await openPdf(buffer);
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const { createCanvas } = getCanvas();
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas.toBuffer('image/png');
  } finally {
    try { await doc?.destroy(); } catch {}
  }
}

function findUpload(userId, ref) {
  if (!ref) return null;
  const value = String(ref);
  return value.startsWith('/uploads/')
    ? db.prepare('SELECT * FROM uploads WHERE user_id = ? AND path LIKE ?').get(userId, `%${path.basename(value)}`)
    : db.prepare('SELECT * FROM uploads WHERE user_id = ? AND id = ?').get(userId, value);
}

function cacheUploadText(row, text, kind) {
  try {
    db.prepare('UPDATE uploads SET extracted_text = ?, extracted_kind = ? WHERE id = ?').run(text, kind, row.id);
  } catch {}
}

async function visionExtract(base64, mime) {
  const configs = typeof ai.resolveAll === 'function' ? ai.resolveAll('vision') : [ai.resolve('vision')].filter(Boolean);
  if (!configs.length) return null;
  const prompt = 'Bạn là bộ OCR cho một gia sư. Hãy: 1) mô tả ngắn gọn ảnh; ' +
    '2) chép lại TOÀN BỘ chữ nhìn thấy, giữ công thức dưới dạng LaTeX; ' +
    '3) đánh dấu [không chắc] ở chỗ mờ hoặc không đọc được. Không giải bài. Trả lời tiếng Việt.';
  for (const config of configs) {
    if (!config?.apiKey) continue;
    const models = [...new Set([config.model, config.fallbackModel].filter(Boolean))];
    for (const model of models) {
      try {
        const body = {
          model,
          stream: false,
          max_tokens: 1500,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }
            ]
          }]
        };
        if (config.reasoningEffort && config.provider === 'commandcode') {
          body.reasoning_effort = config.reasoningEffort;
        }
        const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify(body)
        });
        if (!response.ok) continue;
        const json = await response.json();
        const message = json.choices?.[0]?.message || {};
        const text = String(message.content || message.reasoning_content || '').trim();
        if (text) return { text, model };
      } catch {}
    }
  }
  return null;
}

async function analyzeImageUpload(userId, ref) {
  const row = findUpload(userId, ref);
  if (!row || !row.path || !fs.existsSync(row.path)) return null;
  if (row.extracted_kind === 'vision' && row.extracted_text) {
    return { filename: row.filename, text: row.extracted_text, model: 'cache' };
  }
  if (!/^image\//i.test(row.mime || '')) return null;
  const buffer = fs.readFileSync(row.path);
  if (buffer.length > 8 * 1024 * 1024) return null;
  const result = await visionExtract(buffer.toString('base64'), row.mime);
  if (!result) return null;
  cacheUploadText(row, result.text, 'vision');
  return { filename: row.filename, text: result.text, model: result.model };
}

async function analyzePdfUpload(userId, ref) {
  const row = findUpload(userId, ref);
  if (!row || !row.path || !fs.existsSync(row.path)) return null;
  if (row.extracted_text && (row.extracted_kind === 'pdf' || row.extracted_kind === 'pdf+vision')) {
    const pages = row.page_count || 0;
    return {
      filename: row.filename,
      text: row.extracted_text,
      pages,
      scanned: row.extracted_kind === 'pdf+vision',
      visionPages: row.extracted_kind === 'pdf+vision'
        ? Array.from({ length: Math.min(pages, PDF_VISION_PAGES) }, (_, index) => index + 1)
        : []
    };
  }
  const buffer = fs.readFileSync(row.path);
  let parsed = null;
  try {
    parsed = await readPdfText(buffer);
  } catch {}
  if (!parsed) {
    const heuristic = extractPdfText(buffer);
    if (!heuristic) return null;
    cacheUploadText(row, heuristic, 'pdf');
    return { filename: row.filename, text: heuristic, pages: 0, scanned: true, visionPages: [] };
  }
  const threshold = Math.max(40, parsed.pages * 20);
  if (parsed.text.length >= threshold) {
    cacheUploadText(row, parsed.text, 'pdf');
    db.prepare('UPDATE uploads SET page_count = ? WHERE id = ?').run(parsed.pages, row.id);
    return { filename: row.filename, text: parsed.text, pages: parsed.pages, scanned: false, visionPages: [] };
  }
  const pageLimit = Math.min(parsed.pages, PDF_VISION_PAGES);
  const chunks = [];
  const visionPages = [];
  for (let start = 1; start <= pageLimit; start += PDF_VISION_CONCURRENCY) {
    const batch = [];
    for (let pageNumber = start; pageNumber < start + PDF_VISION_CONCURRENCY && pageNumber <= pageLimit; pageNumber++) {
      batch.push(pageNumber);
    }
    const results = await Promise.all(batch.map(async (pageNumber) => {
      try {
        const png = await renderPdfPage(buffer, pageNumber, 2);
        const vision = await visionExtract(png.toString('base64'), 'image/png');
        return vision ? { pageNumber, text: vision.text } : null;
      } catch {
        return null;
      }
    }));
    for (const result of results) {
      if (!result) continue;
      chunks.push(`--- Trang ${result.pageNumber} (vision) ---\n${result.text}`);
      visionPages.push(result.pageNumber);
    }
  }
  const text = chunks.join('\n\n') || parsed.text;
  cacheUploadText(row, text, visionPages.length ? 'pdf+vision' : 'pdf');
  db.prepare('UPDATE uploads SET page_count = ? WHERE id = ?').run(parsed.pages, row.id);
  return { filename: row.filename, text, pages: parsed.pages, scanned: visionPages.length > 0, visionPages };
}

async function extractUploadText(userId, ref) {
  const row = findUpload(userId, ref);
  if (!row || !row.path || !fs.existsSync(row.path)) return null;
  if (/pdf/i.test(row.mime || '') || /\.pdf$/i.test(row.filename)) {
    return analyzePdfUpload(userId, ref);
  }
  if (row.extracted_text && row.extracted_kind === 'text') {
    return { filename: row.filename, text: row.extracted_text };
  }
  try {
    const buffer = fs.readFileSync(row.path);
    if (/^text\//i.test(row.mime) || /\.(txt|md|csv)$/i.test(row.filename)) {
      const text = buffer.toString('utf8').slice(0, 10000);
      cacheUploadText(row, text, 'text');
      return { filename: row.filename, text };
    }
  } catch {}
  return null;
}

function parseJsonLoose(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

async function callModelJson(system, user, options = {}) {
  const configs = typeof ai.resolveAll === 'function' ? ai.resolveAll('chat') : [currentProviderConfig()].filter(Boolean);
  let lastError = '';
  for (const config of configs) {
    if (!config?.apiKey) continue;
    const models = [...new Set([config.model, config.fallbackModel].filter(Boolean))];
    for (const model of models) {
      const endpoint = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
      const base = {
        model,
        stream: false,
        max_tokens: options.maxTokens || 3000,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
      };
      const attempts = [{ ...base, response_format: { type: 'json_object' } }];
      if (config.provider === 'commandcode') {
        attempts[0].reasoning_effort = 'off';
        attempts.push({ ...base, reasoning_effort: 'off' });
      }
      attempts.push(base);
      for (const request of attempts) {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
            body: JSON.stringify(request),
            signal: AbortSignal.timeout(90000)
          });
          if (!response.ok) {
            lastError = `http_${response.status}`;
            continue;
          }
          const json = await response.json();
          const content = String(json?.choices?.[0]?.message?.content || '').trim();
          if (content) return { content, error: '', model, finish: json?.choices?.[0]?.finish_reason || '' };
          lastError = 'empty_content';
        } catch (error) {
          lastError = error.name === 'TimeoutError' ? 'timeout' : error.message;
        }
      }
    }
  }
  return { content: null, error: lastError || 'no_provider' };
}

function broadcastRealtime(userId, event, data) {
  const clients = realtimeClients.get(userId);
  if (!clients) return;
  const payload = `data: ${JSON.stringify({ id: uid(), event, channel: 'user', data })}\n\n`;
  for (const client of clients) {
    try { client.write(payload); } catch {}
  }
}

function shouldSearch(text) {
  return /tìm kiếm|tra cứu|search|google|tin tức|mới nhất|hôm nay|nguồn|dẫn chứng|research/i.test(text);
}

const FORMULA_RULES = [
  `FORMULAS — write every expression as LaTeX between $...$ (use $$...$$ for a standalone line):`,
  `- Fractions and division: write \\frac{a}{b}, never a/b, so they read naturally aloud.`,
  `- Powers, indices, roots: x^{2}, x_{i}, \\sqrt{x}, \\sqrt[3]{x}.`,
  `- Relations and operators: \\le, \\ge, \\ne, \\approx, \\times, \\cdot, \\pi, \\Delta, \\infty.`,
  `- Physics: keep the unit with the value, e.g. $v = \\frac{s}{t}$ (m/s), $a$ (m/s^2), $\\rho$ (kg/m^3), $\\vec{F}$, $\\Delta t$.`,
  `- Chemistry: $2H_2 + O_2 \\to 2H_2O$; reversible reactions use \\rightleftharpoons; write states as (r), (l), (k), (dd).`,
  `- Biology: $5' \\to 3'$, base pairs $A-T$ and $G-X$, ratios as \\frac.`,
  `- Use KaTeX core commands only: no \\ce{}, no align or array environments.`,
  `- Outside formulas write normal Vietnamese prose; do not spell symbols out in words instead of a formula.`
].join('\n');

async function streamChatCompletion(res, config, subject, messages, extraContext = '') {
  const endpoint = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const upstream = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      max_tokens: CHAT_MAX_TOKENS,
      messages: [
        {
          role: 'system',
          content: `You are havsAI, a friendly AI tutor for students. Current subject: ${subject || 'general'}. ` +
            'Answer in the same language as the student (usually Vietnamese). Explain step by step, use short paragraphs, ' +
            'and end with one practical next step. Do not claim to have tools or memory you do not have.\n\n' +
            FORMULA_RULES +
            (extraContext ? `\n\nUse this tool/material context when relevant:\n${extraContext}` : '')
        },
        ...messages.slice(-14)
      ]
    })
  });
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    throw new Error(`upstream_${upstream.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let finishReason = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const choice = json.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = choice?.delta?.content;
        if (delta) {
          full += delta;
          res.write(`data: ${JSON.stringify({ type: 'token', value: delta })}\n\n`);
        }
      } catch {}
    }
  }
  if (finishReason === 'length') {
    res.write(`data: ${JSON.stringify({ type: 'truncated' })}\n\n`);
  }
  return full;
}

function streamMock(res, subject, text) {
  return new Promise((resolve) => {
    const full = mockReply(subject, text);
    const parts = full.match(/\S+\s*/g) || [full];
    let index = 0;
    res.write(`data: ${JSON.stringify({ type: 'start' })}\n\n`);
    const timer = setInterval(() => {
      if (index >= parts.length) {
        clearInterval(timer);
        resolve(full);
        return;
      }
      res.write(`data: ${JSON.stringify({ type: 'token', value: parts[index++] })}\n\n`);
    }, 28);
  });
}

function parseJsonValue(value, fallback = null) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function shortId() {
  return crypto.randomBytes(6).toString('hex');
}

function ensureShareId(prep) {
  if (prep.share_id) return prep.share_id;
  const shareId = shortId();
  db.prepare('UPDATE preps SET share_id = ? WHERE id = ?').run(shareId, prep.id);
  prep.share_id = shareId;
  return shareId;
}

function ensurePrepExtras(prep) {
  const plan = parseJsonValue(prep.plan_json, null) || fallbackPlan(prep);
  let lessons = parseJsonValue(prep.lessons_json, null);
  const storedLessons = Array.isArray(lessons) ? lessons : [];
  const needsLessons = !storedLessons.length
    || (plan.version >= 2 && storedLessons.some((lesson) => !Array.isArray(lesson.sections)));
  if (needsLessons) {
    const doneIds = new Set(storedLessons.filter((lesson) => lesson.done).map((lesson) => lesson.id));
    lessons = (plan.days || []).map((day, index) => {
      const lesson = buildLessonFromDay(day, index, plan.practice);
      if (doneIds.has(lesson.id)) lesson.done = true;
      return lesson;
    });
  }
  let challenges = parseJsonValue(prep.challenges_json, null);
  if (!Array.isArray(challenges) || !challenges.length) {
    challenges = (plan.practice || []).slice(0, 4).map((item, index) => ({
      id: `challenge-${index + 1}`,
      title: `Thử thách ${index + 1}`,
      question: item.question,
      answer: item.answer || '',
      shareId: null
    }));
  }
  let mockExams = parseJsonValue(prep.mock_json, null);
  if (!Array.isArray(mockExams) || !mockExams.length) {
    const questions = (plan.practice || []).slice(0, 5).map((item, index) => ({
      id: `q${index + 1}`,
      question: item.question,
      answer: item.answer || ''
    }));
    while (questions.length < 5) {
      const n = questions.length + 1;
      questions.push({
        id: `q${n}`,
        question: `Trình bày một dạng bài trọng tâm của ${prep.title} và cách giải.`,
        answer: 'Nêu dạng bài, công thức/phương pháp và ví dụ áp dụng.'
      });
    }
    mockExams = [{
      id: 'mock-1',
      title: `Đề thi thử — ${prep.title}`,
      durationMinutes: 30,
      questions
    }];
  }
  const mastery = parseJsonValue(prep.mastery_json, null) || {};
  const attemptStats = db.prepare(
    'SELECT COUNT(*) AS count, COALESCE(AVG(CASE WHEN total > 0 THEN score * 100.0 / total ELSE 0 END), 0) AS avg FROM attempts WHERE prep_id = ? AND user_id = ?'
  ).get(prep.id, prep.user_id);
  const nextMastery = {
    completedLessons: lessons.filter((lesson) => lesson.done).length,
    totalLessons: lessons.length,
    attempts: attemptStats.count || 0,
    averageScore: Math.round(attemptStats.avg || 0),
    ...mastery
  };
  nextMastery.completedLessons = lessons.filter((lesson) => lesson.done).length;
  nextMastery.totalLessons = lessons.length;
  nextMastery.attempts = attemptStats.count || 0;
  nextMastery.averageScore = Math.round(attemptStats.avg || 0);
  db.prepare('UPDATE preps SET plan_json = ?, lessons_json = ?, challenges_json = ?, mock_json = ?, mastery_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(plan), JSON.stringify(lessons), JSON.stringify(challenges), JSON.stringify(mockExams), JSON.stringify(nextMastery), now(), prep.id);
  return {
    ...prep,
    plan_json: JSON.stringify(plan),
    lessons_json: JSON.stringify(lessons),
    challenges_json: JSON.stringify(challenges),
    mock_json: JSON.stringify(mockExams),
    mastery_json: JSON.stringify(nextMastery)
  };
}

function prepMaterialIds(prep) {
  const rows = db.prepare('SELECT upload_id FROM prep_materials WHERE prep_id = ? ORDER BY created_at').all(prep.id);
  const ids = rows.map((row) => row.upload_id).filter(Boolean);
  if (!ids.length && prep.material_upload_id) ids.push(prep.material_upload_id);
  return ids;
}

function prepMaterials(prep) {
  const ids = prepMaterialIds(prep);
  if (!ids.length) return [];
  const statement = db.prepare('SELECT id, filename, mime, page_count, extracted_kind FROM uploads WHERE user_id = ? AND id = ?');
  return ids
    .map((id) => statement.get(prep.user_id, id))
    .filter(Boolean)
    .map((row) => ({ id: row.id, filename: row.filename, mime: row.mime, pages: row.page_count, kind: row.extracted_kind || null }));
}

function prepView(prep) {
  const enriched = ensurePrepExtras(prep);
  const materials = prepMaterials(enriched);
  return {
    id: enriched.id,
    title: enriched.title,
    subject: enriched.subject,
    examDate: enriched.exam_date,
    status: enriched.status,
    shareId: enriched.share_id,
    school: enriched.school,
    curriculum: enriched.curriculum,
    createdAt: enriched.created_at,
    updatedAt: enriched.updated_at,
    plan: parseJsonValue(enriched.plan_json, null),
    planDays: enriched.plan_days || (parseJsonValue(enriched.plan_json, null)?.days || []).length || 5,
    material: materials[0] || null,
    materials,
    lessons: parseJsonValue(enriched.lessons_json, []),
    challenges: parseJsonValue(enriched.challenges_json, []),
    mockExams: parseJsonValue(enriched.mock_json, []),
    mastery: parseJsonValue(enriched.mastery_json, {})
  };
}

async function regeneratePrep(prep, userId, options = {}) {
  const requestedDays = Number(options.days);
  if (Number.isFinite(requestedDays) && requestedDays >= 3 && requestedDays <= 14) {
    const days = Math.round(requestedDays);
    db.prepare('UPDATE preps SET plan_days = ? WHERE id = ?').run(days, prep.id);
    prep = { ...prep, plan_days: days };
  }
  const previous = parseJsonValue(prep.lessons_json, []) || [];
  const doneIds = new Set(previous.filter((lesson) => lesson.done).map((lesson) => lesson.id));
  const { plan } = await generatePrepPlan(prep, userId);
  db.prepare('UPDATE preps SET status = ?, plan_json = ?, lessons_json = NULL, challenges_json = NULL, mock_json = NULL, updated_at = ? WHERE id = ?')
    .run('ready', JSON.stringify(plan), now(), prep.id);
  const updated = db.prepare('SELECT * FROM preps WHERE id = ?').get(prep.id);
  const view = prepView(updated);
  if (!doneIds.size) return view;
  const lessons = view.lessons.map((lesson) => (doneIds.has(lesson.id) ? { ...lesson, done: true } : lesson));
  db.prepare('UPDATE preps SET lessons_json = ? WHERE id = ?').run(JSON.stringify(lessons), prep.id);
  return {
    ...view,
    lessons,
    mastery: { ...view.mastery, completedLessons: lessons.filter((lesson) => lesson.done).length }
  };
}

function normalizeAnswer(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9.+=\-/ ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function scoreAnswers(questions, answers) {
  let score = 0;
  const details = [];
  for (const question of questions) {
    const raw = Array.isArray(answers) ? answers[question.id] : answers?.[question.id];
    const given = normalizeAnswer(raw);
    const expected = normalizeAnswer(question.answer);
    const ok = !!given && (!expected || given === expected || given.includes(expected) || expected.includes(given));
    if (ok) score += 1;
    details.push({ id: question.id, question: question.question, given: String(raw || ''), expected: question.answer || '', correct: ok });
  }
  return { score, total: questions.length, details };
}

function recordAttempt(userId, prepId, kind, itemId, answers, questions) {
  const result = scoreAnswers(questions, answers);
  const id = uid();
  db.prepare('INSERT INTO attempts (id, user_id, prep_id, kind, item_id, answers_json, details_json, score, total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, prepId, kind, itemId, JSON.stringify(answers || {}), JSON.stringify(result.details), result.score, result.total, now());
  const prep = db.prepare('SELECT * FROM preps WHERE id = ?').get(prepId);
  if (prep) ensurePrepExtras(prep);
  broadcastRealtime(userId, 'prep.updated', { prepId, attemptId: id, kind });
  return { id, ...result };
}

const EXAM_CATALOG = [
  { id: 'official-math-thpt', title: 'Đề chính thức THPT Quốc gia — Toán', subject: 'math', kind: 'official', region: 'Việt Nam' },
  { id: 'official-physics-thpt', title: 'Đề chính thức THPT Quốc gia — Vật lý', subject: 'physics', kind: 'official', region: 'Việt Nam' },
  { id: 'official-english-thpt', title: 'Đề chính thức THPT Quốc gia — Tiếng Anh', subject: 'english', kind: 'official', region: 'Việt Nam' },
  { id: 'official-math-igcse', title: 'IGCSE Mathematics — Paper 2', subject: 'math', kind: 'official', region: 'International' },
  { id: 'official-physics-a-level', title: 'A-Level Physics — Paper 1', subject: 'physics', kind: 'official', region: 'International' },
  { id: 'school-math-midterm', title: 'Đề giữa kỳ Toán — mẫu trường học', subject: 'math', kind: 'school', region: 'Việt Nam' },
  { id: 'school-english-final', title: 'Đề cuối kỳ Tiếng Anh — mẫu trường học', subject: 'english', kind: 'school', region: 'Việt Nam' }
];

const CURRICULUM = {
  math: ['Hàm số', 'Phương trình', 'Bất phương trình', 'Lượng giác', 'Hình học không gian', 'Xác suất'],
  physics: ['Động học', 'Động lực học', 'Điện học', 'Sóng cơ', 'Quang học'],
  chemistry: ['Cấu tạo nguyên tử', 'Liên kết', 'Phản ứng oxi hoá khử', 'Hữu cơ'],
  biology: ['Tế bào', 'Di truyền', 'Sinh thái'],
  english: ['Ngữ pháp', 'Đọc hiểu', 'Viết luận', 'Từ vựng'],
  literature: ['Nghị luận văn học', 'Phân tích tác phẩm', 'Tiếng Việt'],
  history: ['Lịch sử Việt Nam', 'Lịch sử thế giới'],
  geography: ['Địa lý tự nhiên', 'Địa lý kinh tế'],
  cs: ['Thuật toán', 'Cấu trúc dữ liệu', 'Lập trình']
};

function labFallbackHtml(name, prompt) {
  const safeName = String(name || 'havsAI Lab').replace(/[<>]/g, '');
  const safePrompt = String(prompt || '').replace(/[<>]/g, '');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeName}</title>
<style>body{margin:0;padding:24px;background:#0d0d0d;color:#eee;font-family:system-ui,sans-serif}h1{color:#a99cff}input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #333;background:#1a1a1a;color:#fff}button{background:#6c5ce7;border:0;margin-left:8px}ul{line-height:1.8}</style></head>
<body><h1>${safeName}</h1><p>${safePrompt}</p><label>Mục tiêu hôm nay <input id="goal" placeholder="Ví dụ: ôn 20 phút"></label><button onclick="start()">Bắt đầu</button><ul id="list"><li>Mở sách và ghi lại 3 ý chính</li><li>Làm 5 bài tập</li><li>Ghi chú lỗi sai</li></ul>
<script>let seconds=0;function start(){const goal=document.getElementById('goal').value||'20 phút';document.getElementById('list').innerHTML='<li>Đang chạy: '+goal+'</li><li>Hãy tập trung, không mở mạng xã hội.</li>';}</script></body></html>`;
}

function teacherRows() {
  const teachers = db.prepare("SELECT user_id, name, school, class_name FROM profiles WHERE role = 'teacher' ORDER BY name").all();
  return teachers.map((teacher) => {
    const preps = db.prepare('SELECT COUNT(*) AS c FROM preps WHERE user_id = ?').get(teacher.user_id).c;
    return { id: teacher.user_id, name: teacher.name || 'Giáo viên', school: teacher.school || '', className: teacher.class_name || '', prepCount: preps };
  });
}

function childSummary(parentId, childId) {
  const link = db.prepare('SELECT * FROM parent_links WHERE parent_user_id = ? AND child_user_id = ?').get(parentId, childId);
  if (!link) return null;
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(childId);
  if (!profile) return null;
  const chats = db.prepare('SELECT COUNT(*) AS c FROM chats WHERE user_id = ?').get(childId).c;
  const preps = db.prepare('SELECT COUNT(*) AS c FROM preps WHERE user_id = ?').get(childId).c;
  return { id: childId, name: profile.name, email: db.prepare('SELECT email FROM users WHERE id = ?').get(childId)?.email, chats, preps, usageMinutes: profile.usage_minutes, mastery: profile.subjects };
}

function route(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  if (admin.handle(req, res, p, url)) return;
  if (p === '/admin' || p === '/admin/') {
    const file = path.join(PUBLIC_DIR, 'admin.html');
    if (!fs.existsSync(file)) return send(res, 404, 'not found');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff'
    });
    return fs.createReadStream(file).pipe(res);
  }
  if (p === '/api/health') {
    const status = ai.describe();
    let activeRealtime = 0;
    for (const set of realtimeClients.values()) activeRealtime += set.size;
    return send(res, 200, {
      ok: true,
      multiDevice: true,
      realtimeConnections: activeRealtime,
      provider: status.provider,
      model: status.model,
      visionModel: status.visionModel
    });
  }
  if (p === '/.well-known/assetlinks.json') {
    const fingerprints = String(process.env.ANDROID_SHA256_FINGERPRINTS || '')
      .split(',').map((value) => value.trim()).filter(Boolean);
    if (!fingerprints.length || fingerprints.some((value) => !/^([0-9a-f]{2}:){31}[0-9a-f]{2}$/i.test(value))) {
      return send(res, 503, { error: 'assetlinks_not_configured' });
    }
    return send(res, 200, [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: process.env.ANDROID_PACKAGE_NAME || 'com.havs.ai',
        sha256_cert_fingerprints: fingerprints
      }
    }], { 'Cache-Control': 'public, max-age=300' });
  }
  if (p === '/api/auth/request-code' && req.method === 'POST') {
    return readJson(req).then(async (body) => {
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { error: 'invalid_email' });
      const account = db.prepare('SELECT disabled, deleted_at FROM users WHERE email = ?').get(email);
      if (account && (account.disabled || account.deleted_at)) return send(res, 403, { error: 'account_disabled' });
      const code = ALLOW_DEV_OTP ? '123456' : String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      otpCodes.set(email, { code, expires: now() + 5 * 60 * 1000 });
      const delivery = await deliverOtp(req, email, code);
      if (!delivery.ok) {
        otpCodes.delete(email);
        return send(res, 503, { error: delivery.error });
      }
      return send(res, 200, { sent: true, ...(ALLOW_DEV_OTP ? { devCode: code } : {}) });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  if (p === '/api/auth/verify' && req.method === 'POST') {
    return readJson(req).then((body) => {
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { error: 'invalid_email' });
      const code = String(body.code || '').trim();
      const entry = otpCodes.get(email);
      const valid = (!!entry && entry.code === code && entry.expires > now()) || (ALLOW_DEV_OTP && code === '123456');
      if (!valid) return send(res, 401, { error: 'invalid_code' });
      otpCodes.delete(email);
      let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (user && (user.disabled || user.deleted_at)) return send(res, 403, { error: 'account_disabled' });
      if (!user) {
        user = { id: uid(), email, created_at: now() };
        db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(user.id, user.email, user.created_at);
        db.prepare('INSERT INTO profiles (user_id, locale, updated_at) VALUES (?, ?, ?)').run(user.id, 'vi-VN', now());
      }
      const session = token();
      db.prepare('UPDATE parent_links SET child_user_id = ? WHERE child_email = ? AND child_user_id IS NULL').run(user.id, email);
      db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(session, user.id, now());
      const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id);
      send(res, 200, { user: { id: user.id, email: user.email }, profile: publicProfile(profile) }, {
        'Set-Cookie': `havs_session=${session}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secureCookie(req) ? '; Secure' : ''}`
      });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  if (p === '/api/auth/session') {
    const ctx = currentUser(req);
    if (!ctx) return send(res, 200, { authenticated: false });
    return send(res, 200, { authenticated: true, user: ctx.user, profile: publicProfile(ctx.profile) });
  }
  if (p === '/api/auth/logout' && req.method === 'POST') {
    const cookies = parseCookies(req);
    if (cookies.havs_session) db.prepare('DELETE FROM sessions WHERE token = ?').run(cookies.havs_session);
    return send(res, 200, { ok: true }, { 'Set-Cookie': `havs_session=; HttpOnly; Path=/; Max-Age=0${secureCookie(req) ? '; Secure' : ''}` });
  }

  if (p === '/api/onboarding' && req.method === 'PUT') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then((body) => {
      const input = { ...body };
      const aliases = { examDate: 'exam_date', onboardingStep: 'onboarding_step', childEmail: 'child_email', className: 'class_name' };
      for (const [from, to] of Object.entries(aliases)) {
        if (input[to] === undefined && input[from] !== undefined) input[to] = input[from];
      }
      if (input.role !== undefined && !['student', 'parent', 'teacher'].includes(String(input.role))) {
        return send(res, 400, { error: 'invalid_role' });
      }
      const allowed = ['role', 'name', 'age', 'country', 'locale', 'subjects', 'voice', 'goal', 'exam_date', 'onboarding_step', 'child_email', 'school', 'class_name'];
      const sets = [];
      const values = [];
      for (const key of allowed) {
        if (input[key] !== undefined) { sets.push(`${key} = ?`); values.push(key === 'subjects' ? JSON.stringify(input[key]) : input[key]); }
      }
      if (body.done) sets.push('onboarding_done = 1');
      sets.push('updated_at = ?'); values.push(now()); values.push(ctx.user.id);
      if (sets.length > 1) db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE user_id = ?`).run(...values);
      return send(res, 200, { profile: publicProfile(db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(ctx.user.id)) });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  if (p === '/api/profile' && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return send(res, 200, { user: ctx.user, profile: publicProfile(ctx.profile) });
  }
  if (p === '/api/profile' && req.method === 'PATCH') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then((body) => {
      const sets = []; const values = [];
      for (const key of ['name', 'theme', 'voice', 'locale']) {
        if (body[key] !== undefined) { sets.push(`${key} = ?`); values.push(body[key]); }
      }
      if (sets.length) { sets.push('updated_at = ?'); values.push(now(), ctx.user.id); db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE user_id = ?`).run(...values); }
      const profile = publicProfile(db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(ctx.user.id));
      broadcastRealtime(ctx.user.id, 'profile.updated', { profile });
      return send(res, 200, { profile });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  if (p === '/api/limits') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return send(res, 200, { usageMinutes: ctx.profile.usage_minutes, usageLimit: ctx.profile.usage_limit });
  }
  if (p === '/api/voices') {
    return send(res, 200, { voices: VOICES });
  }
  if (p === '/api/tts' && (req.method === 'GET' || req.method === 'POST')) {
    const handleTts = async (text) => {
      const clean = String(text || '').trim();
      if (!clean) return send(res, 400, { error: 'empty_text' });
      try {
        const mp3 = await synthesizeVietnameseMp3(clean);
        if (!mp3 || !mp3.length) return send(res, 400, { error: 'empty_audio' });
        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Content-Length': mp3.length,
          'Cache-Control': 'private, max-age=3600'
        });
        return res.end(mp3);
      } catch (error) {
        return send(res, 502, { error: 'tts_failed', detail: error.message });
      }
    };
    if (req.method === 'GET') {
      return handleTts(url.searchParams.get('text') || '');
    }
    return readJson(req).then((body) => handleTts(body.text || '')).catch((e) => send(res, 400, { error: e.message }));
  }
  if (p === '/api/events' && req.method === 'POST') {
    return readJson(req).then((body) => {
      const ctx = currentUser(req);
      db.prepare('INSERT INTO events (user_id, name, props, created_at) VALUES (?, ?, ?, ?)').run(ctx?.user.id || null, String(body.name || 'event').slice(0, 80), JSON.stringify(body.props || {}).slice(0, 4000), now());
      return send(res, 202, { ok: true });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  if (p === '/api/uploads' && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req, MAX_UPLOAD_BODY).then(async (body) => {
      const mime = String(body.mime || '');
      if (!/^image\/(png|jpeg|webp)$|^application\/pdf$/.test(mime)) return send(res, 400, { error: 'unsupported_type' });
      const raw = Buffer.from(String(body.dataBase64 || ''), 'base64');
      if (!raw.length || raw.length > MAX_UPLOAD_BYTES) return send(res, 400, { error: 'invalid_size', max: MAX_UPLOAD_MB });
      const id = uid();
      const safe = String(body.filename || 'file').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
      let pageCount = null;
      const isPdf = /pdf/i.test(mime) || /\.pdf$/i.test(safe);
      if (isPdf) {
        try {
          const info = await countPdfPages(raw);
          if (info.encrypted) return send(res, 400, { error: 'pdf_password_protected' });
          pageCount = info.pages;
          if (pageCount > PDF_MAX_PAGES) return send(res, 400, { error: 'pdf_too_many_pages', pages: pageCount, max: PDF_MAX_PAGES });
        } catch {
          return send(res, 400, { error: 'pdf_parse_failed' });
        }
      }
      const filePath = path.join(UPLOAD_DIR, `${id}-${safe}`);
      fs.writeFileSync(filePath, raw);
      db.prepare('INSERT INTO uploads (id, user_id, filename, mime, path, page_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, ctx.user.id, safe, mime, filePath, pageCount, now());
      return send(res, 200, { id, url: `/uploads/${id}-${safe}`, pageCount, mime });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  if (p.startsWith('/uploads/')) {
    const ctx = requireUser(req, res); if (!ctx) return;
    const name = path.basename(p);
    const row = db.prepare('SELECT * FROM uploads WHERE user_id = ? AND path LIKE ?').get(ctx.user.id, `%${name}`);
    if (!row || !fs.existsSync(row.path)) return send(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=3600' });
    return fs.createReadStream(row.path).pipe(res);
  }

  if (p === '/api/realtime') {
    const ctx = requireUser(req, res); if (!ctx) return;
    req.socket?.setNoDelay?.(true);
    req.socket?.setKeepAlive?.(true, 15000);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', channels: ['user'] })}\n\n`);
    if (!realtimeClients.has(ctx.user.id)) realtimeClients.set(ctx.user.id, new Set());
    realtimeClients.get(ctx.user.id).add(res);
    const heartbeat = setInterval(() => {
      try { res.write(`data: ${JSON.stringify({ type: 'ping', timestamp: Date.now() })}\n\n`); } catch {}
    }, 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      const clients = realtimeClients.get(ctx.user.id);
      if (clients) {
        clients.delete(res);
        if (!clients.size) realtimeClients.delete(ctx.user.id);
      }
    });
    return;
  }

  if (p === '/api/parent/children' && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return send(res, 200, { children: parentChildren(ctx.user.id) });
  }
  if (p === '/api/parent/children' && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then((body) => {
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { error: 'invalid_email' });
      const child = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      const existing = db.prepare('SELECT id FROM parent_links WHERE parent_user_id = ? AND child_email = ?').get(ctx.user.id, email);
      if (!existing) {
        db.prepare('INSERT INTO parent_links (id, parent_user_id, child_user_id, child_email, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(uid(), ctx.user.id, child?.id || null, email, child ? 'active' : 'pending', now());
      }
      broadcastRealtime(ctx.user.id, 'parent.updated', { email, linked: !!child });
      return send(res, 200, { linked: !!child, children: parentChildren(ctx.user.id) });
    }).catch((e) => send(res, 400, { error: e.message }));
  }

  if (p === '/api/chats' && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const rows = db.prepare('SELECT id, subject, title, created_at FROM chats WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(ctx.user.id);
    return send(res, 200, { chats: rows });
  }
  if (p === '/api/chats' && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then((body) => {
      const id = uid();
      const subject = SUBJECTS.includes(body.subject) ? body.subject : 'math';
      db.prepare('INSERT INTO chats (id, user_id, subject, title, created_at) VALUES (?, ?, ?, ?, ?)').run(id, ctx.user.id, subject, String(body.title || 'Cuộc trò chuyện mới').slice(0, 120), now());
      return send(res, 200, { id, subject });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  if (p.startsWith('/api/chats/') && p.endsWith('/messages') && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const chatId = p.split('/')[3];
    const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(chatId, ctx.user.id);
    if (!chat) return send(res, 404, { error: 'not_found' });
    const messages = db.prepare('SELECT id, role, content, image_url, tools_json, created_at FROM messages WHERE chat_id = ? ORDER BY created_at ASC').all(chatId);
    return send(res, 200, { chat, messages });
  }
  const userChatRoute = p.match(/^\/api\/chats\/([^/]+)$/);
  if (userChatRoute && req.method === 'PATCH') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then((body) => {
      const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(userChatRoute[1], ctx.user.id);
      if (!chat) return send(res, 404, { error: 'not_found' });
      const title = body.title !== undefined ? String(body.title || '').trim().slice(0, 120) || chat.title : chat.title;
      const subject = body.subject !== undefined && SUBJECTS.includes(body.subject) ? body.subject : chat.subject;
      db.prepare('UPDATE chats SET title = ?, subject = ? WHERE id = ? AND user_id = ?').run(title, subject, chat.id, ctx.user.id);
      const updated = db.prepare('SELECT id, subject, title, created_at FROM chats WHERE id = ?').get(chat.id);
      broadcastRealtime(ctx.user.id, 'chat.updated', { chatId: chat.id, title: updated.title, subject: updated.subject });
      return send(res, 200, { chat: updated });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  if (userChatRoute && req.method === 'DELETE') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(userChatRoute[1], ctx.user.id);
    if (!chat) return send(res, 404, { error: 'not_found' });
    db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chat.id);
    db.prepare('DELETE FROM chats WHERE id = ? AND user_id = ?').run(chat.id, ctx.user.id);
    broadcastRealtime(ctx.user.id, 'chat.deleted', { chatId: chat.id });
    return send(res, 200, { ok: true, id: chat.id });
  }

  if (p === '/api/chat/stream' && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then(async (body) => {
      const text = String(body.message || '').trim().slice(0, 4000);
      if (!text) return send(res, 400, { error: 'empty_message' });
      let chatId = String(body.chatId || '');
      let subject = SUBJECTS.includes(body.subject) ? body.subject : 'math';
      let chat = chatId ? db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(chatId, ctx.user.id) : null;
      if (!chat) {
        chatId = uid();
        db.prepare('INSERT INTO chats (id, user_id, subject, title, created_at) VALUES (?, ?, ?, ?, ?)').run(chatId, ctx.user.id, subject, text.slice(0, 80), now());
      } else {
        subject = chat.subject || subject;
      }
      const userMessageId = uid();
      db.prepare('INSERT INTO messages (id, chat_id, role, content, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(userMessageId, chatId, 'user', text, body.imageUrl || null, now());

      req.socket?.setNoDelay?.(true);
      req.socket?.setKeepAlive?.(true, 15000);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      let full = '';
      const toolsUsed = [];
      let extraContext = '';
      try {
        const uploadRef = body.uploadId || body.imageUrl;
        const uploadRow = findUpload(ctx.user.id, uploadRef);
        if (uploadRow && /^image\//i.test(uploadRow.mime || '')) {
          res.write(`data: ${JSON.stringify({ type: 'tool', tool: 'vision_analyze', status: 'started', filename: uploadRow.filename })}\n\n`);
          const vision = await analyzeImageUpload(ctx.user.id, uploadRef);
          if (vision) {
            toolsUsed.push({ tool: 'vision_analyze', filename: vision.filename, chars: vision.text.length, model: vision.model });
            res.write(`data: ${JSON.stringify({ type: 'tool', tool: 'vision_analyze', status: 'done', filename: vision.filename, chars: vision.text.length, model: vision.model })}\n\n`);
            extraContext += `\nThe vision_analyze tool has already read the attached image. Use this OCR/description when answering; do not say you cannot see images.\nImage content (${vision.filename}):\n${vision.text.slice(0, 6000)}\n`;
          } else {
            res.write(`data: ${JSON.stringify({ type: 'tool', tool: 'vision_analyze', status: 'error', filename: uploadRow.filename })}\n\n`);
            extraContext += '\nThe attached image could not be read by the vision tool. Ask the student to retake a clear photo or type the text.\n';
          }
        } else {
          const material = await extractUploadText(ctx.user.id, uploadRef);
          if (material) {
            const scanned = !!material.scanned;
            toolsUsed.push({
              tool: 'read_material',
              filename: material.filename,
              chars: material.text.length,
              pages: material.pages || 0,
              scanned,
              visionPages: material.visionPages || []
            });
            res.write(`data: ${JSON.stringify({
              type: 'tool', tool: 'read_material', status: 'done',
              filename: material.filename, chars: material.text.length,
              pages: material.pages || 0, scanned, visionPages: material.visionPages || []
            })}\n\n`);
            extraContext += `\nThe read_material tool has already read the attached file. Use its content when answering.\nAttached material (${material.filename}):\n${material.text.slice(0, 8000)}\n`;
            if (scanned && material.visionPages?.length) {
              extraContext += `\nPages ${material.visionPages.join(', ')} of ${material.pages || '?'} were OCR'd by DeepSeek Vision; cite page numbers when possible.\n`;
              if (material.pages > material.visionPages.length) {
                extraContext += `Only the first ${material.visionPages.length} pages were OCR'd. Ask the student to upload the remaining pages separately for full coverage.\n`;
              }
            } else if (scanned) {
              extraContext += '\nThis PDF has very little extractable text (likely scanned). Tell the student to upload page images so the vision tool can OCR them.\n';
            }
          } else if (/pdf/i.test(uploadRow?.mime || '')) {
            extraContext += '\nThe PDF could not be parsed. Ask the student to upload page images (PNG/JPEG) for OCR.\n';
          }
        }
        if (shouldSearch(text)) {
          const query = text.replace(/^(hãy\s+)?(tìm kiếm|tra cứu|search)\s*/i, '').slice(0, 180) || text.slice(0, 180);
          res.write(`data: ${JSON.stringify({ type: 'tool', tool: 'web_search', status: 'started', query })}\n\n`);
          const results = await webSearch(query);
          toolsUsed.push({ tool: 'web_search', query, results });
          res.write(`data: ${JSON.stringify({ type: 'tool', tool: 'web_search', status: 'done', query, results })}\n\n`);
          if (results.length) {
            extraContext += `\nThe web_search tool has already run for this query and returned the real results below. Use them, cite source URLs, and do not say you lack search capability.\nWeb search results for "${query}":\n` + results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n${r.snippet}`).join('\n') + '\n';
          }
        }
        const providerConfigs = typeof ai.resolveAll === 'function' ? ai.resolveAll('chat') : [currentProviderConfig()].filter(Boolean);
        if (providerConfigs.length) {
          const history = db.prepare('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC LIMIT 20').all(chatId);
          let lastErr = null;
          for (const cfg of providerConfigs) {
            if (!cfg?.apiKey) continue;
            const candidateModels = [...new Set([cfg.model, cfg.fallbackModel].filter(Boolean))];
            for (const candidateModel of candidateModels) {
              try {
                full = await streamChatCompletion(res, { ...cfg, model: candidateModel }, subject, history, extraContext);
                if (full) break;
              } catch (err) {
                lastErr = err;
              }
            }
            if (full) break;
          }
          if (!full && lastErr) {
            throw lastErr;
          }
          if (!full) {
            full = await streamMock(res, subject, text);
          }
        } else {
          full = await streamMock(res, subject, text);
        }
      } catch (error) {
        const msg = String(error?.message || '');
        if (msg.includes('upstream_401') || msg.includes('UNAUTHORIZED')) {
          full = `Tài khoản Command Code hiện tại đã hết hạn hoặc token không hợp lệ (401 Unauthorized). Bạn hãy vào mục **Cài đặt → Tài khoản AI (Command Code)** (hoặc trang **/admin → AI**) để dán API key / nội dung file auth.json của tài khoản Command Code mới nhé.`;
        } else {
          full = `Xin lỗi, mình đang gặp sự cố kết nối (${msg}). Bạn thử lại nhé.`;
        }
        res.write(`data: ${JSON.stringify({ type: 'token', value: full })}\n\n`);
      }
      const assistantId = uid();
      db.prepare('INSERT INTO messages (id, chat_id, role, content, image_url, tools_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(assistantId, chatId, 'assistant', full, null, JSON.stringify(toolsUsed), now());
      const usage = touchUsage(ctx.user.id);
      res.write(`data: ${JSON.stringify({ type: 'done', chatId, messageId: assistantId, usage: { minutes: usage.usage_minutes, limit: usage.usage_limit }, tools: toolsUsed })}\n\n`);
      broadcastRealtime(ctx.user.id, 'chat.message', { chatId, messageId: assistantId, usage: usage.usage_minutes });
      res.end();
    }).catch((e) => {
      if (!res.headersSent) send(res, 400, { error: e.message });
      else res.end();
    });
  }

  if (p === '/api/preps' && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return send(res, 200, { preps: db.prepare('SELECT * FROM preps WHERE user_id = ? ORDER BY created_at DESC').all(ctx.user.id) });
  }
  if (p === '/api/preps' && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then((body) => {
      const id = uid();
      db.prepare('INSERT INTO preps (id, user_id, title, subject, exam_date, status, material_upload_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, ctx.user.id, String(body.title || 'Đề ôn tập').slice(0, 120), String(body.subject || 'math'),
        String(body.examDate || ''), 'draft', body.uploadId ? String(body.uploadId) : null,
        body.source ? String(body.source).slice(0, 40) : null, now()
      );
      return send(res, 200, { id });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  const prepGenerate = p.match(/^\/api\/preps\/([^/]+)\/generate$/);
  if (prepGenerate && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then(async (body) => {
      const prep = db.prepare('SELECT * FROM preps WHERE id = ? AND user_id = ?').get(prepGenerate[1], ctx.user.id);
      if (!prep) return send(res, 404, { error: 'not_found' });
      const view = await regeneratePrep(prep, ctx.user.id, { days: body.days });
      broadcastRealtime(ctx.user.id, 'prep.updated', { prepId: prep.id });
      return send(res, 200, { plan: view.plan, prep: view });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  const prepDetail = p.match(/^\/api\/preps\/([^/]+)$/);
  if (prepDetail && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const prep = db.prepare('SELECT * FROM preps WHERE id = ? AND user_id = ?').get(prepDetail[1], ctx.user.id);
    if (!prep) return send(res, 404, { error: 'not_found' });
    return send(res, 200, { prep: { ...prep, plan: prep.plan_json ? JSON.parse(prep.plan_json) : null } });
  }

  if (p === '/api/exam-preps/official' && req.method === 'GET') {
    return send(res, 200, { items: EXAM_CATALOG.filter((item) => item.kind === 'official') });
  }
  if (p === '/api/exam-preps/school' && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const mine = db.prepare('SELECT * FROM preps WHERE user_id = ? AND (school = ? OR school IS NULL) ORDER BY created_at DESC').all(ctx.user.id, ctx.profile?.school || '');
    return send(res, 200, { school: ctx.profile?.school || '', items: mine.map(prepView), catalog: EXAM_CATALOG.filter((item) => item.kind === 'school') });
  }
  if (p === '/api/exam-preps/curriculum' && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return send(res, 200, { subjects: SUBJECTS, curriculum: CURRICULUM });
  }
  if (p === '/api/exam-preps/search' && req.method === 'GET') {
    const query = (url.searchParams.get('q') || '').toLowerCase().trim();
    const ctx = currentUser(req);
    const catalog = EXAM_CATALOG.filter((item) => !query || `${item.title} ${item.subject} ${item.region}`.toLowerCase().includes(query));
    const shared = db.prepare('SELECT p.*, pr.name AS author FROM preps p LEFT JOIN profiles pr ON pr.user_id = p.user_id WHERE p.share_id IS NOT NULL').all()
      .filter((row) => !query || `${row.title} ${row.subject}`.toLowerCase().includes(query))
      .map((row) => ({ ...prepView(row), author: row.author || 'Học sinh' }));
    return send(res, 200, { items: catalog, shared, query });
  }
  if (p === '/api/exam-preps/past' && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const attempts = db.prepare('SELECT * FROM attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(ctx.user.id);
    return send(res, 200, {
      attempts: attempts.map((attempt) => ({ ...attempt, answers: parseJsonValue(attempt.answers_json, {}), details: parseJsonValue(attempt.details_json, []) })),
      preps: db.prepare('SELECT * FROM preps WHERE user_id = ? AND status = ? ORDER BY created_at DESC').all(ctx.user.id, 'ready').map(prepView)
    });
  }
  if (p === '/api/exam-preps/from-catalog' && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then((body) => {
      const item = EXAM_CATALOG.find((entry) => entry.id === body.catalogId);
      if (!item) return send(res, 404, { error: 'not_found' });
      const id = uid();
      db.prepare('INSERT INTO preps (id, user_id, title, subject, exam_date, status, school, curriculum, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, ctx.user.id, item.title, item.subject, String(body.examDate || ''), 'draft', item.region === 'Việt Nam' ? (ctx.profile?.school || '') : '', item.region, now(), now());
      return send(res, 200, { id, prep: prepView(db.prepare('SELECT * FROM preps WHERE id = ?').get(id)) });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  const examJoin = p.match(/^\/api\/exam-preps\/join\/([^/]+)$/);
  if (examJoin && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const source = db.prepare('SELECT * FROM preps WHERE share_id = ?').get(examJoin[1]);
    if (!source) return send(res, 404, { error: 'not_found' });
    const id = uid();
    const lessons = parseJsonValue(source.lessons_json, []).map((lesson) => ({ ...lesson, done: false }));
    db.prepare('INSERT INTO preps (id, user_id, title, subject, exam_date, status, plan_json, lessons_json, challenges_json, mock_json, mastery_json, school, curriculum, source_share_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, ctx.user.id, `${source.title} (tham gia)`, source.subject, source.exam_date || '', 'ready', source.plan_json, JSON.stringify(lessons), source.challenges_json, source.mock_json, null, source.school, source.curriculum, source.share_id, now(), now());
    return send(res, 200, { id, prep: prepView(db.prepare('SELECT * FROM preps WHERE id = ?').get(id)) });
  }
  if (p === '/api/exam-preps' && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const rows = db.prepare('SELECT * FROM preps WHERE user_id = ? ORDER BY created_at DESC').all(ctx.user.id);
    return send(res, 200, { preps: rows.map(prepView) });
  }
  if (p === '/api/exam-preps' && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then((body) => {
      const id = uid();
      db.prepare('INSERT INTO preps (id, user_id, title, subject, exam_date, status, school, curriculum, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, ctx.user.id, String(body.title || 'Đề ôn tập').slice(0, 120), String(body.subject || 'math'), String(body.examDate || ''), 'draft', String(body.school || ctx.profile?.school || ''), String(body.curriculum || ''), now(), now());
      if (body.examDate) {
        db.prepare('INSERT INTO calendar_events (id, user_id, title, event_date, kind, prep_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(uid(), ctx.user.id, String(body.title || 'Kỳ thi'), String(body.examDate), 'exam', id, now());
      }
      return send(res, 200, { id, prep: prepView(db.prepare('SELECT * FROM preps WHERE id = ?').get(id)) });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  const shareRoute = p.match(/^\/api\/share\/(?:a\/)?([^/]+)$/);
  if (shareRoute) {
    const shareId = shareRoute[1];
    const row = db.prepare('SELECT p.*, pr.name AS author FROM preps p LEFT JOIN profiles pr ON pr.user_id = p.user_id WHERE p.share_id = ?').get(shareId);
    if (!row) return send(res, 404, { error: 'not_found' });
    return send(res, 200, { prep: prepView(row), author: { name: row.author || 'Học sinh' } });
  }
  const examGenerate = p.match(/^\/api\/exam-preps\/([^/]+)\/generate$/);
  if (examGenerate && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then(async (body) => {
      const prep = db.prepare('SELECT * FROM preps WHERE id = ? AND user_id = ?').get(examGenerate[1], ctx.user.id);
      if (!prep) return send(res, 404, { error: 'not_found' });
      const view = await regeneratePrep(prep, ctx.user.id, { days: body.days });
      broadcastRealtime(ctx.user.id, 'prep.updated', { prepId: prep.id });
      return send(res, 200, { plan: view.plan, prep: view });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  const examMaterial = p.match(/^\/api\/exam-preps\/([^/]+)\/material$/);
  if (examMaterial && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then((body) => {
      const prep = db.prepare('SELECT * FROM preps WHERE id = ? AND user_id = ?').get(examMaterial[1], ctx.user.id);
      if (!prep) return send(res, 404, { error: 'not_found' });
      const row = findUpload(ctx.user.id, String(body.uploadId || ''));
      if (!row) return send(res, 400, { error: 'invalid_upload' });
      db.prepare('INSERT OR IGNORE INTO prep_materials (prep_id, upload_id, created_at) VALUES (?, ?, ?)').run(prep.id, row.id, now());
      if (!prep.material_upload_id) {
        db.prepare('UPDATE preps SET material_upload_id = ?, updated_at = ? WHERE id = ?').run(row.id, now(), prep.id);
      }
      const materials = prepMaterials({ ...prep, material_upload_id: prep.material_upload_id || row.id });
      return send(res, 200, { material: materials[0] || null, materials });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  const examMaterialRemove = p.match(/^\/api\/exam-preps\/([^/]+)\/material\/([^/]+)$/);
  if (examMaterialRemove && req.method === 'DELETE') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const prep = db.prepare('SELECT * FROM preps WHERE id = ? AND user_id = ?').get(examMaterialRemove[1], ctx.user.id);
    if (!prep) return send(res, 404, { error: 'not_found' });
    db.prepare('DELETE FROM prep_materials WHERE prep_id = ? AND upload_id = ?').run(prep.id, examMaterialRemove[2]);
    let first = prep.material_upload_id;
    if (first === examMaterialRemove[2]) {
      first = prepMaterialIds({ ...prep, material_upload_id: null })[0] || null;
      db.prepare('UPDATE preps SET material_upload_id = ?, updated_at = ? WHERE id = ?').run(first, now(), prep.id);
    }
    return send(res, 200, { materials: prepMaterials({ ...prep, material_upload_id: first }) });
  }
  const examShare = p.match(/^\/api\/exam-preps\/([^/]+)\/share$/);
  if (examShare && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const prep = db.prepare('SELECT * FROM preps WHERE id = ? AND user_id = ?').get(examShare[1], ctx.user.id);
    if (!prep) return send(res, 404, { error: 'not_found' });
    const shareId = ensureShareId(prep);
    return send(res, 200, { shareId, url: `/share/a/${shareId}` });
  }
  const lessonPractice = p.match(/^\/api\/exam-preps\/([^/]+)\/lessons\/([^/]+)\/practice\/(\d+)$/);
  if (lessonPractice && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then((body) => {
      const prep = db.prepare('SELECT * FROM preps WHERE id = ? AND user_id = ?').get(lessonPractice[1], ctx.user.id);
      if (!prep) return send(res, 404, { error: 'not_found' });
      const enriched = ensurePrepExtras(prep);
      const lesson = (parseJsonValue(enriched.lessons_json, []) || []).find((item) => item.id === lessonPractice[2]);
      if (!lesson) return send(res, 404, { error: 'lesson_not_found' });
      const item = (lesson.practice || [])[Number(lessonPractice[3])];
      if (!item) return send(res, 404, { error: 'practice_not_found' });
      const given = normalizeAnswer(body.answer);
      const expected = normalizeAnswer(item.answer);
      const correct = Boolean(given) && (!expected || given === expected || given.includes(expected) || expected.includes(given));
      return send(res, 200, { correct, expected: item.answer || '', given: String(body.answer || '') });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  const lessonComplete = p.match(/^\/api\/exam-preps\/([^/]+)\/lessons\/([^/]+)\/complete$/);
  if (lessonComplete && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const prep = db.prepare('SELECT * FROM preps WHERE id = ? AND user_id = ?').get(lessonComplete[1], ctx.user.id);
    if (!prep) return send(res, 404, { error: 'not_found' });
    const enriched = ensurePrepExtras(prep);
    const lessons = parseJsonValue(enriched.lessons_json, []).map((lesson) => lesson.id === lessonComplete[2] ? { ...lesson, done: true } : lesson);
    db.prepare('UPDATE preps SET lessons_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(lessons), now(), prep.id);
    broadcastRealtime(ctx.user.id, 'prep.updated', { prepId: prep.id });
    return send(res, 200, { prep: prepView(db.prepare('SELECT * FROM preps WHERE id = ?').get(prep.id)) });
  }
  const challengeAttempt = p.match(/^\/api\/exam-preps\/([^/]+)\/challenges\/([^/]+)\/attempt$/);
  if (challengeAttempt && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then((body) => {
      const prep = db.prepare('SELECT * FROM preps WHERE id = ? AND user_id = ?').get(challengeAttempt[1], ctx.user.id);
      if (!prep) return send(res, 404, { error: 'not_found' });
      const enriched = ensurePrepExtras(prep);
      const challenge = parseJsonValue(enriched.challenges_json, []).find((item) => item.id === challengeAttempt[2]);
      if (!challenge) return send(res, 404, { error: 'not_found' });
      const attempt = recordAttempt(ctx.user.id, prep.id, 'challenge', challenge.id, body.answers, [{ id: challenge.id, question: challenge.question, answer: challenge.answer }]);
      return send(res, 200, { attempt, prep: prepView(db.prepare('SELECT * FROM preps WHERE id = ?').get(prep.id)) });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  const challengeCreate = p.match(/^\/api\/exam-preps\/([^/]+)\/challenges$/);
  if (challengeCreate && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then((body) => {
      const prep = db.prepare('SELECT * FROM preps WHERE id = ? AND user_id = ?').get(challengeCreate[1], ctx.user.id);
      if (!prep) return send(res, 404, { error: 'not_found' });
      const enriched = ensurePrepExtras(prep);
      const challenges = parseJsonValue(enriched.challenges_json, []);
      const challenge = {
        id: `challenge-${shortId()}`,
        title: String(body.title || `Thử thách ${challenges.length + 1}`).slice(0, 100),
        question: String(body.question || 'Hãy trình bày một dạng bài trọng tâm và cách giải.'),
        answer: String(body.answer || ''),
        shareId: shortId()
      };
      challenges.push(challenge);
      db.prepare('UPDATE preps SET challenges_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(challenges), now(), prep.id);
      return send(res, 200, { challenge, prep: prepView(db.prepare('SELECT * FROM preps WHERE id = ?').get(prep.id)) });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  const mockAttempt = p.match(/^\/api\/exam-preps\/([^/]+)\/mock-exams\/([^/]+)\/attempts$/);
  if (mockAttempt && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then((body) => {
      const prep = db.prepare('SELECT * FROM preps WHERE id = ? AND user_id = ?').get(mockAttempt[1], ctx.user.id);
      if (!prep) return send(res, 404, { error: 'not_found' });
      const enriched = ensurePrepExtras(prep);
      const mock = parseJsonValue(enriched.mock_json, []).find((item) => item.id === mockAttempt[2]);
      if (!mock) return send(res, 404, { error: 'not_found' });
      const attempt = recordAttempt(ctx.user.id, prep.id, 'mock', mock.id, body.answers, mock.questions || []);
      return send(res, 200, { attempt, prep: prepView(db.prepare('SELECT * FROM preps WHERE id = ?').get(prep.id)) });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  const mockCreate = p.match(/^\/api\/exam-preps\/([^/]+)\/mock-exams$/);
  if (mockCreate && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then((body) => {
      const prep = db.prepare('SELECT * FROM preps WHERE id = ? AND user_id = ?').get(mockCreate[1], ctx.user.id);
      if (!prep) return send(res, 404, { error: 'not_found' });
      const enriched = ensurePrepExtras(prep);
      const mocks = parseJsonValue(enriched.mock_json, []);
      const mock = {
        id: `mock-${shortId()}`,
        title: String(body.title || `Đề thi thử ${mocks.length + 1}`).slice(0, 100),
        durationMinutes: Number(body.durationMinutes || 30),
        questions: Array.isArray(body.questions) && body.questions.length ? body.questions : (mocks[0]?.questions || [])
      };
      mocks.push(mock);
      db.prepare('UPDATE preps SET mock_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(mocks), now(), prep.id);
      return send(res, 200, { mock, prep: prepView(db.prepare('SELECT * FROM preps WHERE id = ?').get(prep.id)) });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  const attemptDetail = p.match(/^\/api\/exam-preps\/([^/]+)\/attempts\/([^/]+)$/);
  if (attemptDetail && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const attempt = db.prepare('SELECT * FROM attempts WHERE id = ? AND user_id = ? AND prep_id = ?').get(attemptDetail[2], ctx.user.id, attemptDetail[1]);
    if (!attempt) return send(res, 404, { error: 'not_found' });
    return send(res, 200, { attempt: { ...attempt, answers: parseJsonValue(attempt.answers_json, {}), details: parseJsonValue(attempt.details_json, []) } });
  }
  const masteryRoute = p.match(/^\/api\/exam-preps\/([^/]+)\/mastery$/);
  if (masteryRoute && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const prep = db.prepare('SELECT * FROM preps WHERE id = ? AND user_id = ?').get(masteryRoute[1], ctx.user.id);
    if (!prep) return send(res, 404, { error: 'not_found' });
    const view = prepView(prep);
    return send(res, 200, { mastery: view.mastery, lessons: view.lessons, attempts: view.mastery.attempts || 0 });
  }
  const examDetail = p.match(/^\/api\/exam-preps\/([^/]+)$/);
  if (examDetail && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const prep = db.prepare('SELECT * FROM preps WHERE id = ? AND user_id = ?').get(examDetail[1], ctx.user.id);
    if (!prep) return send(res, 404, { error: 'not_found' });
    return send(res, 200, { prep: prepView(prep) });
  }

  const attemptById = p.match(/^\/api\/attempts\/([^/]+)$/);
  if (attemptById && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const attempt = db.prepare('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(attemptById[1], ctx.user.id);
    if (!attempt) return send(res, 404, { error: 'not_found' });
    return send(res, 200, { attempt: { ...attempt, answers: parseJsonValue(attempt.answers_json, {}), details: parseJsonValue(attempt.details_json, []) } });
  }

  if (p === '/api/calendar' && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const target = url.searchParams.get('userId');
    if (target && target !== ctx.user.id && !childSummary(ctx.user.id, target)) return send(res, 403, { error: 'not_linked' });
    return send(res, 200, { events: db.prepare('SELECT * FROM calendar_events WHERE user_id = ? ORDER BY event_date ASC').all(target || ctx.user.id) });
  }
  if (p === '/api/calendar' && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then((body) => {
      if (!body.title || !body.date) return send(res, 400, { error: 'missing_fields' });
      const id = uid();
      db.prepare('INSERT INTO calendar_events (id, user_id, title, event_date, kind, prep_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, ctx.user.id, String(body.title).slice(0, 120), String(body.date), String(body.kind || 'study'), body.prepId || null, now());
      return send(res, 200, { id, events: db.prepare('SELECT * FROM calendar_events WHERE user_id = ? ORDER BY event_date ASC').all(ctx.user.id) });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  const calendarDelete = p.match(/^\/api\/calendar\/([^/]+)$/);
  if (calendarDelete && req.method === 'DELETE') {
    const ctx = requireUser(req, res); if (!ctx) return;
    db.prepare('DELETE FROM calendar_events WHERE id = ? AND user_id = ?').run(calendarDelete[1], ctx.user.id);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/lab/apps' && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return send(res, 200, { apps: db.prepare('SELECT id, slug, name, prompt, visibility, created_at, updated_at FROM lab_apps WHERE user_id = ? ORDER BY created_at DESC').all(ctx.user.id) });
  }
  if (p === '/api/lab/public' && req.method === 'GET') {
    return send(res, 200, { apps: db.prepare("SELECT id, slug, name, prompt, visibility, created_at FROM lab_apps WHERE visibility = 'public' ORDER BY created_at DESC LIMIT 50").all() });
  }
  if (p === '/api/lab/apps' && req.method === 'POST') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then(async (body) => {
      const prompt = String(body.prompt || '').slice(0, 1000);
      if (!prompt) return send(res, 400, { error: 'missing_prompt' });
      let name = String(body.name || '').slice(0, 80) || `App ${new Date().toLocaleDateString('vi-VN')}`;
      let html = '';
      try {
        const result = await callModelJson(
          'Bạn là lập trình viên tạo app học tập. Chỉ trả về JSON hợp lệ: {"name":string,"html":string}. HTML phải tự chứa CSS/JS, không tải tài nguyên ngoài, chạy được trong iframe sandbox.',
          `Tạo một web app nhỏ, giao diện tối, tiếng Việt, cho yêu cầu: ${prompt}. Trả về HTML đầy đủ trong trường html.`,
          { maxTokens: 6000 }
        );
        const parsed = parseJsonLoose(result.content);
        if (parsed?.html && String(parsed.html).length > 80) {
          html = String(parsed.html).slice(0, 60000);
          if (parsed.name) name = String(parsed.name).slice(0, 80);
        }
      } catch {}
      if (!html) html = labFallbackHtml(name, prompt);
      const id = uid();
      const slug = `${name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'app'}-${shortId().slice(0, 4)}`;
      db.prepare('INSERT INTO lab_apps (id, user_id, slug, name, prompt, html, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, ctx.user.id, slug, name, prompt, html, 'private', now(), now());
      return send(res, 200, { app: { id, slug, name, prompt, html, visibility: 'private' } });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  const labApp = p.match(/^\/api\/lab\/apps\/([^/]+)$/);
  if (labApp && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const app = db.prepare("SELECT * FROM lab_apps WHERE slug = ? AND (user_id = ? OR visibility = 'public')").get(labApp[1], ctx.user.id);
    if (!app) return send(res, 404, { error: 'not_found' });
    return send(res, 200, { app });
  }
  if (labApp && req.method === 'PATCH') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then((body) => {
      const app = db.prepare('SELECT * FROM lab_apps WHERE slug = ? AND user_id = ?').get(labApp[1], ctx.user.id);
      if (!app) return send(res, 404, { error: 'not_found' });
      const name = body.name !== undefined ? String(body.name).slice(0, 80) : app.name;
      const visibility = body.visibility === 'public' ? 'public' : body.visibility === 'private' ? 'private' : app.visibility;
      db.prepare('UPDATE lab_apps SET name = ?, visibility = ?, updated_at = ? WHERE id = ?').run(name, visibility, now(), app.id);
      return send(res, 200, { app: { ...app, name, visibility } });
    }).catch((e) => send(res, 400, { error: e.message }));
  }
  if (labApp && req.method === 'DELETE') {
    const ctx = requireUser(req, res); if (!ctx) return;
    db.prepare('DELETE FROM lab_apps WHERE slug = ? AND user_id = ?').run(labApp[1], ctx.user.id);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/showcase' && req.method === 'GET') {
    const preps = db.prepare('SELECT p.*, pr.name AS author FROM preps p LEFT JOIN profiles pr ON pr.user_id = p.user_id WHERE p.share_id IS NOT NULL ORDER BY p.updated_at DESC LIMIT 20').all()
      .map((row) => ({ ...prepView(row), author: row.author || 'Học sinh' }));
    const apps = db.prepare("SELECT id, slug, name, prompt FROM lab_apps WHERE visibility = 'public' ORDER BY created_at DESC LIMIT 20").all();
    return send(res, 200, { preps, apps, teachers: teacherRows() });
  }
  if ((p === '/api/teachers' || p === '/api/showcase/teachers') && req.method === 'GET') {
    return send(res, 200, { teachers: teacherRows() });
  }
  const teacherDetail = p.match(/^\/api\/teachers\/([^/]+)$/);
  if (teacherDetail && req.method === 'GET') {
    const profile = db.prepare("SELECT user_id, name, school, class_name FROM profiles WHERE user_id = ? AND role = 'teacher'").get(teacherDetail[1]);
    if (!profile) return send(res, 404, { error: 'not_found' });
    const preps = db.prepare('SELECT * FROM preps WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(profile.user_id).map(prepView);
    return send(res, 200, { teacher: { ...profile, id: profile.user_id }, preps });
  }

  const childRoute = p.match(/^\/api\/(?:child|dashboard\/children)\/([^/]+)$/);
  if (childRoute && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const summary = childSummary(ctx.user.id, childRoute[1]);
    if (!summary) return send(res, 403, { error: 'not_linked' });
    const preps = db.prepare('SELECT * FROM preps WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(childRoute[1]).map(prepView);
    const chats = db.prepare('SELECT id, subject, title, created_at FROM chats WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(childRoute[1]);
    return send(res, 200, { child: summary, preps, chats });
  }

  if (p === '/api/settings' && req.method === 'GET') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return send(res, 200, { profile: publicProfile(ctx.profile), settings: parseJsonValue(ctx.profile.settings_json, {}) });
  }
  if (p === '/api/settings' && req.method === 'PATCH') {
    const ctx = requireUser(req, res); if (!ctx) return;
    return readJson(req).then((body) => {
      const settings = { ...parseJsonValue(ctx.profile.settings_json, {}), ...(body.settings || {}) };
      const fields = {
        name: body.name,
        voice: body.voice,
        theme: body.theme,
        study_time: body.studyTime,
        interests: body.interests !== undefined ? JSON.stringify(body.interests) : undefined,
        notifications: body.notifications !== undefined ? (body.notifications ? 1 : 0) : undefined,
        school: body.school,
        class_name: body.className
      };
      const sets = ['settings_json = ?', 'updated_at = ?'];
      const values = [JSON.stringify(settings), now()];
      for (const [column, value] of Object.entries(fields)) {
        if (value !== undefined) { sets.push(`${column} = ?`); values.push(value); }
      }
      values.push(ctx.user.id);
      db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE user_id = ?`).run(...values);
      const profile = publicProfile(db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(ctx.user.id));
      broadcastRealtime(ctx.user.id, 'profile.updated', { profile, settings });
      return send(res, 200, { profile, settings });
    }).catch((e) => send(res, 400, { error: e.message }));
  }

  if (p === '/api/dashboard') {
    const ctx = requireUser(req, res); if (!ctx) return;
    const chats = db.prepare('SELECT COUNT(*) AS c FROM chats WHERE user_id = ?').get(ctx.user.id).c;
    const preps = db.prepare('SELECT COUNT(*) AS c FROM preps WHERE user_id = ?').get(ctx.user.id).c;
    const messages = db.prepare('SELECT COUNT(*) AS c FROM messages m JOIN chats c ON c.id = m.chat_id WHERE c.user_id = ?').get(ctx.user.id).c;
    const attempts = db.prepare('SELECT COUNT(*) AS c FROM attempts WHERE user_id = ?').get(ctx.user.id).c;
    const labApps = db.prepare('SELECT COUNT(*) AS c FROM lab_apps WHERE user_id = ?').get(ctx.user.id).c;
    const events = db.prepare('SELECT * FROM calendar_events WHERE user_id = ? ORDER BY event_date ASC LIMIT 10').all(ctx.user.id);
    return send(res, 200, {
      chats,
      preps,
      messages,
      attempts,
      labApps,
      events,
      usageMinutes: ctx.profile.usage_minutes,
      role: ctx.profile.role,
      school: ctx.profile.school,
      className: ctx.profile.class_name,
      children: ctx.profile.role === 'parent' ? parentChildren(ctx.user.id) : []
    });
  }

  if (p.startsWith('/api/')) return send(res, 404, { error: 'not_found' });
  return serveStatic(req, res, p);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };

function serveStatic(req, res, p) {
  const rel = p === '/' ? 'index.html' : decodeURIComponent(p.replace(/^\/+/, ''));
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    if (p !== '/' && !path.extname(p)) {
      const index = path.join(PUBLIC_DIR, 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(index).pipe(res);
    }
    return send(res, 404, 'not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  return fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  Promise.resolve(route(req, res)).catch((error) => {
    console.error(error);
    if (!res.headersSent) send(res, 500, { error: 'internal_error' });
    else res.end();
  });
});
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

if (require.main === module) {
  server.listen(PORT, () => {
    if (ALLOW_DEV_OTP) {
      console.warn('WARNING: ALLOW_DEV_OTP=true — the universal OTP 123456 is accepted. Never enable this on a public deployment.');
    }
    if (IS_PRODUCTION && !process.env.SMTP_URL && !process.env.RESEND_API_KEY) {
      console.warn('WARNING: no OTP mailer configured (SMTP_URL or RESEND_API_KEY); login will be unavailable.');
    }
    console.log(`havsAI fullstack on http://localhost:${server.address().port} (ai=${ai.describe().provider})`);
  });
}

module.exports = { server, db };
