const SUBJECTS = [
  ['math', 'Toán'], ['physics', 'Lý'], ['chemistry', 'Hóa'], ['cs', 'Tin'],
  ['english', 'Anh'], ['german', 'Đức'], ['spanish', 'Tây Ban Nha'], ['french', 'Pháp'],
  ['biology', 'Sinh'], ['geography', 'Địa'], ['history', 'Sử'], ['literature', 'Văn'],
  ['economics', 'Kinh tế']
];
const SUBJECT_META = {
  math: '🧮', physics: '⚛️', chemistry: '⚗️', biology: '🧬', english: '🇬🇧',
  german: '🇩🇪', spanish: '🇪🇸', french: '🇫🇷', literature: '📖', history: '🏛️',
  geography: '🌍', cs: '💻', economics: '📈'
};
const VOICE_LABELS = { neil: 'Neil', aria: 'Aria', minh: 'Minh', lena: 'Lena' };
const PROMPTS = {
  math: ['Giải phương trình bậc 2', 'Tóm tắt công thức lượng giác', 'Luyện đề đạo hàm'],
  physics: ['Định luật Newton', 'Bài tập mạch điện', 'Sóng cơ là gì?'],
  chemistry: ['Cân bằng phương trình', 'Tính số mol', 'Bảng tuần hoàn'],
  english: ['Sửa lỗi ngữ pháp', 'Viết đoạn văn 150 từ', 'Thì hiện tại hoàn thành'],
  default: ['Giải thích khái niệm này', 'Cho mình ví dụ', 'Tóm tắt kiến thức']
};

const state = {
  session: null, profile: null, user: null,
  view: 'boot', tab: 'chat', error: '',
  route: { name: 'chat', params: {} }, routeError: '',
  chats: [], chatId: null, messages: [], subject: 'math',
  streaming: false, imageUrl: null, uploadId: null, uploadName: '', uploadPages: 0, uploadMime: '', voiceOn: true,
  listening: false, draft: '', examWizard: null,
  voices: [], preps: [], dashboard: null,
  realtime: null, live: false, prepPlan: null,
  examPreps: [], exam: null, examMode: 'all', examQuery: '', examCatalog: [], examShared: [], curriculum: {}, past: null,
  attempt: null, labApps: [], labApp: null, calendar: [], showcase: null, teacher: null, teacherPreps: [], child: null, share: null, settings: {},
  chatDrawerOpen: false, chatFilter: '', dragOver: false,
  installPrompt: null, nativePort: null, nativeDevice: null, nativePush: null,
  onboarding: { step: 0, role: 'student', name: '', age: '', country: 'Việt Nam', subjects: ['math'], voice: 'neil', goal: 'general', examDate: '', childEmail: '', school: '', className: '' }
};

const pendingNativeCallbacks = new Map();

const havsPlatform = {
  get runtime() {
    if (state.nativePort) return 'android-twa';
    try {
      if (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone === true) return 'pwa';
    } catch {}
    return 'web';
  },
  runtimeLabel() {
    const rt = this.runtime;
    if (rt === 'android-twa') return 'Android App (TWA)';
    if (rt === 'pwa') return 'Ứng dụng đã cài (PWA)';
    return 'Trình duyệt Web';
  },
  deviceSummary() {
    if (state.nativeDevice) {
      const d = state.nativeDevice;
      return [d.manufacturer, d.model, d.osVersion ? `Android ${d.osVersion}` : ''].filter(Boolean).join(' · ') || 'Android';
    }
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/i.test(ua)) return 'iOS / iPadOS';
    if (/Android/i.test(ua)) return 'Android Browser';
    if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS Desktop';
    if (/Windows/i.test(ua)) return 'Windows Desktop';
    if (/Linux/i.test(ua)) return 'Linux Desktop';
    return navigator.platform || 'Web Browser';
  },
  pushStatusLabel() {
    if (state.nativePush && typeof state.nativePush.enabled === 'boolean') {
      return state.nativePush.enabled ? 'Đã bật (Android)' : 'Đã tắt (Android)';
    }
    if (typeof Notification !== 'undefined') {
      if (Notification.permission === 'granted') return 'Đã bật (Web)';
      if (Notification.permission === 'denied') return 'Bị chặn trên trình duyệt';
      return 'Chưa bật';
    }
    return 'Không hỗ trợ trên trình duyệt này';
  },
  send(type, payload = {}) {
    if (!state.nativePort) return Promise.resolve(null);
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingNativeCallbacks.delete(id);
        resolve(null);
      }, 4000);
      pendingNativeCallbacks.set(id, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
      try {
        state.nativePort.postMessage(JSON.stringify({ id, type, payload }));
      } catch {
        clearTimeout(timer);
        pendingNativeCallbacks.delete(id);
        resolve(null);
      }
    });
  },
  handleNativeMessage(raw) {
    let msg = raw;
    if (typeof raw === 'string') {
      try { msg = JSON.parse(raw); } catch { return; }
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.id && pendingNativeCallbacks.has(msg.id)) {
      const cb = pendingNativeCallbacks.get(msg.id);
      pendingNativeCallbacks.delete(msg.id);
      cb(msg.data || msg);
    }
    if (msg.type === 'havs-push-permission-status' && msg.data) {
      state.nativePush = { ...(state.nativePush || {}), ...msg.data };
      render();
    }
  },
  identify(user, profile) {
    if (!user) return;
    this.send('havs-identify', {
      userId: String(user.id || ''),
      email: String(user.email || ''),
      name: String(profile?.name || '')
    });
  },
  setTheme(theme) {
    const mode = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = mode;
    this.send('havs-set-theme', { theme: mode });
  },
  syncRoute(path) {
    this.send('havs_route', { path: String(path || '/') });
  },
  track(event, props = {}) {
    if (state.nativePort) this.send('havs-track-event', { event, props });
    fetch('/api/events', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: event, props: { ...props, runtime: this.runtime } })
    }).catch(() => {});
  },
  async requestPush() {
    if (state.nativePort) {
      await this.send('havs-request-push-permission', {});
      const push = await this.send('havs-push-state', {});
      if (push) state.nativePush = push;
      toast('Đã gửi yêu cầu thông báo tới Android');
      render();
      return;
    }
    if (typeof Notification === 'undefined') {
      toast('Trình duyệt hiện tại chưa hỗ trợ Web Notifications');
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        toast('Đã bật thông báo trên trình duyệt');
        try { new Notification('havsAI', { body: 'Thông báo học tập đã sẵn sàng!', icon: '/icon.svg' }); } catch {}
      } else {
        toast('Quyền thông báo chưa được cấp');
      }
      render();
    } catch {
      toast('Không yêu cầu được quyền thông báo');
    }
  },
  async installApp() {
    if (this.runtime === 'android-twa' || this.runtime === 'pwa') {
      toast('havsAI đang chạy ở chế độ ứng dụng');
      return;
    }
    if (state.installPrompt) {
      try {
        state.installPrompt.prompt();
        const choice = await state.installPrompt.userChoice;
        if (choice?.outcome === 'accepted') {
          state.installPrompt = null;
          toast('Đã cài đặt ứng dụng havsAI');
        }
        render();
      } catch {}
      return;
    }
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/i.test(ua)) {
      toast('Trên iPhone/iPad: bấm nút Chia sẻ (⬆) → "Thêm vào MH chính"');
    } else {
      toast('Trên máy tính/Android: bấm biểu tượng Cài đặt (⊕) trên thanh địa chỉ trình duyệt');
    }
  }
};
window.havsPlatform = havsPlatform;

window.addEventListener('message', (event) => {
  const candidate = event.ports && event.ports[0];
  let parsed = null;
  if (typeof event.data === 'string') {
    try { parsed = JSON.parse(event.data); } catch {}
  } else if (event.data && typeof event.data === 'object') {
    parsed = event.data;
  }
  if (candidate || parsed?.type === 'havs-native-ready') {
    if (candidate) {
      state.nativePort = candidate;
      candidate.onmessage = (msgEvent) => havsPlatform.handleNativeMessage(msgEvent.data);
    }
    havsPlatform.send('havs-device-info', {}).then((info) => { if (info) { state.nativeDevice = info; render(); } });
    havsPlatform.send('havs-push-state', {}).then((push) => { if (push) { state.nativePush = push; render(); } });
    if (state.user) havsPlatform.identify(state.user, state.profile);
    if (state.profile?.theme) havsPlatform.setTheme(state.profile.theme);
    havsPlatform.syncRoute(location.pathname + location.search);
    return;
  }
  if (parsed) havsPlatform.handleNativeMessage(parsed);
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.installPrompt = event;
  if (state.view === 'main') render();
});

