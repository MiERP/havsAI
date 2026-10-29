'use strict';

const root = document.getElementById('admin-root');
const modalRoot = document.getElementById('admin-modal-root');
const toastEl = document.getElementById('admin-toast');

const state = {
  session: null,
  csrf: '',
  tab: 'overview',
  loading: false,
  error: '',
  data: null,
  page: 1,
  q: '',
  userStatus: 'active',
  contentTab: 'chats',
  contentPage: 1,
  contentQ: '',
  palette: null,
  defaults: null,
  modal: null
};

const TABS = [
  ['overview', 'Tổng quan'],
  ['users', 'Tài khoản'],
  ['content', 'Nội dung'],
  ['appearance', 'Giao diện'],
  ['ai', 'AI'],
  ['audit', 'Audit'],
  ['password', 'Mật khẩu']
];

const CONTENT_TABS = [
  ['chats', 'Chats'],
  ['preps', 'Đề ôn'],
  ['uploads', 'Uploads'],
  ['lab', 'Lab apps'],
  ['calendar', 'Lịch'],
  ['attempts', 'Attempts'],
  ['parents', 'Parent links'],
  ['events', 'Events']
];

const PALETTE_LABELS = {
  bg: 'Nền',
  panel: 'Panel',
  panel2: 'Panel 2',
  line: 'Đường viền',
  text: 'Chữ',
  muted: 'Chữ mờ',
  accent: 'Accent (cam)',
  accent2: 'Accent 2 (xanh)',
  onAccent: 'Chữ trên accent',
  danger: 'Lỗi',
  ok: 'Thành công'
};
const PALETTE_KEYS = Object.keys(PALETTE_LABELS);

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPE[ch]);
const fmtDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('vi-VN');
};
const fmtBytes = (value) => {
  if (value == null) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};
const val = (id) => document.getElementById(id)?.value ?? '';
const checked = (id) => !!document.getElementById(id)?.checked;