window.addEventListener('appinstalled', () => {
  state.installPrompt = null;
  toast('Đã cài đặt havsAI vào thiết bị');
  if (state.view === 'main') render();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
let toastTimer = null;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(path, { credentials: 'same-origin', ...options, headers });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const error = new Error(data.error || res.statusText);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

function subjectName(id) {
  return (SUBJECTS.find(([key]) => key === id) || [id, id])[1];
}

function render() {
  if (state.view === 'boot') app.innerHTML = renderBoot();
  else if (state.view === 'login') app.innerHTML = renderLogin();
  else if (state.view === 'onboarding') app.innerHTML = renderOnboarding();
  else app.innerHTML = renderMain();
  window.scrollTo({ top: 0 });
}

function renderBoot() {
  return `<div class="screen center pad splash"><div class="center-text"><div class="logo" style="font-size:28px">havs<span>AI</span></div><p style="margin-top:10px">Đang kết nối…</p></div></div>`;
}

function renderLogin() {
  return `<div class="screen center pad">
    <div class="center-text" style="margin-bottom:26px">
      <div class="logo" style="font-size:30px">havs<span>AI</span></div>
      <h1 style="margin-top:18px">Gia sư AI 24/7 cho mọi môn học</h1>
      <p>Đăng nhập bằng email để bắt đầu. havsAI dùng OTP dev: <b>123456</b>.</p>
    </div>
    <div class="card">
      <div class="field"><label>Email</label><input id="email" class="input" type="email" inputmode="email" placeholder="ban@example.com" autocomplete="email" /></div>
      <div class="field"><label>Mã OTP</label><input id="code" class="input" inputmode="numeric" placeholder="123456" autocomplete="one-time-code" /></div>
      <div class="row">
        <button class="btn secondary" data-action="send-code">Gửi mã</button>
        <button class="btn" data-action="verify">Đăng nhập</button>
      </div>
      ${state.error ? `<p style="color:var(--danger);margin-top:12px">${esc(state.error)}</p>` : ''}
    </div>
  </div>`;
}

function renderOnboarding() {
  const o = state.onboarding;
  const steps = [0, 1, 2, 3, 4];
  let body = '';
  if (o.step === 0) {
    body = `<h1>Bạn đang dùng havsAI với vai trò nào?</h1><p>Chúng mình sẽ cá nhân hoá lộ trình học cho bạn.</p>
      <div class="list">${[['student', 'Học sinh'], ['parent', 'Phụ huynh'], ['teacher', 'Giáo viên']].map(([id, label]) =>
        `<button class="item" data-action="role" data-value="${id}" style="text-align:left;border-color:${o.role === id ? 'var(--accent)' : 'var(--line)'}"><h3>${label}</h3><p>${id === 'student' ? 'Học tập, luyện đề và hỏi bài.' : id === 'parent' ? 'Theo dõi tiến độ của con.' : 'Soạn bài và quản lý lớp.'}</p></button>`).join('')}</div>`;
  } else if (o.step === 1) {
    body = `<h1>Giới thiệu về bạn</h1><p>Tên và tuổi giúp havsAI chọn cách giải thích phù hợp.</p>
      <div class="field"><label>Tên</label><input id="ob-name" class="input" value="${esc(o.name)}" placeholder="Tên của bạn" /></div>
      <div class="field"><label>Tuổi</label><input id="ob-age" class="input" inputmode="numeric" value="${esc(o.age)}" placeholder="16" /></div>
      ${o.role === 'parent' ? `<div class="field"><label>Email của con (tuỳ chọn)</label><input id="ob-child" class="input" type="email" value="${esc(o.childEmail)}" placeholder="con@example.com" /><span class="small">havsAI sẽ liên kết tài khoản con để bạn xem tiến độ.</span></div>` : ''}
      ${o.role === 'teacher' ? `<div class="field"><label>Trường</label><input id="ob-school" class="input" value="${esc(o.school)}" placeholder="Tên trường" /></div>
        <div class="field"><label>Lớp phụ trách</label><input id="ob-class" class="input" value="${esc(o.className)}" placeholder="10A1" /></div>` : ''}`;
  } else if (o.step === 2) {
    body = `<h1>Bạn muốn học môn nào?</h1><p>Chọn một hoặc nhiều môn.</p>
      <div class="chips">${SUBJECTS.map(([id, label]) => `<button class="chip ${o.subjects.includes(id) ? 'active' : ''}" data-action="subject" data-value="${id}">${label}</button>`).join('')}</div>
      <div class="field" style="margin-top:18px"><label>Quốc gia</label><input id="ob-country" class="input" value="${esc(o.country)}" /></div>`;
  } else if (o.step === 3) {
    body = `<h1>Chọn giọng nói</h1><p>Bạn có thể đổi bất cứ lúc nào trong Cài đặt.</p>
      ${state.voices.map((v) => `<div class="voice-card ${o.voice === v.id ? 'active' : ''}" data-action="voice" data-value="${v.id}">
        <div class="avatar">${esc(v.name[0])}</div>
        <div class="grow"><b>${esc(v.name)}</b><p style="margin:2px 0 0">${esc(v.locale)} · ${v.gender === 'male' ? 'Nam' : 'Nữ'}</p></div>
        <button class="btn ghost" data-action="preview-voice" data-value="${v.id}">Nghe thử</button>
      </div>`).join('')}
      <div class="voice-card ${o.voice === 'none' ? 'active' : ''}" data-action="voice" data-value="none">
        <div class="avatar">×</div><div class="grow"><b>Không dùng giọng nói</b><p style="margin:2px 0 0">Chỉ trả lời bằng văn bản</p></div>
      </div>`;
  } else {
    body = `<h1>Mục tiêu của bạn</h1><p>havsAI sẽ xây lộ trình theo mục tiêu này.</p>
      <div class="list">
        <button class="item" data-action="goal" data-value="general" style="text-align:left;border-color:${o.goal === 'general' ? 'var(--accent)' : 'var(--line)'}"><h3>Học đều mỗi ngày</h3><p>Hiểu bài, làm bài tập và tiến bộ từng tuần.</p></button>
        <button class="item" data-action="goal" data-value="exam" style="text-align:left;border-color:${o.goal === 'exam' ? 'var(--accent)' : 'var(--line)'}"><h3>Ôn thi cấp tốc</h3><p>Tập trung vào đề thi và mục tiêu điểm số.</p></button>
      </div>
      ${o.goal === 'exam' ? `<div class="field" style="margin-top:14px"><label>Ngày thi (tuỳ chọn)</label><input id="ob-exam" class="input" type="date" value="${esc(o.examDate)}" /></div>` : ''}`;
  }
  return `<div class="screen pad">
    <div class="steps">${steps.map((s) => `<span class="${s <= o.step ? 'on' : ''}"></span>`).join('')}</div>
    ${body}
    <div style="flex:1"></div>
    <div class="row" style="margin-top:22px">
      ${o.step > 0 ? `<button class="btn secondary" data-action="ob-back">Quay lại</button>` : ''}
      <button class="btn" data-action="ob-next">${o.step === 4 ? 'Hoàn tất' : 'Tiếp tục'}</button>
    </div>
  </div>`;
}

function renderSideNav(activeNav, p) {
  const navItems = [
    ['chat', 'Trò chuyện', '💬', '/'],
    ['prep', 'Ôn thi', '📚', '/exam-preps'],
    ['stats', 'Tiến độ', '📈', '/dashboard'],
    ['lab', 'AI Lab', '🧪', '/lab'],
    ['calendar', 'Lịch học', '📅', '/calendar'],
    ['showcase', 'Khám phá', '✨', '/showcase'],
    ['settings', 'Cài đặt', '⚙️', '/settings']
  ];
  const roleLabel = p.role === 'teacher' ? 'Giáo viên' : p.role === 'parent' ? 'Phụ huynh' : 'Học sinh';
  const isLight = (p.theme || 'dark') === 'light';
  return `<aside class="side-nav" aria-label="Điều hướng chính">
    <div class="side-brand">
      <div class="logo" data-action="nav" data-value="/" style="cursor:pointer">havs<span>AI</span></div>
      <span class="badge">BETA</span>
      <span class="live ${state.live ? 'on' : ''}">${state.live ? '● live' : '○ offline'}</span>
    </div>
    <button class="btn side-new-chat" data-action="new-chat" title="Cuộc trò chuyện mới (Ctrl+K)">＋ Cuộc trò chuyện mới</button>
    <nav class="side-links">
      ${navItems.map(([id, label, icon, href]) =>
        `<button class="side-link ${activeNav === id ? 'active' : ''}" data-action="nav" data-value="${href}">
          <span class="ico">${icon}</span><span>${label}</span>
        </button>`).join('')}
    </nav>
    <div class="side-footer">
      ${havsPlatform.runtime === 'web' ? `<button class="btn secondary side-install-btn" data-action="install-app">📲 Cài đặt ứng dụng</button>` : ''}
      <div class="side-profile">
        <div class="avatar" data-action="go-profile" style="cursor:pointer">${esc((p.name || 'H')[0].toUpperCase())}</div>
        <div class="grow side-profile-meta" data-action="go-profile" style="cursor:pointer">
          <b>${esc(p.name || 'Học sinh')}</b>
          <span class="small muted">${roleLabel} · ${esc(havsPlatform.runtimeLabel())}</span>
        </div>
        <button class="icon-btn" data-action="quick-theme" title="Đổi giao diện Sáng/Tối">${isLight ? '🌙' : '☀️'}</button>
      </div>
    </div>
  </aside>`;
}

function renderChatSidebar() {
  const filter = (state.chatFilter || '').trim().toLowerCase();
  const list = (state.chats || []).filter((c) => !filter || `${c.title || ''} ${subjectName(c.subject)}`.toLowerCase().includes(filter));
  return `<aside class="chat-sidebar ${state.chatDrawerOpen ? 'open' : ''}" aria-label="Lịch sử trò chuyện">
    <div class="chat-sidebar-head">
      <b>Lịch sử hội thoại</b>
      <div class="row">
        <button class="icon-btn" data-action="new-chat" title="Cuộc trò chuyện mới">＋</button>
        <button class="icon-btn mobile-only" data-action="close-chat-drawer" title="Đóng">✕</button>
      </div>
    </div>
    <div class="chat-sidebar-search">
      <input id="chat-history-filter" class="input" value="${esc(state.chatFilter)}" placeholder="Tìm hội thoại…" autocomplete="off" />
    </div>
    <div class="chat-history-list">
      ${list.length ? list.map((chat) => {
        const active = state.chatId === chat.id;
        return `<div class="chat-history-item ${active ? 'active' : ''}">
          <button class="chat-history-open" data-action="open-chat" data-value="${esc(chat.id)}">
            <span class="chat-history-ico">${SUBJECT_META[chat.subject] || '💬'}</span>
            <span class="chat-history-text">
              <b>${esc(chat.title || 'Cuộc trò chuyện')}</b>
              <small>${esc(subjectName(chat.subject || 'math'))}</small>
            </span>
          </button>
          <div class="chat-history-actions">
            <button class="chat-act-btn" data-action="rename-chat" data-value="${esc(chat.id)}" title="Đổi tên">✎</button>
            <button class="chat-act-btn danger" data-action="delete-chat" data-value="${esc(chat.id)}" title="Xóa">🗑</button>
          </div>
        </div>`;
      }).join('') : `<div class="chat-history-empty"><p class="small">Chưa có hội thoại nào. Hãy đặt câu hỏi đầu tiên!</p></div>`}
    </div>
  </aside>
  ${state.chatDrawerOpen ? '<div class="drawer-backdrop" data-action="close-chat-drawer"></div>' : ''}`;
}

function renderMain() {
  const p = state.profile || {};
  const route = state.route || { name: 'chat', params: {} };
  const feature = renderFeaturePage(route);
  const activeNav = route.name === 'chat' ? 'chat'
    : route.name.startsWith('exam') || route.name === 'lesson' || route.name === 'challenges' || route.name === 'challenge' || route.name === 'mock' || route.name === 'attempt' ? 'prep'
      : route.name === 'dashboard' || route.name === 'child' ? 'stats'
        : route.name === 'lab' || route.name === 'lab-app' ? 'lab'
          : route.name === 'calendar' ? 'calendar'
            : route.name === 'showcase' || route.name === 'teacher' || route.name === 'share' ? 'showcase'
              : route.name === 'settings' || route.name === 'profile' ? 'settings' : '';
  const tab = ['chat', 'prep', 'stats', 'settings'].includes(activeNav) ? activeNav : '';
  state.tab = tab || 'chat';
  const fallback = tab === 'chat' ? renderChat() : tab === 'prep' ? renderPrep() : tab === 'stats' ? renderStats() : renderSettings();
  const isChat = route.name === 'chat';
  return `<div class="screen main-screen layout-shell ${isChat ? 'has-chat-sidebar' : ''}">
    ${renderSideNav(activeNav || 'chat', p)}
    ${isChat ? renderChatSidebar() : ''}
    <div class="workspace-col">
      <div class="header"><div class="inner">
        ${isChat ? `<button class="icon-btn chat-drawer-btn" data-action="toggle-chat-drawer" title="Lịch sử hội thoại">☰</button>` : ''}
        <div class="logo" data-action="nav" data-value="/" style="cursor:pointer">havs<span>AI</span></div>
        <span class="badge">BETA</span>
        <span id="live" class="live ${state.live ? 'on' : ''}">${state.live ? '● live' : '○ offline'}</span>
        <div class="grow"></div>
        ${isChat ? `<button class="btn ghost header-new-chat" data-action="new-chat">＋ Mới</button>` : ''}
        <div class="avatar" data-action="go-profile">${esc((p.name || 'H')[0].toUpperCase())}</div>
      </div></div>
      <div class="main">${feature || fallback}</div>
      <div class="bottom-nav">
        ${[['chat', 'Trò chuyện', '💬', '/'], ['prep', 'Ôn thi', '📚', '/exam-preps'], ['stats', 'Tiến độ', '📈', '/dashboard'], ['settings', 'Cài đặt', '⚙️', '/settings']].map(([id, label, icon, href]) =>
          `<button class="nav-item ${tab === id ? 'active' : ''}" data-action="nav" data-value="${href}"><span class="ico">${icon}</span>${label}</button>`).join('')}
      </div>
    </div>
  </div>`;
}

function renderChat() {
  const prompts = PROMPTS[state.subject] || PROMPTS.default;
  const activeChat = (state.chats || []).find((c) => c.id === state.chatId);
  return `<div class="chat-stage ${state.dragOver ? 'drag-over' : ''}">
    <div class="subject-bar">${SUBJECTS.map(([id, label]) => `<button class="chip ${state.subject === id ? 'active' : ''}" data-action="subject-tab" data-value="${id}">${SUBJECT_META[id] || ''} ${label}</button>`).join('')}</div>
    ${activeChat ? `<div class="chat-active-bar">
      <span class="small muted">${SUBJECT_META[activeChat.subject] || '💬'} <b>${esc(activeChat.title || 'Cuộc trò chuyện')}</b></span>
      <div class="grow"></div>
      <button class="btn ghost small" data-action="rename-chat" data-value="${esc(activeChat.id)}">✎ Đổi tên</button>
      <button class="btn ghost small" data-action="new-chat">＋ Chat mới</button>
    </div>` : ''}
    <div class="chat-wrap" id="chat-wrap">
      ${state.messages.length === 0 ? `<div class="center-text chat-welcome">
        <div class="logo" style="font-size:28px">havs<span>AI</span></div>
        <h1 style="font-size:24px;margin-top:14px">Hỏi mình bất cứ điều gì</h1>
        <p>Môn ${esc(subjectName(state.subject))} · Giải thích từng bước, đọc ảnh/PDF bằng DeepSeek Vision, vẽ tay hoặc tra cứu web.</p>
        <div class="welcome-grid">
          ${prompts.map((text) => `<button class="welcome-card" data-action="prompt" data-value="${esc(text)}">
            <span>${SUBJECT_META[state.subject] || '✨'}</span>
            <b>${esc(text)}</b>
          </button>`).join('')}
        </div>
        <p class="small muted desktop-hint">Mẹo trên máy tính: kéo-thả hoặc dán (Ctrl+V) ảnh/PDF trực tiếp vào khung chat · Nhấn <code>/</code> để nhập nhanh.</p>
      </div>` : state.messages.map(renderMessage).join('')}
    </div>
    <div class="suggestions">${prompts.map((text) => `<button data-action="prompt" data-value="${esc(text)}">${esc(text)}</button>`).join('')}</div>
    <div id="image-preview" class="${state.uploadId ? 'attach-bar' : 'hidden'}" style="padding:8px 12px">
      ${state.uploadMime?.startsWith('image/') && state.imageUrl
        ? `<img src="${esc(state.imageUrl)}" style="max-height:80px;border-radius:10px" />`
        : state.uploadId
          ? `<span class="tool">📄 ${esc(state.uploadName)}${state.uploadPages ? ` · ${state.uploadPages} trang` : ''}</span>`
          : ''}
      ${state.uploadId ? `<button class="btn ghost small" data-action="clear-upload">✕ Bỏ đính kèm</button>` : ''}
    </div>
    <div class="composer">
      <input id="file-input" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" class="hidden" />
      <button class="icon-btn" data-action="open-canvas" title="Vẽ tay">✎</button>
      <button class="icon-btn" data-action="pick-file" title="Đính kèm ảnh hoặc PDF">＋</button>
      <input id="chat-input" class="input" value="${esc(state.draft)}" placeholder="Nhập câu hỏi hoặc dán ảnh (Ctrl+V)…" autocomplete="off" />
      <button class="icon-btn ${state.listening ? 'send' : ''}" data-action="voice-input" title="Nhập bằng giọng nói">${state.listening ? '◉' : '🎤'}</button>
      <button class="icon-btn ${state.voiceOn ? 'send' : ''}" data-action="toggle-voice" title="Đọc câu trả lời">${state.voiceOn ? '🔊' : '🔇'}</button>
      <button class="icon-btn send" data-action="send" ${state.streaming ? 'disabled' : ''} title="Gửi">➤</button>
    </div>
  </div>`;
}

function renderTex(tex, display) {
  if (!window.katex || !String(tex || '').trim()) return esc(tex || '');
  try {
    return window.katex.renderToString(tex.trim(), {
      displayMode: !!display,
      throwOnError: false,
      strict: 'ignore',
      trust: false
    });
  } catch {
    return esc(tex);
  }
}

function looksLikeBareMath(line) {
  if (!/\\[a-zA-Z]+/.test(line)) return false;
  const commands = line.match(/\\[a-zA-Z]+/g) || [];
  if (commands.length >= 2) return true;
  if (/^\\[a-zA-Z]/.test(line)) return true;
  return commands.length === 1 && line.length < 80 && /[=+\-^_\\]/.test(line);
}

function formatTextBlock(raw) {
  return raw.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (looksLikeBareMath(trimmed)) return `<div class="math-block">${renderTex(trimmed, true)}</div>`;
    let value = esc(line);
    value = value.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    value = value.replace(/^#{1,6}\s+(.+)$/, '<strong>$1</strong>');
    value = value.replace(/^\s*[-*]\s+(.+)$/, '• $1');
    return value;
  }).join('<br>');
}

function formatMessage(text) {
  const source = String(text ?? '');
  const pattern = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?!\s)(?:\\.|[^$\\])+?\$)/g;
  const parts = [];
  let last = 0;
  let match;
  while ((match = pattern.exec(source))) {
    if (match.index > last) parts.push({ text: source.slice(last, match.index) });
    const token = match[0];
    let tex = token;
    let display = false;
    if (token.startsWith('$$')) { tex = token.slice(2, -2); display = true; }
    else if (token.startsWith('\\[')) { tex = token.slice(2, -2); display = true; }
    else if (token.startsWith('\\(')) { tex = token.slice(2, -2); }
    else if (token.startsWith('$')) { tex = token.slice(1, -1); }
    parts.push({ tex, display });
    last = pattern.lastIndex;
  }
  if (last < source.length) parts.push({ text: source.slice(last) });
  return parts.map((part) => part.tex !== undefined ? renderTex(part.tex, part.display) : formatTextBlock(part.text)).join('');
}

function messageTools(m) {
  try {
    if (m.tools_json) return JSON.parse(m.tools_json);
    if (Array.isArray(m.tools)) return m.tools;
  } catch {}
  return [];
}

function toolChips(tools) {
  if (!tools || !tools.length) return '';
  return `<div class="tools">${tools.filter((t) => t.status !== 'started' && t.status !== 'error').map((t) => {
    if (t.tool === 'web_search') return `<span class="tool">🔎 ${esc(t.query || 'web search')}${t.results?.length ? ` · ${t.results.length} kết quả` : ''}</span>`;
    if (t.tool === 'vision_analyze') return `<span class="tool">👁 ${esc(t.filename || 'ảnh')}${t.chars ? ` · ${t.chars} ký tự` : ''}</span>`;
    return `<span class="tool">📄 ${esc(t.filename || 'tài liệu')}${t.pages ? ` · ${t.pages} trang` : ''}${t.scanned ? ' · OCR' : ''}</span>`;
  }).join('')}</div>`;
}

function renderMessage(m) {
  return `<div class="msg ${m.role === 'user' ? 'user' : 'assistant'}"><div class="bubble">${toolChips(messageTools(m))}${m.image_url ? `<img src="${esc(m.image_url)}" alt="ảnh đính kèm" />` : ''}${formatMessage(m.content)}</div></div>`;
}