let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3600);
}

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (state.csrf && options.method && !['GET', 'HEAD'].includes(options.method)) {
    headers['X-CSRF-Token'] = state.csrf;
  }
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (response.status === 401 && state.session) {
    state.session = null;
    state.csrf = '';
    state.modal = null;
    modalRoot.innerHTML = '';
    render();
    throw new Error('Phiên admin đã hết hạn.');
  }
  if (!response.ok) {
    const error = new Error(data.error || response.statusText);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

/* ------------------------------------------------------------------ login */

function renderLogin(message = '') {
  modalRoot.innerHTML = '';
  root.innerHTML = `<div class="admin-login"><div class="admin-card admin-login-card">
    <div class="admin-brand">havs<span>AI</span></div>
    <h1>Quản trị hệ thống</h1>
    <p>Đăng nhập bằng tài khoản admin.</p>
    <div class="admin-field"><label>Tên đăng nhập</label><input id="admin-username" autocomplete="username" value="admin" /></div>
    <div class="admin-field"><label>Mật khẩu</label><input id="admin-password" type="password" autocomplete="current-password" /></div>
    ${message ? `<div class="admin-error">${esc(message)}</div>` : ''}
    <button class="admin-btn" data-action="login">Đăng nhập</button>
  </div></div>`;
  document.getElementById('admin-password')?.focus();
}

async function login() {
  const username = val('admin-username').trim();
  const password = val('admin-password');
  if (!username || !password) return toast('Nhập tên đăng nhập và mật khẩu');
  try {
    const data = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    state.session = { username: data.username, mustChangePassword: data.mustChangePassword };
    state.csrf = data.csrf;
    state.tab = data.mustChangePassword ? 'password' : 'overview';
    state.page = 1;
    state.error = '';
    await loadTab();
  } catch (error) {
    renderLogin(error.status === 429 ? 'Quá nhiều lần thử, vui lòng đợi 10 phút.' : 'Sai tài khoản hoặc mật khẩu.');
  }
}

/* ------------------------------------------------------------------ shell */

function tabTitle() {
  return TABS.find(([id]) => id === state.tab)?.[1] || 'Quản trị';
}

function shellHtml() {
  return `<div class="admin-shell">
    <aside class="admin-sidebar">
      <div class="admin-brand">havs<span>AI</span></div>
      <div class="admin-muted admin-small">Admin console</div>
      <nav class="admin-nav">
        ${TABS.map(([id, label]) => `<button data-tab="${id}" class="${state.tab === id ? 'active' : ''}">${esc(label)}</button>`).join('')}
      </nav>
      <div class="admin-sidebar-foot">
        <div class="admin-muted admin-small">${esc(state.session.username)}</div>
        <button class="admin-btn ghost small" data-action="logout">Đăng xuất</button>
      </div>
    </aside>
    <main class="admin-main">
      ${state.session.mustChangePassword ? `<div class="admin-alert">Bạn đang dùng mật khẩu mặc định admin/admin. <button data-tab="password">Đổi ngay</button></div>` : ''}
      <div class="admin-topbar">
        <h1>${esc(tabTitle())}</h1>
        <div class="admin-grow"></div>
        <button class="admin-btn secondary small" data-action="refresh">Làm mới</button>
      </div>
      <div id="admin-main-content"></div>
    </main>
  </div>`;
}

function render() {
  if (!state.session) return renderLogin();
  root.innerHTML = shellHtml();
  renderMain();
  renderModal();
}

function renderMain() {
  const container = document.getElementById('admin-main-content');
  if (!container) return;
  if (state.loading) {
    container.innerHTML = '<div class="admin-empty">Đang tải…</div>';
    return;
  }
  if (state.error) {
    container.innerHTML = `<div class="admin-alert">${esc(state.error)} <button data-action="refresh">Thử lại</button></div>`;
    return;
  }
  container.innerHTML = renderTab();
}

async function loadTab() {
  state.loading = true;
  state.error = '';
  render();
  try {
    if (state.tab === 'overview') {
      state.data = await api('/api/admin/overview');
    } else if (state.tab === 'users') {
      state.data = await api(`/api/admin/users?q=${encodeURIComponent(state.q)}&status=${encodeURIComponent(state.userStatus)}&page=${state.page}`);
    } else if (state.tab === 'content') {
      state.data = await loadContentData();
    } else if (state.tab === 'appearance') {
      const data = await api('/api/admin/appearance');
      state.palette = data.palette;
      state.defaults = data.defaults;
      state.data = data;
    } else if (state.tab === 'ai') {
      state.data = await api('/api/admin/ai/providers');
    } else if (state.tab === 'audit') {
      state.data = await api(`/api/admin/audit?page=${state.page}`);
    } else {
      state.data = {};
    }
  } catch (error) {
    if (error.data?.error === 'password_change_required') {
      state.tab = 'password';
      state.error = '';
    } else {
      state.error = error.message;
    }
  }
  state.loading = false;
  render();
}

function renderTab() {
  if (state.tab === 'overview') return renderOverview();
  if (state.tab === 'users') return renderUsers();
  if (state.tab === 'content') return renderContent();
  if (state.tab === 'appearance') return renderAppearance();
  if (state.tab === 'ai') return renderAI();
  if (state.tab === 'audit') return renderAudit();
  if (state.tab === 'password') return renderPassword();
  return '';
}

/* --------------------------------------------------------------- overview */

function renderOverview() {
  const data = state.data || {};
  const users = data.users || {};
  const stats = [
    ['Người dùng', users.total || 0],
    ['Hoạt động', users.active || 0],
    ['Bị khóa', users.disabled || 0],
    ['Xóa mềm', users.deleted || 0],
    ['Chats', data.chats || 0],
    ['Messages', data.messages || 0],
    ['Đề ôn', data.preps || 0],
    ['Uploads', data.uploads || 0],
    ['Lab apps', data.labApps || 0],
    ['Attempts', data.attempts || 0]
  ];
  return `<div class="admin-grid">
      ${stats.map(([label, value]) => `<div class="admin-stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`).join('')}
    </div>
    <div class="admin-section admin-card">
      <h2>AI đang hoạt động</h2>
      <div class="admin-muted">Provider: <b>${esc(data.ai?.provider || '—')}</b> · Chat: <b>${esc(data.ai?.model || '—')}</b> · Vision: <b>${esc(data.ai?.visionModel || '—')}</b></div>
    </div>
    <div class="admin-section">
      <h2>Audit gần đây</h2>
      ${renderAuditRows(data.audit || [], true)}
    </div>`;
}

function renderAuditRows(rows, compact) {
  const body = rows.map((row) => `<tr>
    <td>${esc(fmtDate(row.created_at))}</td>
    <td>${esc(row.username || '—')}</td>
    <td>${esc(row.action)}</td>
    <td class="wrap">${esc([row.target_type, row.target_id].filter(Boolean).join(': ') || '—')}</td>
    ${compact ? '' : `<td>${esc(row.ip || '—')}</td>`}
  </tr>`).join('');
  return `<div class="admin-table-wrap"><table class="admin-table">
    <thead><tr><th>Thời gian</th><th>Admin</th><th>Hành động</th><th>Đối tượng</th>${compact ? '' : '<th>IP</th>'}</tr></thead>
    <tbody>${body || `<tr><td colspan="${compact ? 4 : 5}" class="admin-empty">Chưa có audit.</td></tr>`}</tbody>
  </table></div>`;
}

/* ------------------------------------------------------------------ users */

function renderUsers() {
  const data = state.data || {};
  const items = data.items || [];
  const rows = items.map((user) => {
    const status = user.deleted_at ? '<span class="admin-pill bad">Đã xóa</span>'
      : user.disabled ? '<span class="admin-pill warn">Bị khóa</span>'
        : '<span class="admin-pill ok">Hoạt động</span>';
    return `<tr>
      <td>${esc(user.email)}</td>
      <td>${esc(user.name || '—')}</td>
      <td>${esc(user.role || '—')}</td>
      <td>${esc(user.plan || 'free')}</td>
      <td class="num">${esc(user.usage_minutes || 0)} / ${esc(user.usage_limit ?? 30)}</td>
      <td>${status}</td>
      <td>${esc(fmtDate(user.created_at))}</td>
      <td><div class="admin-actions">
        <button class="admin-btn secondary small" data-action="user-edit" data-id="${esc(user.id)}">Sửa</button>
        ${user.disabled
          ? `<button class="admin-btn ghost small" data-action="user-enable" data-id="${esc(user.id)}">Mở khóa</button>`
          : `<button class="admin-btn ghost small" data-action="user-disable" data-id="${esc(user.id)}" data-label="${esc(user.email)}">Khóa</button>`}
        ${user.deleted_at
          ? `<button class="admin-btn ghost small" data-action="user-restore" data-id="${esc(user.id)}">Khôi phục</button>`
          : `<button class="admin-btn danger small" data-action="user-soft-delete" data-id="${esc(user.id)}" data-label="${esc(user.email)}">Xóa mềm</button>`}
        <button class="admin-btn ghost small" data-action="user-logout-all" data-id="${esc(user.id)}">Logout all</button>
      </div></td>
    </tr>`;
  }).join('');
  return `<div class="admin-toolbar">
      <input id="admin-user-q" class="admin-search" placeholder="Tìm email hoặc tên…" value="${esc(state.q)}" />
      <select id="admin-user-status">
        ${[['active', 'Hoạt động'], ['disabled', 'Bị khóa'], ['deleted', 'Đã xóa mềm'], ['all', 'Tất cả']]
          .map(([value, label]) => `<option value="${value}" ${state.userStatus === value ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      <button class="admin-btn secondary" data-action="user-search">Tìm</button>
    </div>
    <div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>Email</th><th>Tên</th><th>Role</th><th>Plan</th><th>Usage</th><th>Trạng thái</th><th>Tạo</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8" class="admin-empty">Không có tài khoản.</td></tr>'}</tbody>
    </table></div>
    ${pagination(data)}`;
}

async function editUser(id) {
  try {
    const data = await api(`/api/admin/users/${encodeURIComponent(id)}`);
    const profile = data.profile || {};
    const roleOptions = ['student', 'parent', 'teacher']
      .map((role) => `<option value="${role}" ${profile.role === role ? 'selected' : ''}>${role}</option>`).join('');
    openModal('Sửa tài khoản', `<div class="admin-form">
      <div class="admin-field"><label>Email</label><input value="${esc(data.user.email)}" disabled /></div>
      <div class="admin-field"><label>Tên</label><input id="edit-user-name" value="${esc(profile.name || '')}" /></div>
      <div class="admin-field"><label>Role</label><select id="edit-user-role">${roleOptions}</select></div>
      <div class="admin-field"><label>Plan</label><input id="edit-user-plan" value="${esc(profile.plan || 'free')}" /></div>
      <div class="admin-field"><label>Usage limit</label><input id="edit-user-limit" type="number" min="0" value="${esc(profile.usage_limit ?? 30)}" /></div>
      <div class="admin-field"><label>Usage minutes</label><input id="edit-user-minutes" type="number" min="0" value="${esc(profile.usage_minutes ?? 0)}" /></div>
      <div class="admin-field"><label>Trường</label><input id="edit-user-school" value="${esc(profile.school || '')}" /></div>
      <div class="admin-field"><label>Lớp</label><input id="edit-user-class" value="${esc(profile.class_name || '')}" /></div>
    </div>`, {
      onSave: async () => {
        await api(`/api/admin/users/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: val('edit-user-name'),
            role: val('edit-user-role'),
            plan: val('edit-user-plan'),
            usageLimit: Number(val('edit-user-limit')),
            usageMinutes: Number(val('edit-user-minutes')),
            school: val('edit-user-school'),
            className: val('edit-user-class')
          })
        });
        toast('Đã cập nhật tài khoản');
      }
    });
  } catch (error) {
    toast(error.message);
  }
}

async function userAction(id, action, label) {
  if (action === 'user-soft-delete') {
    return confirmTyped('Xóa mềm tài khoản', label, `Nhập email "${label}" để xác nhận xóa mềm:`, async () => {
      await api(`/api/admin/users/${encodeURIComponent(id)}/soft-delete`, { method: 'POST' });
      toast('Đã xóa mềm tài khoản');
    });
  }
  if (action === 'user-edit') return editUser(id);
  const messages = {
    'user-disable': 'Khóa tài khoản này?',
    'user-enable': 'Mở khóa tài khoản này?',
    'user-restore': 'Khôi phục tài khoản này?',
    'user-logout-all': 'Đăng xuất tất cả thiết bị của tài khoản này?'
  };
  if (!window.confirm(messages[action] || 'Tiếp tục?')) return;
  try {
    await api(`/api/admin/users/${encodeURIComponent(id)}/${action.replace('user-', '')}`, { method: 'POST' });
    toast('Đã cập nhật tài khoản');
    await loadTab();
  } catch (error) {
    toast(error.message);
  }
}

/* ---------------------------------------------------------------- content */

function contentEndpoint(kind) {
  const map = {
    chats: '/api/admin/chats',
    preps: '/api/admin/preps',
    uploads: '/api/admin/uploads',
    lab: '/api/admin/lab-apps',
    calendar: '/api/admin/calendar',
    attempts: '/api/admin/attempts',
    parents: '/api/admin/parent-links',
    events: '/api/admin/events'
  };
  return map[kind];
}

async function loadContentData() {
  const base = contentEndpoint(state.contentTab);
  const query = new URLSearchParams({ page: String(state.contentPage) });
  if (state.contentQ) query.set('q', state.contentQ);
  return api(`${base}?${query.toString()}`);
}

function renderContent() {
  const subtabs = CONTENT_TABS.map(([id, label]) =>
    `<button data-content-tab="${id}" class="${state.contentTab === id ? 'active' : ''}">${esc(label)}</button>`
  ).join('');
  return `<div class="admin-subtabs">${subtabs}</div>
    <div class="admin-toolbar">
      <input id="content-q" class="admin-search" placeholder="Tìm trong mục này…" value="${esc(state.contentQ)}" />
      <button class="admin-btn secondary" data-action="content-search">Tìm</button>
    </div>
    ${renderContentTable()}
    ${pagination(state.data || {})}`;
}

function renderContentTable() {
  const data = state.data || {};
  const items = data.items || [];
  const kind = state.contentTab;
  if (!items.length) return '<div class="admin-empty">Không có dữ liệu.</div>';

  if (kind === 'chats') {
    return `<div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>User</th><th>Tiêu đề</th><th>Môn</th><th>Messages</th><th>Tạo</th><th></th></tr></thead>
      <tbody>${items.map((row) => `<tr>
        <td>${esc(row.email)}</td><td class="wrap">${esc(row.title)}</td><td>${esc(row.subject)}</td>
        <td class="num">${esc(row.message_count)}</td><td>${esc(fmtDate(row.created_at))}</td>
        <td><div class="admin-actions">
          <button class="admin-btn secondary small" data-action="content-view" data-kind="chats" data-id="${esc(row.id)}">Xem</button>
          <button class="admin-btn danger small" data-action="content-delete" data-kind="chats" data-id="${esc(row.id)}" data-label="${esc(row.title)}">Xóa</button>
        </div></td></tr>`).join('')}</tbody></table></div>`;
  }
  if (kind === 'preps') {
    return `<div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>User</th><th>Tiêu đề</th><th>Môn</th><th>Trạng thái</th><th>Share</th><th>Attempts</th><th>Tạo</th><th></th></tr></thead>
      <tbody>${items.map((row) => `<tr>
        <td>${esc(row.email)}</td><td class="wrap">${esc(row.title)}</td><td>${esc(row.subject)}</td>
        <td>${esc(row.status)}</td><td>${row.share_id ? '<span class="admin-pill ok">Có</span>' : '<span class="admin-pill">Không</span>'}</td>
        <td class="num">${esc(row.attempt_count)}</td><td>${esc(fmtDate(row.created_at))}</td>
        <td><div class="admin-actions">
          <button class="admin-btn secondary small" data-action="content-view" data-kind="preps" data-id="${esc(row.id)}">Xem</button>
          ${row.share_id ? `<button class="admin-btn ghost small" data-action="prep-unshare" data-id="${esc(row.id)}">Unshare</button>` : ''}
          <button class="admin-btn danger small" data-action="content-delete" data-kind="preps" data-id="${esc(row.id)}" data-label="${esc(row.title)}">Xóa</button>
        </div></td></tr>`).join('')}</tbody></table></div>`;
  }
  if (kind === 'uploads') {
    return `<div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>User</th><th>File</th><th>MIME</th><th>Size</th><th>Extract</th><th>Trang</th><th>Tạo</th><th></th></tr></thead>
      <tbody>${items.map((row) => `<tr>
        <td>${esc(row.email)}</td><td class="wrap">${esc(row.filename)}</td><td>${esc(row.mime)}</td>
        <td>${esc(fmtBytes(row.size))} ${row.exists ? '' : '<span class="admin-pill bad">missing</span>'}</td>
        <td>${esc(row.extracted_kind || '—')}</td><td class="num">${esc(row.page_count ?? '—')}</td><td>${esc(fmtDate(row.created_at))}</td>
        <td><button class="admin-btn danger small" data-action="content-delete" data-kind="uploads" data-id="${esc(row.id)}" data-label="${esc(row.filename)}">Xóa</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  }
  if (kind === 'lab') {
    return `<div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>User</th><th>Tên</th><th>Slug</th><th>Visibility</th><th>Tạo</th><th></th></tr></thead>
      <tbody>${items.map((row) => `<tr>
        <td>${esc(row.email)}</td><td class="wrap">${esc(row.name)}</td><td>${esc(row.slug)}</td>
        <td><span class="admin-pill ${row.visibility === 'public' ? 'ok' : ''}">${esc(row.visibility)}</span></td>
        <td>${esc(fmtDate(row.created_at))}</td>
        <td><div class="admin-actions">
          <button class="admin-btn secondary small" data-action="content-view" data-kind="lab" data-id="${esc(row.id)}">Xem</button>
          <button class="admin-btn ghost small" data-action="lab-visibility" data-id="${esc(row.id)}" data-visibility="${esc(row.visibility)}">Đổi visibility</button>
          <button class="admin-btn danger small" data-action="content-delete" data-kind="lab" data-id="${esc(row.id)}" data-label="${esc(row.slug)}">Xóa</button>
        </div></td></tr>`).join('')}</tbody></table></div>`;
  }
  if (kind === 'calendar') {
    return `<div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>User</th><th>Tiêu đề</th><th>Ngày</th><th>Loại</th><th>Tạo</th><th></th></tr></thead>
      <tbody>${items.map((row) => `<tr>
        <td>${esc(row.email)}</td><td class="wrap">${esc(row.title)}</td><td>${esc(row.event_date)}</td><td>${esc(row.kind || '—')}</td>
        <td>${esc(fmtDate(row.created_at))}</td>
        <td><button class="admin-btn danger small" data-action="content-delete" data-kind="calendar" data-id="${esc(row.id)}" data-label="${esc(row.title)}">Xóa</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  }
  if (kind === 'attempts') {
    return `<div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>User</th><th>Đề</th><th>Loại</th><th>Điểm</th><th>Tạo</th><th></th></tr></thead>
      <tbody>${items.map((row) => `<tr>
        <td>${esc(row.email)}</td><td class="wrap">${esc(row.prep_title || '—')}</td><td>${esc(row.kind || '—')}</td>
        <td class="num">${esc(row.score)} / ${esc(row.total)}</td><td>${esc(fmtDate(row.created_at))}</td>
        <td><button class="admin-btn danger small" data-action="content-delete" data-kind="attempts" data-id="${esc(row.id)}" data-label="${esc(row.id)}">Xóa</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  }
  if (kind === 'parents') {
    return `<div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>Phụ huynh</th><th>Email con</th><th>Tên con</th><th>Trạng thái</th><th>Tạo</th><th></th></tr></thead>
      <tbody>${items.map((row) => `<tr>
        <td>${esc(row.parent_email || row.parent_user_id)}</td><td>${esc(row.child_email)}</td><td>${esc(row.child_name || '—')}</td>
        <td>${esc(row.status)}</td><td>${esc(fmtDate(row.created_at))}</td>
        <td><button class="admin-btn danger small" data-action="content-delete" data-kind="parents" data-id="${esc(row.id)}" data-label="${esc(row.child_email)}">Xóa</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  }
  return `<div class="admin-table-wrap"><table class="admin-table">
    <thead><tr><th>Event</th><th>User</th><th>Props</th><th>Tạo</th><th></th></tr></thead>
    <tbody>${items.map((row) => `<tr>
      <td>${esc(row.name)}</td><td>${esc(row.user_id || '—')}</td>
      <td class="wrap">${esc(JSON.stringify(row.props || {}).slice(0, 180))}</td>
      <td>${esc(fmtDate(row.created_at))}</td>
      <td><button class="admin-btn danger small" data-action="content-delete" data-kind="events" data-id="${esc(row.id)}" data-label="${esc(row.name)}">Xóa</button></td>
    </tr>`).join('')}</tbody></table></div>`;
}

async function viewContent(kind, id) {
  try {
    if (kind === 'chats') {
      const data = await api(`/api/admin/chats/${encodeURIComponent(id)}`);
      const messages = (data.messages || []).map((message) => `<div class="admin-card" style="margin-bottom:8px">
        <div class="admin-muted admin-small">${esc(message.role)} · ${esc(fmtDate(message.created_at))}</div>
        <pre class="admin-code">${esc(message.content)}</pre>
        ${message.image_url ? `<div class="admin-muted admin-small">${esc(message.image_url)}</div>` : ''}
      </div>`).join('');
      openModal(`Chat: ${data.chat.title}`, `<div class="admin-muted">${esc(data.chat.email)}</div><div style="margin-top:12px">${messages || '<div class="admin-empty">Không có tin nhắn.</div>'}</div>`);
      return;
    }
    if (kind === 'preps') {
      const data = await api(`/api/admin/preps/${encodeURIComponent(id)}`);
      const prep = data.prep || {};
      openModal(`Đề: ${prep.title}`, `<div class="admin-muted">${esc(prep.email)} · ${esc(prep.status)}</div>
        <pre class="admin-code">${esc(JSON.stringify({ plan: prep.plan, lessons: prep.lessons, challenges: prep.challenges, mockExams: prep.mockExams, mastery: prep.mastery }, null, 2))}</pre>`);
      return;
    }
    if (kind === 'lab') {
      const data = await api(`/api/admin/lab-apps/${encodeURIComponent(id)}`);
      const app = data.app || {};
      openModal(`Lab: ${app.name}`, `<div class="admin-muted">${esc(app.slug)} · ${esc(app.visibility)}</div>
        <iframe id="admin-lab-frame" class="admin-lab-frame" sandbox="allow-scripts"></iframe>`);
      const frame = document.getElementById('admin-lab-frame');
      if (frame) frame.srcdoc = app.html || '';
    }
  } catch (error) {
    toast(error.message);
  }
}

function deleteContent(kind, id, label) {
  const urls = {
    chats: `/api/admin/chats/${encodeURIComponent(id)}`,
    preps: `/api/admin/preps/${encodeURIComponent(id)}`,
    uploads: `/api/admin/uploads/${encodeURIComponent(id)}`,
    lab: `/api/admin/lab-apps/${encodeURIComponent(id)}`,
    calendar: `/api/admin/calendar/${encodeURIComponent(id)}`,
    attempts: `/api/admin/attempts/${encodeURIComponent(id)}`,
    parents: `/api/admin/parent-links/${encodeURIComponent(id)}`,
    events: `/api/admin/events/${encodeURIComponent(id)}`
  };
  const expected = label || id;
  confirmTyped('Xóa nội dung', expected, `Nhập "${expected}" để xác nhận xóa:`, async () => {
    await api(urls[kind], { method: 'DELETE' });
    toast('Đã xóa');
  });
}

/* ------------------------------------------------------------- appearance */

function previewStyle(palette) {
  return `--bg:${palette.bg};--panel:${palette.panel};--panel-2:${palette.panel2};--line:${palette.line};--text:${palette.text};--muted:${palette.muted};--accent:${palette.accent};--accent-2:${palette.accent2};--on-accent:${palette.onAccent};--danger:${palette.danger};--ok:${palette.ok};`;
}

function renderAppearance() {
  const palette = state.palette || state.defaults || { dark: {}, light: {} };
  const modes = [['dark', 'Dark'], ['light', 'Light']];
  return `<div class="admin-card">
    <p class="admin-muted">Màu áp dụng qua <code>/theme.css</code> cho toàn bộ app. Màn hình chào mừng vẫn nền trắng.</p>
    <div class="admin-grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));">
      ${modes.map(([mode, label]) => `<div>
        <h2>${esc(label)}</h2>
        <div class="admin-color-grid">
          ${PALETTE_KEYS.map((key) => `<label class="admin-color">
            <span>${esc(PALETTE_LABELS[key])}</span>
            <input type="color" data-mode="${mode}" data-key="${key}" value="${esc(palette[mode]?.[key] || '#000000')}" />
            <input type="text" data-mode="${mode}" data-key="${key}" value="${esc(palette[mode]?.[key] || '#000000')}" />
          </label>`).join('')}
        </div>
      </div>`).join('')}
    </div>
    <div id="admin-preview" class="admin-preview" style="${previewStyle(palette.dark)}">
      <b>Xem trước</b>
      <div class="preview-card">Nội dung mẫu <span class="preview-accent">Nút accent</span></div>
    </div>
    <div class="admin-actions" style="margin-top:14px">
      <button class="admin-btn" data-action="appearance-save">Lưu màu</button>
      <button class="admin-btn secondary" data-action="appearance-reset">Khôi phục mặc định</button>
    </div>
  </div>`;
}

function readPaletteInputs() {
  const palette = { dark: {}, light: {} };
  document.querySelectorAll('input[type="color"][data-mode][data-key]').forEach((input) => {
    palette[input.dataset.mode][input.dataset.key] = input.value;
  });
  return palette;
}

function updatePreview() {
  const preview = document.getElementById('admin-preview');
  if (!preview) return;
  const palette = readPaletteInputs();
  preview.setAttribute('style', previewStyle(palette.dark));
}

async function saveAppearance() {
  try {
    const palette = readPaletteInputs();
    await api('/api/admin/appearance', { method: 'PUT', body: JSON.stringify({ palette }) });
    state.palette = palette;
    toast('Đã lưu màu. Tải lại app để áp dụng.');
    await loadTab();
  } catch (error) {
    toast(error.message === 'invalid_palette' ? 'Mã màu không hợp lệ.' : error.message);
  }
}

async function resetAppearance() {
  if (!window.confirm('Khôi phục toàn bộ màu về mặc định?')) return;
  try {
    await api('/api/admin/appearance/reset', { method: 'POST' });
    toast('Đã khôi phục màu mặc định');
    await loadTab();
  } catch (error) {
    toast(error.message);
  }
}

/* --------------------------------------------------------------------- AI */

function renderAI() {
  const data = state.data || {};
  const items = data.items || [];
  const rows = items.map((provider) => `<tr>
    <td>${esc(provider.name)}</td>
    <td>${esc(provider.kind)}</td>
    <td>${esc(provider.provider)}</td>
    <td>${esc(provider.model || '—')}${provider.fallbackModel ? `<div class="admin-muted admin-small">fallback: ${esc(provider.fallbackModel)}</div>` : ''}</td>
    <td>${provider.isDefault ? '<span class="admin-pill ok">default</span>' : '<span class="admin-pill">—</span>'}</td>
    <td>${provider.enabled ? '<span class="admin-pill ok">on</span>' : '<span class="admin-pill bad">off</span>'}</td>
    <td>${provider.hasKey ? `<span class="admin-pill">${esc(provider.keyHint || 'có key')}</span>` : '<span class="admin-pill bad">no key</span>'}</td>
    <td><div class="admin-actions">
      <button class="admin-btn secondary small" data-action="ai-edit" data-id="${esc(provider.id)}">Sửa</button>
      <button class="admin-btn ghost small" data-action="ai-test" data-id="${esc(provider.id)}">Test</button>
      <button class="admin-btn ghost small" data-action="ai-default" data-id="${esc(provider.id)}">Default</button>
      <button class="admin-btn danger small" data-action="ai-delete" data-id="${esc(provider.id)}" data-label="${esc(provider.name)}">Xóa</button>
    </div></td>
  </tr>`).join('');
  return `<div class="admin-card admin-section">
      <h2>Đang hoạt động</h2>
      <div class="admin-muted">Provider: <b>${esc(data.active?.provider || '—')}</b> · Chat: <b>${esc(data.active?.model || '—')}</b> · Vision: <b>${esc(data.active?.visionModel || '—')}</b></div>
    </div>
    <div class="admin-card admin-section" style="margin-top:14px">
      <h2>Đổi / Thêm tài khoản Command Code nhanh</h2>
      <p class="admin-muted admin-small">Dán trực tiếp <b>API Key Command Code</b> (dạng <code>user_...</code>) hoặc toàn bộ nội dung file <code>~/.commandcode/auth.json</code> để tự động cấu hình cả Chat (<code>deepseek/deepseek-v4.1-flash</code>) và Vision (<code>deepseek/deepseek-v4-flash-vision-exp</code>).</p>
      <div class="admin-form" style="margin-top:10px">
        <div class="admin-field"><label>Tên gợi nhớ tài khoản (tùy chọn)</label><input id="cc-name" placeholder="VD: Command Code Tài khoản 2 (tự nhận nếu dán auth.json)" /></div>
        <div class="admin-field"><label>Command Code API Key hoặc nội dung auth.json</label><textarea id="cc-key" rows="3" style="width:100%;padding:10px;border-radius:10px;background:var(--panel-2,#152411);border:1px solid var(--line,#233a1c);color:var(--text,#f4f7f1);font-family:monospace" placeholder='user_... hoặc {"apiKey":"user_...","userName":"..."}'></textarea></div>
        <div class="admin-field"><label>Chế độ lưu</label>
          <select id="cc-mode">
            <option value="add">Thêm tài khoản mới & đặt làm mặc định (giữ tài khoản cũ để chuyển đổi)</option>
            <option value="replace">Cập nhật ghi đè tài khoản Command Code hiện tại</option>
          </select>
        </div>
      </div>
      <div class="admin-actions" style="margin-top:12px">
        <button class="admin-btn" data-action="ai-commandcode-save">Lưu & Kích hoạt tài khoản Command Code</button>
      </div>
    </div>
    <div class="admin-toolbar"><button class="admin-btn secondary" data-action="ai-add">＋ Thêm provider thủ công</button></div>
    <div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>Tên</th><th>Kind</th><th>Provider</th><th>Model</th><th>Default</th><th>Bật</th><th>Key</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8" class="admin-empty">Chưa cấu hình provider.</td></tr>'}</tbody>
    </table></div>`;
}

async function saveCommandCodeAccount() {
  const name = val('cc-name').trim();
  const apiKey = val('cc-key').trim();
  const mode = val('cc-mode') || 'add';
  if (!apiKey) return toast('Vui lòng nhập API key hoặc nội dung auth.json của Command Code');
  try {
    const res = await api('/api/admin/ai/commandcode', {
      method: 'POST',
      body: JSON.stringify({ name, apiKey, mode })
    });
    if (res.testResult?.ok) {
      toast(`Đã kích hoạt tài khoản Command Code thành công (${res.testResult.latencyMs} ms)`);
    } else {
      toast(`Đã lưu nhưng kiểm tra kết nối báo: ${res.testResult?.error || 'chưa kết nối được'}`);
    }
    await loadTab();
  } catch (error) {
    toast(error.message === 'invalid_auth_json' ? 'Nội dung JSON auth.json không hợp lệ' : error.message);
  }
}

function providerForm(provider) {
  const p = provider || { kind: 'chat', provider: 'commandcode', enabled: true, isDefault: false, reasoningEffort: '' };
  const options = (values, current) => values.map((value) =>
    `<option value="${value}" ${value === current ? 'selected' : ''}>${value}</option>`
  ).join('');
  return `<div class="admin-form">
    <div class="admin-field"><label>Tên</label><input id="ai-name" value="${esc(p.name || '')}" /></div>
    <div class="admin-field"><label>Kind</label><select id="ai-kind">${options(['chat', 'vision'], p.kind)}</select></div>
    <div class="admin-field"><label>Provider</label><select id="ai-provider">${options(['commandcode', 'deepseek', 'openai-compatible', 'mock'], p.provider)}</select></div>
    <div class="admin-field"><label>Base URL</label><input id="ai-base" value="${esc(p.baseUrl || '')}" placeholder="https://..." /></div>
    <div class="admin-field"><label>Model</label><input id="ai-model" value="${esc(p.model || '')}" /></div>
    <div class="admin-field"><label>Fallback model</label><input id="ai-fallback" value="${esc(p.fallbackModel || '')}" /></div>
    <div class="admin-field"><label>Reasoning effort</label><select id="ai-reasoning">${options(['', 'off', 'low', 'medium', 'high'], p.reasoningEffort || '')}</select></div>
    <div class="admin-field"><label>API key ${p.hasKey ? `(hiện tại ${esc(p.keyHint || '')})` : ''}</label><input id="ai-key" type="password" placeholder="${p.hasKey ? 'Để trống để giữ key cũ' : 'Nhập API key'}" /></div>
    <div class="admin-field"><label><input type="checkbox" id="ai-enabled" ${p.enabled !== false ? 'checked' : ''} /> Bật</label></div>
    <div class="admin-field"><label><input type="checkbox" id="ai-default" ${p.isDefault ? 'checked' : ''} /> Default cho kind</label></div>
    ${p.id ? '<div class="admin-field"><label><input type="checkbox" id="ai-clear-key" /> Xóa key hiện tại</label></div>' : ''}
  </div>`;
}

async function saveProvider(id) {
  const body = {
    name: val('ai-name'),
    kind: val('ai-kind'),
    provider: val('ai-provider'),
    baseUrl: val('ai-base'),
    model: val('ai-model'),
    fallbackModel: val('ai-fallback'),
    reasoningEffort: val('ai-reasoning'),
    enabled: checked('ai-enabled'),
    isDefault: checked('ai-default')
  };
  const key = val('ai-key');
  if (key) body.apiKey = key;
  if (id && checked('ai-clear-key')) body.clearKey = true;
  if (id) await api(`/api/admin/ai/providers/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  else await api('/api/admin/ai/providers', { method: 'POST', body: JSON.stringify(body) });
  toast('Đã lưu provider');
}

function editProvider(id) {
  const provider = (state.data?.items || []).find((item) => item.id === id);
  if (!provider) return toast('Không tìm thấy provider');
  openModal(provider.name, providerForm(provider), {
    onSave: () => saveProvider(provider.id)
  });
}

async function providerAction(id, action, label) {
  if (action === 'ai-delete') {
    return confirmTyped('Xóa provider', label, `Nhập "${label}" để xác nhận xóa:`, async () => {
      await api(`/api/admin/ai/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Đã xóa provider');
    });
  }
  try {
    if (action === 'ai-default') {
      await api(`/api/admin/ai/providers/${encodeURIComponent(id)}/default`, { method: 'POST' });
      toast('Đã đặt default');
      await loadTab();
      return;
    }
    if (action === 'ai-test') {
      const result = await api(`/api/admin/ai/providers/${encodeURIComponent(id)}/test`, { method: 'POST' });
      toast(result.ok ? `Kết nối OK (${result.latencyMs} ms)` : `Lỗi: ${result.error || 'không kết nối được'}`);
    }
  } catch (error) {
    toast(error.message);
  }
}

/* ------------------------------------------------------------- audit/password */

function renderAudit() {
  return `${renderAuditRows(state.data?.items || [], false)}${pagination(state.data || {})}`;
}

function renderPassword() {
  return `<div class="admin-card" style="max-width:560px">
    ${state.session.mustChangePassword ? '<div class="admin-alert">Đang dùng mật khẩu mặc định admin/admin. Hãy đổi ngay.</div>' : ''}
    <div class="admin-field"><label>Mật khẩu hiện tại</label><input id="pw-current" type="password" autocomplete="current-password" /></div>
    <div class="admin-field"><label>Mật khẩu mới</label><input id="pw-new" type="password" autocomplete="new-password" /></div>
    <div class="admin-field"><label>Nhập lại mật khẩu mới</label><input id="pw-confirm" type="password" autocomplete="new-password" /></div>
    <button class="admin-btn" data-action="password-save">Đổi mật khẩu</button>
  </div>`;
}

async function savePassword() {
  const current = val('pw-current');
  const next = val('pw-new');
  const confirm = val('pw-confirm');
  if (next.length < 6) return toast('Mật khẩu mới phải có ít nhất 6 ký tự');
  if (next !== confirm) return toast('Mật khẩu nhập lại không khớp');
  try {
    await api('/api/admin/password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }) });
    state.session.mustChangePassword = false;
    toast('Đã đổi mật khẩu');
    await loadTab();
  } catch (error) {
    toast(error.message === 'invalid_current_password' ? 'Mật khẩu hiện tại không đúng' : error.message);
  }
}

/* ---------------------------------------------------------------- pagination */

function pagination(data) {
  const page = Number(data.page || 1);
  const pageSize = Number(data.pageSize || 25);
  const total = Number(data.total || 0);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `<div class="admin-pagination">
    <button class="admin-btn ghost small" data-action="page-prev" ${page <= 1 ? 'disabled' : ''}>←</button>
    <span>Trang ${page}/${pages} · ${total} bản ghi</span>
    <button class="admin-btn ghost small" data-action="page-next" ${page >= pages ? 'disabled' : ''}>→</button>
  </div>`;
}

/* ------------------------------------------------------------------ modal */

function openModal(title, body, options = {}) {
  state.modal = {
    title,
    body,
    saveLabel: options.saveLabel || 'Lưu',
    danger: !!options.danger,
    onSave: options.onSave || null
  };
  renderModal();
}

function renderModal() {
  if (!state.modal) {
    modalRoot.innerHTML = '';
    return;
  }
  modalRoot.innerHTML = `<div class="admin-modal-back">
    <div class="admin-modal">
      <div class="admin-modal-head">
        <h2>${esc(state.modal.title)}</h2>
        <button class="admin-btn ghost small" data-action="modal-close">Đóng</button>
      </div>
      <div>${state.modal.body}</div>
      <div class="admin-modal-foot">
        <button class="admin-btn secondary" data-action="modal-close">Hủy</button>
        ${state.modal.onSave ? `<button class="admin-btn ${state.modal.danger ? 'danger' : ''}" data-action="modal-save">${esc(state.modal.saveLabel)}</button>` : ''}
      </div>
    </div>
  </div>`;
}

function closeModal() {
  state.modal = null;
  modalRoot.innerHTML = '';
}

async function modalSave() {
  if (!state.modal?.onSave) return;
  try {
    await state.modal.onSave();
    closeModal();
    await loadTab();
  } catch (error) {
    toast(error.message);
  }
}

function confirmTyped(title, expected, message, onConfirm) {
  openModal(title, `<div class="admin-field"><label>${esc(message)}</label><input id="confirm-expected" autocomplete="off" /></div>`, {
    saveLabel: 'Xóa',
    danger: true,
    onSave: async () => {
      const value = val('confirm-expected').trim();
      if (value !== expected) throw new Error('Giá trị xác nhận không đúng');
      await onConfirm();
    }
  });
  document.getElementById('confirm-expected')?.focus();
}

/* ------------------------------------------------------------------ events */

root.addEventListener('click', async (event) => {
  const tabButton = event.target.closest('[data-tab]');
  if (tabButton) {
    state.tab = tabButton.dataset.tab;
    state.page = 1;
    state.error = '';
    await loadTab();
    return;
  }
  const contentTab = event.target.closest('[data-content-tab]');
  if (contentTab) {
    state.contentTab = contentTab.dataset.contentTab;
    state.contentPage = 1;
    state.contentQ = '';
    await loadTab();
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id || '';
  const label = button.dataset.label || '';

  if (action === 'login') return login();
  if (action === 'logout') {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
    state.session = null;
    state.csrf = '';
    state.modal = null;
    renderLogin();
    return;
  }
  if (action === 'refresh') return loadTab();
  if (action === 'user-search') {
    state.q = val('admin-user-q').trim();
    state.page = 1;
    return loadTab();
  }
  if (action === 'user-edit') return editUser(id);
  if (action.startsWith('user-')) return userAction(id, action, label);
  if (action === 'page-prev' || action === 'page-next') {
    const delta = action === 'page-next' ? 1 : -1;
    if (state.tab === 'content') state.contentPage = Math.max(1, state.contentPage + delta);
    else state.page = Math.max(1, state.page + delta);
    return loadTab();
  }
  if (action === 'content-search') {
    state.contentQ = val('content-q').trim();
    state.contentPage = 1;
    return loadTab();
  }
  if (action === 'content-view') return viewContent(button.dataset.kind, id);
  if (action === 'content-delete') return deleteContent(button.dataset.kind, id, label);
  if (action === 'prep-unshare') {
    if (!window.confirm('Thu hồi link chia sẻ của đề này?')) return;
    try {
      await api(`/api/admin/preps/${encodeURIComponent(id)}/unshare`, { method: 'POST' });
      toast('Đã thu hồi share');
      await loadTab();
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'lab-visibility') {
    const next = button.dataset.visibility === 'public' ? 'private' : 'public';
    try {
      await api(`/api/admin/lab-apps/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ visibility: next }) });
      toast(`Đã đổi visibility sang ${next}`);
      await loadTab();
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'appearance-save') return saveAppearance();
  if (action === 'appearance-reset') return resetAppearance();
  if (action === 'ai-commandcode-save') return saveCommandCodeAccount();
  if (action === 'ai-add') return openModal('Thêm provider', providerForm(null), { onSave: () => saveProvider(null) });
  if (action === 'ai-edit') return editProvider(id);
  if (action === 'ai-delete' || action === 'ai-default' || action === 'ai-test') return providerAction(id, action, label);
  if (action === 'password-save') return savePassword();
});

root.addEventListener('input', (event) => {
  const input = event.target.closest('input[data-mode][data-key]');
  if (!input) return;
  const mode = input.dataset.mode;
  const key = input.dataset.key;
  if (input.type === 'color') {
    const text = document.querySelector(`input[type="text"][data-mode="${mode}"][data-key="${key}"]`);
    if (text) text.value = input.value;
  } else if (/^#[0-9a-f]{6}$/i.test(input.value)) {
    const color = document.querySelector(`input[type="color"][data-mode="${mode}"][data-key="${key}"]`);
    if (color) color.value = input.value;
  }
  updatePreview();
});

root.addEventListener('change', (event) => {
  if (event.target.id === 'admin-user-status') {
    state.userStatus = event.target.value;
    state.page = 1;
    loadTab();
  }
});

root.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  if (event.target.id === 'admin-user-q') {
    event.preventDefault();
    state.q = val('admin-user-q').trim();
    state.page = 1;
    loadTab();
  } else if (event.target.id === 'content-q') {
    event.preventDefault();
    state.contentQ = val('content-q').trim();
    state.contentPage = 1;
    loadTab();
  } else if (event.target.id === 'admin-password') {
    event.preventDefault();
    login();
  }
});

modalRoot.addEventListener('click', async (event) => {
  if (event.target.classList.contains('admin-modal-back')) return closeModal();
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.dataset.action === 'modal-close') return closeModal();
  if (button.dataset.action === 'modal-save') return modalSave();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.modal) closeModal();
});

async function boot() {
  try {
    const session = await api('/api/admin/session');
    if (session.authenticated) {
      state.session = { username: session.username, mustChangePassword: session.mustChangePassword };
      state.csrf = session.csrf;
      await loadTab();
      return;
    }
  } catch {}
  renderLogin();
}

boot();