function renderPlan() {
  const plan = state.prepPlan;
  if (!plan) return '';
  return `<div class="card" style="margin-bottom:14px">
    <div class="row"><h2 style="margin:0">${esc(plan.title || 'Kế hoạch ôn thi')}</h2><div class="grow"></div><button class="btn ghost" data-action="close-plan">Đóng</button></div>
    <p>${esc(plan.summary || '')}</p>
    ${(plan.days || []).map((day) => `<div style="margin:12px 0"><b>Ngày ${esc(day.day)} · ${esc(day.focus || '')}</b><ul>${(day.tasks || []).map((task) => `<li>${esc(task)}</li>`).join('')}</ul></div>`).join('')}
    ${(plan.practice || []).length ? `<h2>Luyện tập</h2>${plan.practice.map((item) => `<div style="margin:10px 0"><b>${esc(item.question)}</b><p>${esc(item.answer || '')}</p></div>`).join('')}` : ''}
    ${(plan.tips || []).length ? `<h2>Mẹo</h2><ul>${plan.tips.map((tip) => `<li>${esc(tip)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function renderPrep() {
  return `<div class="pad">
    <h1>Ôn thi</h1><p>Tạo đề, để havsAI sinh kế hoạch 5 ngày và luyện tập theo từng bước.</p>
    ${renderPlan()}
    <div class="list" style="margin-bottom:18px">
      ${state.preps.length ? state.preps.map((prep) => {
        const hasPlan = !!prep.plan_json;
        return `<div class="item"><h3>${esc(prep.title)}</h3><p>${esc(subjectName(prep.subject))} · ${esc(prep.exam_date || 'chưa có ngày')} · ${esc(prep.status)}</p>
          <div class="row" style="margin-top:10px">
            ${hasPlan
              ? `<button class="btn secondary" data-action="view-prep" data-value="${prep.id}">Xem kế hoạch</button>`
              : `<button class="btn" data-action="generate-prep" data-value="${prep.id}">Sinh kế hoạch</button>`}
          </div></div>`;
      }).join('') : '<div class="item"><p>Chưa có đề ôn tập nào.</p></div>'}
    </div>
    <div class="card">
      <h2>Tạo đề mới</h2>
      <div class="field"><label>Tên đề</label><input id="prep-title" class="input" placeholder="Đề giữa kỳ Toán" /></div>
      <div class="field"><label>Môn</label><select id="prep-subject" class="input">${SUBJECTS.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></div>
      <div class="field"><label>Ngày thi</label><input id="prep-date" class="input" type="date" /></div>
      <button class="btn" data-action="create-prep">Tạo đề & sinh kế hoạch</button>
    </div>
  </div>`;
}

function renderStats() {
  const d = state.dashboard || { chats: 0, preps: 0, messages: 0, usageMinutes: 0, plan: 'free' };
  return `<div class="pad">
    <h1>Tiến độ</h1><p>Tổng quan hoạt động học tập của bạn.</p>
    <div class="stat-grid">
      <div class="stat"><b>${d.chats}</b><span>Cuộc trò chuyện</span></div>
      <div class="stat"><b>${d.messages}</b><span>Tin nhắn</span></div>
      <div class="stat"><b>${d.preps}</b><span>Đề ôn tập</span></div>
      <div class="stat"><b>${d.usageMinutes}</b><span>Phút đã dùng</span></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Sử dụng</h2><p>${d.usageMinutes} phút đã dùng. havsAI không giới hạn số câu hỏi.</p></div>
    ${d.role === 'parent' ? `<div class="card" style="margin-top:16px"><h2>Tài khoản con</h2>
      ${(d.children || []).length ? d.children.map((link) => `<div class="item" style="margin-bottom:8px"><h3>${esc(link.child?.name || link.email)}</h3><p>${link.status === 'linked' ? `${link.child.chats} chat · ${link.child.preps} đề · ${link.child.usageMinutes} phút` : 'Đang chờ con đăng ký tài khoản'}</p></div>`).join('') : '<p>Chưa liên kết tài khoản con.</p>'}
    </div>` : ''}
    ${d.role === 'teacher' ? `<div class="card" style="margin-top:16px"><h2>Lớp học</h2><p>${esc(d.school || 'Chưa cập nhật trường')} · ${esc(d.className || 'Chưa cập nhật lớp')}</p></div>` : ''}
  </div>`;
}

function renderSettings() {
  const p = state.profile || {};
  return `<div class="pad">
    <h1>Cài đặt</h1>
    <div class="card" style="margin-bottom:14px">
      <div class="row"><div class="avatar">${esc((p.name || 'A')[0].toUpperCase())}</div><div class="grow"><b>${esc(p.name || 'Học sinh')}</b><p style="margin:2px 0 0">${esc(state.user?.email || '')}</p></div></div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <h2>Hồ sơ</h2>
      <div class="field"><label>Tên hiển thị</label><input id="set-name" class="input" value="${esc(p.name || '')}" /></div>
      <div class="field"><label>Giọng nói</label><select id="set-voice" class="input">${state.voices.map((v) => `<option value="${v.id}" ${p.voice === v.id ? 'selected' : ''}>${esc(v.name)} (${esc(v.locale)})</option>`).join('')}<option value="none" ${p.voice === 'none' ? 'selected' : ''}>Không dùng</option></select></div>
      <button class="btn secondary" data-action="save-profile">Lưu hồ sơ</button>
    </div>
    <div class="card" style="margin-bottom:14px">
      <h2>Sử dụng</h2><p>${p.usageMinutes || 0} phút đã dùng · không giới hạn</p>
    </div>
    ${p.role === 'parent' ? `<div class="card" style="margin-bottom:14px">
      <h2>Tài khoản con</h2>
      <div class="field"><label>Email con</label><input id="child-email" class="input" type="email" placeholder="con@example.com" /></div>
      <button class="btn secondary" data-action="add-child">Liên kết tài khoản</button>
      <div class="list" style="margin-top:10px">
        ${(state.dashboard?.children || []).length ? state.dashboard.children.map((link) => `<div class="item"><h3>${esc(link.child?.name || link.email)}</h3><p>${link.status === 'linked' ? `${link.child.chats} chat · ${link.child.preps} đề · ${link.child.usageMinutes} phút` : 'Đang chờ con đăng ký'}</p></div>`).join('') : '<p>Chưa liên kết tài khoản con.</p>'}
      </div>
    </div>` : ''}
    ${p.role === 'teacher' ? `<div class="card" style="margin-bottom:14px"><h2>Lớp học</h2><p>${esc(p.school || 'Chưa cập nhật trường')} · ${esc(p.className || 'Chưa cập nhật lớp')}</p></div>` : ''}
    <button class="btn danger" data-action="logout">Đăng xuất</button>
    <p class="small center-text" style="margin-top:18px">havsAI · backend Node + SQLite</p>
  </div>`;
}

function renderUpgrade() {
  return '';
}

function addToolChip(container, event) {
  if (!container) return;
  if (event.tool === 'vision_analyze') {
    const existing = container.querySelector('[data-vision="1"]');
    if (event.status === 'started') {
      const chip = document.createElement('span');
      chip.className = 'tool';
      chip.dataset.vision = '1';
      chip.textContent = `👁 Đang đọc ảnh…`;
      container.appendChild(chip);
    } else {
      const label = event.status === 'done'
        ? `👁 ${event.filename || 'ảnh'}${event.chars ? ` · ${event.chars} ký tự` : ''}`
        : `👁 Không đọc được ảnh`;
      if (existing) {
        existing.dataset.vision = '';
        existing.textContent = label;
      } else {
        const chip = document.createElement('span');
        chip.className = 'tool';
        chip.textContent = label;
        container.appendChild(chip);
      }
    }
    return;
  }
  if (event.status === 'started') {
    const chip = document.createElement('span');
    chip.className = 'tool';
    chip.dataset.started = '1';
    chip.textContent = `🔎 Đang tìm: ${event.query || ''}`;
    container.appendChild(chip);
    return;
  }
  if (event.tool === 'web_search') {
    const started = container.querySelector('[data-started="1"]');
    if (started) {
      started.dataset.started = '';
      started.textContent = `🔎 ${event.query || 'web search'} · ${event.results?.length || 0} kết quả`;
      if (event.results?.length) {
        started.title = event.results.map((r) => `${r.title} — ${r.url}`).join('\n');
      }
    } else {
      const chip = document.createElement('span');
      chip.className = 'tool';
      chip.textContent = `🔎 ${event.query || 'web search'} · ${event.results?.length || 0} kết quả`;
      container.appendChild(chip);
    }
  } else if (event.tool === 'read_material') {
    const chip = document.createElement('span');
    chip.className = 'tool';
    chip.textContent = `📄 ${event.filename || 'tài liệu'}${event.pages ? ` · ${event.pages} trang` : ''}${event.scanned ? ' · OCR' : ''}`;
    container.appendChild(chip);
  }
}

function connectRealtime() {
  if (state.realtime) return;
  try {
    const source = new EventSource('/api/realtime');
    state.realtime = source;
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);
    source.onmessage = (event) => {
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (payload.type === 'ping' || payload.type === 'connected') return;
      if (payload.event === 'chat.message') {
        refreshDashboard().catch(() => {});
        refreshChats().then(() => {
          if (state.chatId && payload.chatId === state.chatId && !state.streaming) {
            api(`/api/chats/${state.chatId}/messages`).then((data) => {
              state.messages = data.messages || [];
              if (state.tab === 'chat') render();
            }).catch(() => {});
          } else if (state.tab === 'chat') {
            render();
          }
        }).catch(() => {});
      }
      if (payload.event === 'chat.updated' || payload.event === 'chat.deleted') {
        refreshChats().then(() => {
          if (payload.event === 'chat.deleted' && payload.chatId && state.chatId === payload.chatId) {
            state.chatId = null;
            state.messages = [];
          }
          if (state.tab === 'chat') render();
        }).catch(() => {});
      }
      if (payload.event === 'profile.updated') {
        api('/api/profile').then((data) => {
          if (data?.profile) {
            state.profile = data.profile;
            havsPlatform.setTheme(state.profile.theme || 'dark');
            if (typeof applyPreferences === 'function') applyPreferences();
            render();
          }
        }).catch(() => {});
      }
      if (payload.event === 'prep.updated') loadPreps().then(() => { if (state.tab === 'prep') render(); }).catch(() => {});
      if (payload.event === 'parent.updated') refreshDashboard().then(() => { if (state.tab === 'stats' || state.tab === 'settings') render(); }).catch(() => {});
    };
  } catch {}
}

function setLive(on) {
  state.live = on;
  const el = document.getElementById('live');
  if (el) {
    el.textContent = on ? '● live' : '○ offline';
    el.className = `live ${on ? 'on' : ''}`;
  }
}

function openCanvas() {
  if (document.getElementById('canvas-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'canvas-overlay';
  overlay.className = 'canvas-overlay';
  overlay.innerHTML = `<div class="canvas-bar">
    <button class="btn ghost" data-canvas="close">Đóng</button>
    <button class="btn ghost" data-canvas="clear">Xóa</button>
    <button class="btn" data-canvas="send">Gửi bản vẽ</button>
  </div><canvas></canvas>`;
  document.body.appendChild(overlay);
  const canvas = overlay.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const height = window.innerHeight - 56;
  canvas.width = window.innerWidth * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#ea580c';
  let drawing = false;
  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  canvas.addEventListener('pointerdown', (event) => {
    drawing = true;
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    const p = point(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  canvas.addEventListener('pointerup', () => { drawing = false; });
  overlay.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-canvas]')?.dataset.canvas;
    if (action === 'close') overlay.remove();
    if (action === 'clear') ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (action === 'send') {
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        await uploadFile(new File([blob], 'drawing.png', { type: 'image/png' }));
        overlay.remove();
        render();
      }, 'image/png');
    }
  });
}

async function boot() {
  try {
    try { if (localStorage.getItem('havs-voice') === 'off') state.voiceOn = false; } catch {}
    await loadVoices();
    const session = await api('/api/auth/session');
    state.session = session;
    if (!session.authenticated) {
      state.view = 'login';
      if (location.pathname !== '/login') history.replaceState({}, '', '/login');
      render();
      return;
    }
    state.user = session.user;
    state.profile = session.profile;
    havsPlatform.identify(state.user, state.profile);
    havsPlatform.setTheme(state.profile?.theme || 'dark');
    if (!session.profile?.onboardingDone) {
      state.onboarding = {
        ...state.onboarding,
        role: session.profile?.role || 'student',
        name: session.profile?.name || '',
        age: session.profile?.age || '',
        country: session.profile?.country || 'Việt Nam',
        subjects: session.profile?.subjects?.length ? session.profile.subjects : ['math'],
        voice: session.profile?.voice || 'neil',
        goal: session.profile?.goal || 'general',
        examDate: session.profile?.examDate || '',
        childEmail: session.profile?.childEmail || '',
        school: session.profile?.school || '',
        className: session.profile?.className || ''
      };
      state.view = 'onboarding';
      history.replaceState({}, '', '/onboarding');
      render();
      return;
    }
    state.view = 'main';
    if (location.pathname === '/login' || location.pathname === '/onboarding') history.replaceState({}, '', '/');
    state.route = parseRoute();
    connectRealtime();
    await refreshChats();
    await refreshDashboard();
    await loadRouteData();
    render();
  } catch (error) {
    state.view = 'login';
    state.error = error.message;
    render();
  }
}

async function loadVoices() {
  try {
    const data = await api('/api/voices');
    state.voices = data.voices || [];
  } catch {
    state.voices = [
      { id: 'neil', name: 'Neil', locale: 'vi-VN', gender: 'male' },
      { id: 'aria', name: 'Aria', locale: 'vi-VN', gender: 'female' }
    ];
  }
}

async function refreshChats() {
  const data = await api('/api/chats');
  state.chats = data.chats || [];
}

async function refreshDashboard() {
  state.dashboard = await api('/api/dashboard');
}

async function openChat(chat) {
  const found = state.chats.find((c) => c.id === chat.id) || chat;
  state.chatId = found.id;
  state.subject = found.subject || state.subject || 'math';
  state.chatDrawerOpen = false;
  const data = await api(`/api/chats/${found.id}/messages`);
  state.messages = data.messages || [];
  state.tab = 'chat';
  state.route = { name: 'chat', params: {} };
  if (location.pathname !== '/') history.replaceState({}, '', '/');
  render();
  scrollChat();
}

function scrollChat() {
  requestAnimationFrame(() => {
    const wrap = document.getElementById('chat-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
  });
}

async function sendMessage(text) {
  if (state.streaming) return;
  if (!text.trim()) return;
  state.draft = '';
  state.streaming = true;
  state.error = '';
  state.messages.push({ role: 'user', content: text, image_url: state.uploadMime?.startsWith('image/') ? state.imageUrl : null });
  render();
  scrollChat();
  const bubble = document.createElement('div');
  bubble.className = 'msg assistant';
  bubble.innerHTML = '<div class="bubble"><div class="tools"></div><span class="content"><span class="typing">havsAI đang trả lời…</span></span></div>';
  document.getElementById('chat-wrap').appendChild(bubble);
  scrollChat();
  const contentEl = bubble.querySelector('.content');
  const toolsEl = bubble.querySelector('.tools');
  const toolEvents = [];
  contentEl.textContent = '';

  try {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: state.chatId, message: text, subject: state.subject, uploadId: state.uploadId, imageUrl: state.imageUrl })
    });
    if (!res.ok || !res.body) throw new Error('Không gửi được tin nhắn');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const event of events) {
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue;
          let json;
          try { json = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (json.type === 'tool') {
            if (json.status !== 'started') toolEvents.push(json);
            addToolChip(toolsEl, json);
            continue;
          }
          if (json.type === 'token') {
            full += json.value;
            contentEl.textContent = full;
            scrollChat();
          } else if (json.type === 'done') {
            state.chatId = json.chatId;
            if (json.usage && state.profile) {
              state.profile.usageMinutes = json.usage.minutes;
              state.profile.usageLimit = json.usage.limit;
            }
          }
        }
      }
    }
    state.messages.push({ role: 'assistant', content: full, tools_json: JSON.stringify(toolEvents) });
    state.imageUrl = null;
    state.uploadId = null;
    state.uploadName = '';
    state.uploadPages = 0;
    state.uploadMime = '';
    await refreshChats();
    await refreshDashboard();
    render();
    scrollChat();
    if (state.voiceOn && state.profile?.voice !== 'none') speak(full);
  } catch (error) {
    contentEl.textContent = `Lỗi: ${error.message}`;
    toast(error.message);
  } finally {
    state.streaming = false;
    const sendBtn = document.querySelector('[data-action="send"]');
    if (sendBtn) sendBtn.disabled = false;
  }
}

let speechUnlocked = false;
let recognition = null;

function unlockSpeech() {
  if (speechUnlocked || !('speechSynthesis' in window)) return;
  speechUnlocked = true;
  try {
    const warm = new SpeechSynthesisUtterance(' ');
    warm.volume = 0;
    warm.lang = 'vi-VN';
    window.speechSynthesis.speak(warm);
  } catch {}
}
document.addEventListener('pointerdown', unlockSpeech, { once: true });

function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const vi = voices.filter((v) => /^vi/i.test(v.lang || ''));
  const pref = state.profile?.voice;
  const female = pref === 'aria' || pref === 'lena';
  const byName = vi.find((v) => (female ? /female|nữ|linh|mai|lan/i : /male|nam|minh|an/i).test(v.name || ''));
  return byName || vi[0] || voices.find((v) => v.default) || voices[0] || null;
}

function cleanForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\\\[[\s\S]*?\\\]/g, ' ')
    .replace(/\\\([\s\S]*?\\\)/g, ' ')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[*_#>`~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function speakNow(text) {
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 2400));
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || 'vi-VN';
    utterance.rate = 0.98;
    utterance.pitch = 1;
    utterance.onerror = (event) => {
      if (event.error && !['interrupted', 'canceled'].includes(event.error)) toast(`Không đọc được: ${event.error}`);
    };
    window.speechSynthesis.speak(utterance);
  } catch {
    toast('Thiết bị không đọc được văn bản');
  }
}

function speak(text) {
  if (!('speechSynthesis' in window)) { toast('Thiết bị không hỗ trợ đọc văn bản'); return; }
  const clean = cleanForSpeech(text);
  if (!clean) return;
  unlockSpeech();
  if (window.speechSynthesis.getVoices().length) return speakNow(clean);
  let done = false;
  const handler = () => {
    if (done) return;
    done = true;
    window.speechSynthesis.onvoiceschanged = null;
    speakNow(clean);
  };
  window.speechSynthesis.onvoiceschanged = handler;
  setTimeout(() => { if (!done) handler(); }, 900);
}

function startVoiceInput() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) { toast('Thiết bị không hỗ trợ nhập giọng nói'); return; }
  if (state.listening) { try { recognition?.stop(); } catch {} return; }
  try {
    recognition = new Recognition();
    recognition.lang = 'vi-VN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript || '';
      if (!text) return;
      state.draft = (state.draft ? state.draft + ' ' : '') + text;
      const input = document.getElementById('chat-input');
      if (input) { input.value = state.draft; input.focus(); }
      toast('Đã nhận giọng nói');
    };
    recognition.onerror = (event) => {
      toast(event.error === 'not-allowed' ? 'Cần quyền micro trong Chrome' : `Không nghe được: ${event.error}`);
    };
    recognition.onend = () => { state.listening = false; render(); };
    state.listening = true;
    render();
    recognition.start();
    toast('Đang nghe… nói câu hỏi của bạn');
  } catch (error) {
    state.listening = false;
    render();
    toast(`Không mở được micro: ${error.message}`);
  }
}

async function previewVoice(id) {
  if (id === 'none') return;
  if (!('speechSynthesis' in window)) { toast('Thiết bị không hỗ trợ TTS'); return; }
  unlockSpeech();
  speak('Xin chào, mình là havsAI. Cùng học bài hôm nay nhé.');
}

async function resizeImage(file, maxEdge = 1568, quality = 0.82) {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await Promise.race([
      createImageBitmap(file),
      new Promise((_, reject) => setTimeout(() => reject(new Error('resize_timeout')), 10000))
    ]);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale >= 0.999 && file.size <= 1.2 * 1024 * 1024) {
      bitmap.close?.();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}

async function uploadFile(file, target = 'chat') {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { toast('Tệp tối đa 8MB'); return; }
  const prepared = await resizeImage(file);
  let base64;
  try {
    base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(prepared);
    });
  } catch {
    toast('Không đọc được tệp. Hãy chọn tệp khác.');
    return;
  }
  try {
    const data = await api('/api/uploads', {
      method: 'POST',
      body: JSON.stringify({ filename: prepared.name, mime: prepared.type, dataBase64: base64 })
    });
    if (target === 'wizard' && state.examWizard) {
      state.examWizard.uploadId = data.id;
      state.examWizard.uploadName = prepared.name;
      state.examWizard.uploadPages = data.pageCount || 0;
    } else {
      state.uploadId = data.id;
      state.imageUrl = data.url;
      state.uploadName = prepared.name;
      state.uploadPages = data.pageCount || 0;
      state.uploadMime = data.mime || prepared.type;
    }
    render();
    toast(data.pageCount ? `Đã đính kèm PDF (${data.pageCount} trang)` : 'Đã đính kèm tệp');
  } catch (error) {
    const code = error.data?.error || error.message;
    const messages = {
      pdf_password_protected: 'PDF có mật khẩu, hãy bỏ mật khẩu trước khi gửi.',
      pdf_too_many_pages: `PDF có ${error.data?.pages || '?'} trang, tối đa ${error.data?.max || 50}.`,
      pdf_parse_failed: 'Không đọc được PDF. Hãy gửi ảnh trang để OCR.',
      unsupported_type: 'Định dạng không hỗ trợ (PNG/JPEG/WebP/PDF).',
      invalid_size: 'Tệp tối đa 8MB.'
    };
    toast(messages[code] || ('Không tải được tệp: ' + error.message));
  }
}

document.addEventListener('click', async (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const value = el.dataset.value;

  if (action === 'send-code') {
    const email = document.getElementById('email')?.value.trim();
    try {
      const data = await api('/api/auth/request-code', { method: 'POST', body: JSON.stringify({ email }) });
      toast(data.devCode ? `Mã OTP dev: ${data.devCode}` : 'Đã gửi mã');
    } catch (error) { toast(error.message); }
  } else if (action === 'verify') {
    const email = document.getElementById('email')?.value.trim();
    const code = document.getElementById('code')?.value.trim();
    try {
      const data = await api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
      state.user = data.user; state.profile = data.profile;
      havsPlatform.identify(state.user, state.profile);
      havsPlatform.setTheme(state.profile?.theme || 'dark');
      if (!data.profile?.onboardingDone) {
        state.view = 'onboarding';
        history.replaceState({}, '', '/onboarding');
      } else {
        state.view = 'main';
        history.replaceState({}, '', '/');
        state.route = parseRoute();
        connectRealtime();
        await refreshChats();
        await refreshDashboard();
        await loadRouteData();
      }
      render();
    } catch (error) { toast(error.message); state.error = error.message; render(); }
  } else if (action === 'role') {
    state.onboarding.role = value; render();
  } else if (action === 'subject') {
    const list = state.onboarding.subjects;
    state.onboarding.subjects = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
    if (!state.onboarding.subjects.length) state.onboarding.subjects = ['math'];
    render();
  } else if (action === 'voice') {
    state.onboarding.voice = value;
    await api('/api/onboarding', { method: 'PUT', body: JSON.stringify({ voice: value }) }).catch(() => {});
    render();
  } else if (action === 'preview-voice') {
    event.stopPropagation();
    previewVoice(value);
  } else if (action === 'goal') {
    state.onboarding.goal = value; render();
  } else if (action === 'ob-back') {
    state.onboarding.step = Math.max(0, state.onboarding.step - 1); render();
  } else if (action === 'ob-next') {
    const o = state.onboarding;
    if (o.step === 1) {
      o.name = document.getElementById('ob-name')?.value.trim() || o.name;
      o.age = document.getElementById('ob-age')?.value.trim() || o.age;
      if (o.role === 'parent') o.childEmail = document.getElementById('ob-child')?.value.trim() || o.childEmail;
      if (o.role === 'teacher') {
        o.school = document.getElementById('ob-school')?.value.trim() || o.school;
        o.className = document.getElementById('ob-class')?.value.trim() || o.className;
      }
    }
    if (o.step === 2) o.country = document.getElementById('ob-country')?.value.trim() || o.country;
    if (o.step === 4 && o.goal === 'exam') o.examDate = document.getElementById('ob-exam')?.value || o.examDate;
    state.onboarding.step = Math.min(4, o.step + 1);
    if (state.onboarding.step === 4 && state.voices.length === 0) await loadVoices();
    if (o.step >= 4) {
      try {
        const data = await api('/api/onboarding', { method: 'PUT', body: JSON.stringify({ ...o, onboarding_step: 4, done: true }) });
        state.profile = data.profile;
        if (o.role === 'parent' && o.childEmail) {
          await api('/api/parent/children', { method: 'POST', body: JSON.stringify({ email: o.childEmail }) }).catch(() => {});
        }
        state.view = 'main';
        history.replaceState({}, '', '/');
        state.route = parseRoute();
        connectRealtime();
        await refreshChats(); await refreshDashboard();
        await loadRouteData();
        render();
      } catch (error) { toast(error.message); }
      return;
    }
    render();
  } else if (action === 'tab') {
    navigate(value === 'chat' ? '/' : value === 'prep' ? '/exam-preps' : value === 'stats' ? '/dashboard' : '/settings');
  } else if (action === 'go-settings') {
    navigate('/settings');
  } else if (action === 'go-profile') {
    navigate('/profile');
  } else if (action === 'upgrade') {
    toast('Thanh toán đã tắt trong bản này');
  } else if (action === 'invite') {
    const link = `${location.origin}/?ref=${encodeURIComponent(state.user?.id || '')}`;
    try {
      if (navigator.share) await navigator.share({ title: 'havsAI', text: 'Cùng học với havsAI nhé!', url: link });
      else { await navigator.clipboard.writeText(link); toast('Đã sao chép link mời bạn'); }
    } catch {}
  } else if (action === 'subject-tab') {
    state.subject = value; state.chatId = null; state.messages = []; render();
  } else if (action === 'prompt') {
    sendMessage(value);
  } else if (action === 'toggle-voice') {
    state.voiceOn = !state.voiceOn;
    try { localStorage.setItem('havs-voice', state.voiceOn ? 'on' : 'off'); } catch {}
    render();
    if (state.voiceOn) speak('Đã bật giọng nói.');
  } else if (action === 'voice-input') {
    startVoiceInput();
  } else if (action === 'open-exam-wizard') {
    openExamWizard(value);
  } else if (action === 'close-wizard') {
    state.examWizard = null; render();
  } else if (action === 'wizard-source') {
    if (state.examWizard) { state.examWizard.source = value; render(); }
  } else if (action === 'wizard-subject') {
    if (state.examWizard) { state.examWizard.subject = value; render(); }
  } else if (action === 'wizard-add-subject') {
    const name = window.prompt('Tên môn học của bạn');
    if (name && state.examWizard) {
      const id = `custom-${name.trim().toLowerCase().replace(/\s+/g, '-')}`;
      if (!SUBJECTS.some(([key]) => key === id)) SUBJECTS.push([id, name.trim()]);
      state.examWizard.subject = id;
      render();
    }
  } else if (action === 'wizard-date' || action === 'wizard-date-next') {
    if (state.examWizard) {
      state.examWizard.examDate = value;
      if (action === 'wizard-date-next') state.examWizard.step = 3;
      render();
    }
  } else if (action === 'wizard-pick-date') {
    const input = document.getElementById('wizard-date-custom');
    if (input) { if (input.showPicker) input.showPicker(); else input.click(); }
  } else if (action === 'wizard-remove-upload') {
    if (state.examWizard) { state.examWizard.uploadId = null; state.examWizard.uploadName = ''; state.examWizard.uploadPages = 0; render(); }
  } else if (action === 'exam-how') {
    toast('Chọn nguồn tài liệu, môn và ngày thi. havsAI sẽ lập kế hoạch 5 ngày kèm bài luyện.');
  } else if (action === 'wizard-next') {
    if (state.examWizard) {
      state.examWizard.step = Math.min(3, state.examWizard.step + 1);
      render();
    }
  } else if (action === 'wizard-back') {
    if (state.examWizard) {
      state.examWizard.step = Math.max(0, state.examWizard.step - 1);
      render();
    }
  } else if (action === 'wizard-upload') {
    document.getElementById(value === 'camera' ? 'wizard-camera' : value === 'gallery' ? 'wizard-gallery' : 'wizard-file')?.click();
  } else if (action === 'wizard-create') {
    await createExamFromWizard();
  } else if (action === 'pick-file') {
    document.getElementById('file-input')?.click();
  } else if (action === 'send') {
    const input = document.getElementById('chat-input');
    const text = input?.value || '';
    if (input) input.value = '';
    await sendMessage(text);
  } else if (action === 'save-profile') {
    const name = document.getElementById('set-name')?.value.trim();
    const voice = document.getElementById('set-voice')?.value;
    try {
      const data = await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ name, voice }) });
      state.profile = data.profile; render(); toast('Đã lưu');
    } catch (error) { toast(error.message); }
  } else if (action === 'logout') {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    state.user = null; state.profile = null; state.view = 'login'; state.messages = []; state.chatId = null;
    state.route = { name: 'login', params: {} };
    history.replaceState({}, '', '/login');
    render();
  } else if (action === 'open-canvas') {
    openCanvas();
  } else if (action === 'generate-prep') {
    try {
      const data = await api(`/api/preps/${value}/generate`, { method: 'POST' });
      state.prepPlan = data.plan;
      await loadPreps();
      await refreshDashboard();
      render();
      toast('Đã sinh kế hoạch ôn thi');
    } catch (error) { toast(error.message); }
  } else if (action === 'view-prep') {
    try {
      const data = await api(`/api/preps/${value}`);
      state.prepPlan = data.prep?.plan || null;
      render();
    } catch (error) { toast(error.message); }
  } else if (action === 'close-plan') {
    state.prepPlan = null;
    render();
  } else if (action === 'add-child') {
    const email = document.getElementById('child-email')?.value.trim();
    try {
      const data = await api('/api/parent/children', { method: 'POST', body: JSON.stringify({ email }) });
      await refreshDashboard();
      render();
      toast(data.linked ? 'Đã liên kết tài khoản con' : 'Đã ghi nhận, chờ con đăng ký');
    } catch (error) { toast(error.message); }
  } else if (action === 'create-prep') {
    const title = document.getElementById('prep-title')?.value.trim();
    const subject = document.getElementById('prep-subject')?.value;
    const examDate = document.getElementById('prep-date')?.value;
    try {
      const created = await api('/api/preps', { method: 'POST', body: JSON.stringify({ title, subject, examDate }) });
      try {
        const generated = await api(`/api/preps/${created.id}/generate`, { method: 'POST' });
        state.prepPlan = generated.plan;
      } catch {}
      await loadPreps();
      await refreshDashboard();
      render();
      toast('Đã tạo đề và sinh kế hoạch');
    } catch (error) { toast(error.message); }
  } else if (action === 'open-chat') {
    await openChat({ id: value });
  } else if (action === 'new-chat') {
    state.chatId = null;
    state.messages = [];
    state.chatDrawerOpen = false;
    state.tab = 'chat';
    state.route = { name: 'chat', params: {} };
    if (location.pathname !== '/') history.pushState({}, '', '/');
    render();
    document.getElementById('chat-input')?.focus();
  } else if (action === 'rename-chat') {
    event.stopPropagation();
    const current = state.chats.find((c) => c.id === value);
    const nextTitle = window.prompt('Đổi tên đoạn chat:', current?.title || '');
    if (!nextTitle || !nextTitle.trim()) return;
    try {
      await api(`/api/chats/${value}`, { method: 'PATCH', body: JSON.stringify({ title: nextTitle.trim() }) });
      await refreshChats();
      render();
      toast('Đã đổi tên đoạn chat');
    } catch (error) { toast(error.message); }
  } else if (action === 'delete-chat') {
    event.stopPropagation();
    try {
      await api(`/api/chats/${value}`, { method: 'DELETE' });
      if (state.chatId === value) {
        state.chatId = null;
        state.messages = [];
      }
      await refreshChats();
      await refreshDashboard();
      render();
      toast('Đã xóa đoạn chat');
    } catch (error) { toast(error.message); }
  } else if (action === 'toggle-chat-drawer') {
    state.chatDrawerOpen = !state.chatDrawerOpen;
    render();
  } else if (action === 'close-chat-drawer') {
    state.chatDrawerOpen = false;
    render();
  } else if (action === 'clear-upload') {
    state.uploadId = null;
    state.imageUrl = null;
    state.uploadName = '';
    state.uploadPages = 0;
    state.uploadMime = '';
    render();
  } else if (action === 'install-app') {
    await havsPlatform.installApp();
  } else if (action === 'request-push') {
    await havsPlatform.requestPush();
  } else if (action === 'quick-theme') {
    const nextTheme = state.profile?.theme === 'light' ? 'dark' : 'light';
    try {
      const data = await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ theme: nextTheme }) });
      state.profile = data.profile;
      havsPlatform.setTheme(nextTheme);
      if (typeof applyPreferences === 'function') applyPreferences();
      render();
    } catch (error) { toast(error.message); }
  }
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    state.chatId = null;
    state.messages = [];
    state.chatDrawerOpen = false;
    state.tab = 'chat';
    state.route = { name: 'chat', params: {} };
    if (location.pathname !== '/') history.pushState({}, '', '/');
    render();
    document.getElementById('chat-input')?.focus();
    return;
  }
  if (event.key === 'Escape' && state.chatDrawerOpen) {
    state.chatDrawerOpen = false;
    render();
    return;
  }
  const tag = (event.target?.tagName || '').toLowerCase();
  if (event.key === '/' && !['input', 'textarea', 'select'].includes(tag) && !event.ctrlKey && !event.metaKey) {
    const input = document.getElementById('chat-input');
    if (input) {
      event.preventDefault();
      input.focus();
      return;
    }
  }
  if (event.key === 'Enter' && !event.shiftKey && event.target.id === 'chat-input') {
    event.preventDefault();
    const input = event.target;
    const text = input.value;
    input.value = '';
    sendMessage(text);
  }
});

document.addEventListener('change', async (event) => {
  if (event.target.id === 'file-input') {
    await uploadFile(event.target.files?.[0]);
  } else if (event.target.id === 'wizard-date-custom') {
    if (state.examWizard && event.target.value) {
      state.examWizard.examDate = event.target.value;
      state.examWizard.step = 3;
      render();
    }
  } else if (event.target.id && event.target.id.startsWith('wizard-')) {
    await uploadFile(event.target.files?.[0], 'wizard');
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'chat-input') state.draft = event.target.value;
  if (event.target.id === 'chat-history-filter') {
    state.chatFilter = event.target.value;
    render();
    const filterEl = document.getElementById('chat-history-filter');
    if (filterEl) {
      filterEl.focus();
      filterEl.setSelectionRange(filterEl.value.length, filterEl.value.length);
    }
  }
  if (event.target.id === 'wizard-subject-search') {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll('[data-subject-tile]').forEach((el) => {
      el.classList.toggle('hidden', !!query && !el.dataset.subjectTile.toLowerCase().includes(query));
    });
  }
});

document.addEventListener('paste', async (event) => {
  if (state.view !== 'main' || state.tab !== 'chat') return;
  const items = Array.from(event.clipboardData?.items || []);
  const fileItem = items.find((item) => item.kind === 'file' && (item.type.startsWith('image/') || item.type === 'application/pdf'));
  if (!fileItem) return;
  const file = fileItem.getAsFile();
  if (file) {
    event.preventDefault();
    await uploadFile(file);
  }
});

document.addEventListener('dragover', (event) => {
  if (state.view !== 'main') return;
  if (event.dataTransfer?.types?.includes('Files')) {
    event.preventDefault();
    document.body.classList.add('dragging-file');
  }
});

document.addEventListener('dragleave', (event) => {
  if (event.relatedTarget === null) {
    document.body.classList.remove('dragging-file');
  }
});

document.addEventListener('drop', async (event) => {
  document.body.classList.remove('dragging-file');
  if (state.view !== 'main') return;
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  event.preventDefault();
  const target = state.examWizard ? 'wizard' : 'chat';
  await uploadFile(file, target);
});

async function loadPreps() {
  try {
    const data = await api('/api/preps');
    state.preps = data.preps || [];
  } catch { state.preps = []; }
}

boot();
