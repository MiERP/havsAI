function fmtDate(value) {
  if (!value) return 'chưa có ngày';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('vi-VN');
}

function pct(done, total) {
  return total ? Math.round((done / total) * 100) : 0;
}

function routeTabs(active, items) {
  return `<div class="chips">${items.map(([id, label, href]) => `<button class="chip ${active === id ? 'active' : ''}" data-action="nav" data-value="${href}">${label}</button>`).join('')}</div>`;
}

function parseRoute() {
  const parts = location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts[0] && /^[a-z]{2}(-[A-Za-z]{2,})?$/.test(parts[0]) && ['vi', 'en'].includes(parts[0].split('-')[0])) parts.shift();
  const [a, b, c, d, e, f] = parts;
  if (!a) return { name: 'chat', params: {} };
  if (a === 'login') return { name: 'login', params: {} };
  if (a === 'onboarding') return { name: 'onboarding', params: {} };
  if (a === 'dashboard') {
    if (b === 'children' && c) return { name: 'child', params: { id: c } };
    return { name: 'dashboard', params: {} };
  }
  if (a === 'settings') return { name: 'settings', params: {} };
  if (a === 'profile') return { name: 'profile', params: {} };
  if (a === 'exam-preps') {
    if (!b) return { name: 'exam-list', params: { mode: 'all' } };
    if (['official', 'school', 'curriculum', 'search', 'past'].includes(b)) {
      return { name: 'exam-list', params: { mode: b, q: new URLSearchParams(location.search).get('q') || '' } };
    }
    if (b === 'create') return { name: 'exam-list', params: { mode: 'all', create: true } };
    if (b === 'join' && c) return { name: 'share', params: { shareId: c, join: true } };
    if (['lessons', 'challenges', 'mock-exams'].includes(b) && !c) return { name: 'exam-list', params: { mode: 'past' } };
    if (b === 'from-catalog') return { name: 'exam-list', params: { mode: 'all' } };
    if (c === 'lessons' && d) return { name: 'lesson', params: { prepId: b, lessonId: d } };
    if (c === 'challenges' && d) return { name: 'challenge', params: { prepId: b, challengeId: d } };
    if (c === 'challenges') return { name: 'challenges', params: { prepId: b } };
    if (c === 'mock-exams' && d) {
      if (e === 'attempts' && f) return { name: 'attempt', params: { prepId: b, mockId: d, attemptId: f } };
      return { name: 'mock', params: { prepId: b, mockId: d } };
    }
    if (c === 'attempts' && d) return { name: 'attempt', params: { prepId: b, attemptId: d } };
    return { name: 'exam-detail', params: { prepId: b } };
  }
  if (a === 'mock-exams' && b) return { name: 'attempt', params: { prepId: null, mockId: b, attemptId: c } };
  if (a === 'mock-exams' || a === 'challenges') return { name: 'exam-list', params: { mode: 'past' } };
  if (a === 'lab') {
    if (!b || b === 'library' || b === 'your-apps') return { name: 'lab', params: { filter: b || 'all' } };
    return { name: 'lab-app', params: { slug: b } };
  }
  if (a === 'build') {
    if (!b || b === 'new') return { name: 'lab', params: { create: true } };
    return { name: 'lab', params: {} };
  }
  if (a === 'calendar') return { name: 'calendar', params: { userId: b || null } };
  if (a === 'showcase') return { name: 'showcase', params: { teachers: b === 'teachers' } };
  if (a === 'teachers') {
    if (b) return { name: 'teacher', params: { id: b } };
    return { name: 'showcase', params: { teachers: true } };
  }
  if (a === 'child') return { name: 'child', params: { id: b || null } };
  if (a === 'connect' && b) return { name: 'share', params: { shareId: b, join: true } };
  if (a === 'share' && b === 'a' && c) return { name: 'share', params: { shareId: c } };
  if (a === 'pay' || a === 'return') return { name: 'payments', params: {} };
  if (['support', 'privacy-policy', 'terms-conditions'].includes(a)) return { name: 'legal', params: { page: a } };
  return { name: 'chat', params: { notFound: true } };
}

function navigate(path, options = {}) {
  if (options.replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  state.route = parseRoute();
  state.routeError = '';
  state.chatDrawerOpen = false;
  window.havsPlatform?.syncRoute(path);
  if (state.view !== 'main') {
    render();
    return;
  }
  loadRouteData().then(() => {
    render();
    window.scrollTo(0, 0);
  }).catch((error) => {
    state.routeError = error.message;
    render();
  });
}

async function loadRouteData() {
  const route = state.route || parseRoute();
  state.routeError = '';
  if (route.name === 'chat') {
    if (!state.chats.length) await refreshChats();
    if (!state.messages.length && state.chats[0]) {
      state.chatId = state.chats[0].id;
      state.subject = state.chats[0].subject || 'math';
      const data = await api(`/api/chats/${state.chats[0].id}/messages`);
      state.messages = data.messages || [];
    }
  } else if (route.name === 'dashboard') {
    await refreshDashboard();
  } else if (route.name === 'settings') {
    const data = await api('/api/settings');
    state.profile = data.profile;
    state.settings = data.settings || {};
    try {
      const cc = await api('/api/ai/commandcode');
      state.commandcodeAccounts = cc.accounts || [];
      state.aiActive = cc.active || {};
    } catch {}
    await refreshDashboard();
  } else if (route.name === 'exam-list') {
    state.examMode = route.params.mode || 'all';
    state.examQuery = route.params.q || '';
    if (state.examMode === 'official') {
      const data = await api('/api/exam-preps/official');
      state.examCatalog = data.items || [];
      state.examPreps = [];
    } else if (state.examMode === 'school') {
      const data = await api('/api/exam-preps/school');
      state.examPreps = data.items || [];
      state.examCatalog = data.catalog || [];
    } else if (state.examMode === 'curriculum') {
      const data = await api('/api/exam-preps/curriculum');
      state.curriculum = data.curriculum || {};
    } else if (state.examMode === 'search') {
      const data = await api(`/api/exam-preps/search?q=${encodeURIComponent(state.examQuery)}`);
      state.examCatalog = data.items || [];
      state.examShared = data.shared || [];
      state.examPreps = [];
    } else if (state.examMode === 'past') {
      const data = await api('/api/exam-preps/past');
      state.past = data;
    } else {
      const data = await api('/api/exam-preps');
      state.examPreps = data.preps || [];
    }
  } else if (['exam-detail', 'lesson', 'challenges', 'challenge', 'mock'].includes(route.name)) {
    if (route.params.prepId) {
      const data = await api(`/api/exam-preps/${route.params.prepId}`);
      state.exam = data.prep;
    }
  } else if (route.name === 'attempt') {
    if (route.params.prepId) {
      const data = await api(`/api/exam-preps/${route.params.prepId}`);
      state.exam = data.prep;
      if (route.params.attemptId) {
        const attempt = await api(`/api/exam-preps/${route.params.prepId}/attempts/${route.params.attemptId}`);
        state.attempt = attempt.attempt;
      }
    } else if (route.params.attemptId) {
      const data = await api(`/api/attempts/${route.params.attemptId}`);
      state.attempt = data.attempt;
    }
  } else if (route.name === 'lab') {
    const data = await api('/api/lab/apps');
    state.labApps = data.apps || [];
  } else if (route.name === 'lab-app') {
    const data = await api(`/api/lab/apps/${route.params.slug}`);
    state.labApp = data.app;
  } else if (route.name === 'calendar') {
    const data = await api(`/api/calendar${route.params.userId ? `?userId=${encodeURIComponent(route.params.userId)}` : ''}`);
    state.calendar = data.events || [];
  } else if (route.name === 'showcase') {
    const data = await api('/api/showcase');
    state.showcase = data;
  } else if (route.name === 'teacher') {
    const data = await api(`/api/teachers/${route.params.id}`);
    state.teacher = data.teacher;
    state.teacherPreps = data.preps || [];
  } else if (route.name === 'child') {
    await refreshDashboard();
    const id = route.params.id || state.dashboard?.children?.[0]?.child?.id;
    if (id) {
      const data = await api(`/api/child/${id}`);
      state.child = data;
    }
  } else if (route.name === 'share') {
    const data = await api(`/api/share/a/${route.params.shareId}`);
    state.share = data;
    state.exam = data.prep;
  }
}

function applyPreferences() {
  const theme = state.profile?.theme || 'dark';
  document.documentElement.dataset.theme = theme;
  document.body.classList.toggle('dyslexia', !!state.settings?.dyslexia || !!state.profile?.settings?.dyslexia);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  if (accent) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', accent);
  window.havsPlatform?.setTheme(theme);
}

function renderFeaturePage(route) {
  applyPreferences();
  switch (route.name) {
    case 'exam-list': return renderExamList();
    case 'exam-detail': return renderExamDetail();
    case 'lesson': return renderLesson();
    case 'challenges': return renderChallenges();
    case 'challenge': return renderChallenge();
    case 'mock': return renderMock();
    case 'attempt': return renderAttempt();
    case 'lab': return renderLab();
    case 'lab-app': return renderLabApp();
    case 'calendar': return renderCalendar();
    case 'showcase': return renderShowcase();
    case 'teacher': return renderTeacher();
    case 'child': return renderChild();
    case 'share': return renderShare();
    case 'dashboard': return renderHavsStats();
    case 'settings': return renderHavsSettings();
    case 'profile': return renderProfilePage();
    case 'payments': return renderPaymentsDisabled();
    case 'legal': return renderLegal();
    default: return null;
  }
}

function prepProgress(prep) {
  const done = prep?.mastery?.completedLessons || 0;
  const total = prep?.mastery?.totalLessons || prep?.lessons?.length || 0;
  return total ? `<div class="small">${done}/${total} bài · ${pct(done, total)}%</div>` : '';
}

function renderExamList() {
  const mode = state.examMode || 'all';
  const tabs = routeTabs(mode, [
    ['all', 'Của tôi', '/exam-preps'],
    ['official', 'Chính thức', '/exam-preps/official'],
    ['school', 'Trường', '/exam-preps/school'],
    ['curriculum', 'Giáo trình', '/exam-preps/curriculum'],
    ['search', 'Tìm kiếm', '/exam-preps/search'],
    ['past', 'Đã làm', '/exam-preps/past']
  ]);
  let body = '';
  if (mode === 'curriculum') {
    const curriculum = state.curriculum || {};
    body = `<div class="list">${Object.entries(curriculum).map(([subject, topics]) => `<div class="item"><h3>${esc(subjectName(subject))}</h3><p>${topics.map(esc).join(' · ')}</p></div>`).join('')}</div>`;
  } else if (mode === 'past') {
    const past = state.past || { attempts: [], preps: [] };
    body = `<div class="card"><h2>Lần làm gần đây</h2>${past.attempts?.length ? past.attempts.map((attempt) => `<div class="item" style="margin-bottom:8px"><h3>${attempt.kind === 'mock' ? 'Đề thi thử' : 'Thử thách'}</h3><p>${attempt.score}/${attempt.total} · ${new Date(attempt.created_at).toLocaleString('vi-VN')}</p></div>`).join('') : '<p>Chưa làm bài nào.</p>'}</div>
      <div class="card" style="margin-top:14px"><h2>Đề đã sẵn sàng</h2>${(past.preps || []).map((prep) => `<div class="item" style="margin-bottom:8px"><h3>${esc(prep.title)}</h3>${prepProgress(prep)}<button class="btn secondary" style="margin-top:8px" data-action="nav" data-value="/exam-preps/${prep.id}">Mở</button></div>`).join('') || '<p>Chưa có đề.</p>'}</div>`;
  } else if (mode === 'search') {
    body = `<div class="card"><div class="field"><label>Tìm đề / chủ đề</label><input id="exam-search" class="input" value="${esc(state.examQuery || '')}" placeholder="Toán, IELTS, hàm số…" /></div><button class="btn" data-action="exam-search">Tìm</button></div>
      <div class="list" style="margin-top:14px">${(state.examCatalog || []).map((item) => `<div class="item"><h3>${esc(item.title)}</h3><p>${esc(item.region || '')} · ${esc(subjectName(item.subject))}</p><button class="btn secondary" style="margin-top:8px" data-action="exam-catalog-create" data-value="${item.id}">Tạo đề</button></div>`).join('')}
      ${(state.examShared || []).map((prep) => `<div class="item"><h3>${esc(prep.title)}</h3><p>${esc(prep.author || 'Học sinh')} · ${esc(subjectName(prep.subject))}</p><button class="btn secondary" style="margin-top:8px" data-action="nav" data-value="/share/a/${prep.shareId}">Xem</button></div>`).join('')}</div>`;
  } else {
    const catalog = state.examCatalog || [];
    body = `<div class="list">${(state.examPreps || []).map((prep) => `<div class="item"><h3>${esc(prep.title)}</h3><p>${esc(subjectName(prep.subject))} · ${fmtDate(prep.examDate)} · ${esc(prep.status)}</p>${prepProgress(prep)}
      <div class="row" style="margin-top:10px"><button class="btn secondary" data-action="nav" data-value="/exam-preps/${prep.id}">Mở</button>${prep.status !== 'ready' ? `<button class="btn" data-action="exam-generate" data-value="${prep.id}">Sinh kế hoạch</button>` : ''}</div></div>`).join('') || '<div class="item"><p>Chưa có đề ôn tập nào.</p></div>'}</div>
      ${catalog.length ? `<div class="card" style="margin-top:14px"><h2>Đề mẫu</h2>${catalog.map((item) => `<div class="item" style="margin-bottom:8px"><h3>${esc(item.title)}</h3><p>${esc(item.region || '')}</p><button class="btn secondary" data-action="exam-catalog-create" data-value="${item.id}">Tạo đề</button></div>`).join('')}</div>` : ''}`;
  }
  return `<div class="pad exam-home">
    <div class="row exam-title-row">
      <h1>Kỳ thi</h1><div class="grow"></div>
      <button class="icon-btn" data-action="nav" data-value="/exam-preps/search" title="Tìm kiếm">🔍</button>
      <button class="icon-btn send" data-action="open-exam-wizard" title="Tạo bài thi mới">＋</button>
    </div>
    <div class="hero-card">
      <div class="hero-icon">🎯</div>
      <h2>Chuẩn bị cho kỳ thi tới của bạn</h2>
      <p>Thêm ghi chép của bạn hoặc chọn một kỳ thi chính thức, havsAI sẽ lập kế hoạch học tập đến ngày thi.</p>
      <button class="btn" data-action="open-exam-wizard">＋ Tạo bài thi mới</button>
      <button class="btn ghost exam-how" data-action="exam-how">Cách thức hoạt động ⓘ</button>
    </div>
    <p class="section-label">Bắt đầu từ</p>
    <div class="start-grid">
      <button class="start-card" data-action="open-exam-wizard" data-value="files">
        <span class="start-icon">📤</span><b>Tệp của bạn</b><small>TẢI LÊN GHI CHÉP, HÌNH ẢNH HOẶC SÁCH GIÁO KHOA</small>
      </button>
      <button class="start-card" data-action="open-exam-wizard" data-value="school">
        <span class="start-icon">🏫</span><b>Trường của tôi</b><small>${esc((state.profile?.school || 'HAF LAAM') + ' · ' + (state.examPreps?.length || 0) + ' BỘ ÔN THI')}</small>
      </button>
    </div>
    ${tabs}
    ${body}
    <div class="row" style="margin-top:14px">
      <button class="btn ghost" data-action="nav" data-value="/lab">Lab</button>
      <button class="btn ghost" data-action="nav" data-value="/calendar">Lịch</button>
      <button class="btn ghost" data-action="nav" data-value="/showcase">Khám phá</button>
    </div>
    ${renderExamWizard()}
  </div>`;
}

function renderExamDetail() {
  const prep = state.exam;
  if (!prep) return `<div class="pad"><p>${esc(state.routeError || 'Đang tải…')}</p></div>`;
  const mastery = prep.mastery || {};
  return `<div class="pad">
    <button class="btn ghost" data-action="nav" data-value="/exam-preps">← Ôn thi</button>
    <h1>${esc(prep.title)}</h1><p>${esc(subjectName(prep.subject))} · ${fmtDate(prep.examDate)} · ${esc(prep.status)}</p>
    <div class="exam-detail-grid">
      <div>
        <div class="card" style="margin-bottom:14px"><h2>Tiến độ</h2><p>${mastery.completedLessons || 0}/${mastery.totalLessons || prep.lessons?.length || 0} bài · ${mastery.attempts || 0} lần làm · TB ${mastery.averageScore || 0}%</p>
          <div class="row"><button class="btn secondary" data-action="exam-share" data-value="${prep.id}">Chia sẻ</button><button class="btn ghost" data-action="nav" data-value="/calendar">Thêm lịch</button></div>
          ${prep.shareId ? `<p class="small">Link chia sẻ: <code>/share/a/${esc(prep.shareId)}</code></p>` : ''}
        </div>
        <div class="card" style="margin-bottom:14px"><h2>Kế hoạch</h2>
          ${(prep.plan?.days || []).map((day) => `<div style="margin:12px 0"><b>Ngày ${esc(day.day)} · ${esc(day.focus || '')}</b><ul>${(day.tasks || []).map((task) => `<li>${esc(task)}</li>`).join('')}</ul></div>`).join('') || '<p>Chưa có kế hoạch.</p>'}
          ${prep.plan?.summary ? `<p>${esc(prep.plan.summary)}</p>` : ''}
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:14px"><h2>Bài học</h2>
          ${(prep.lessons || []).map((lesson) => `<div class="item" style="margin-bottom:8px"><h3>${esc(lesson.title)} ${lesson.done ? '✓' : ''}</h3><button class="btn secondary" data-action="nav" data-value="/exam-preps/${prep.id}/lessons/${lesson.id}">Mở bài</button></div>`).join('') || '<p>Chưa có bài học.</p>'}
        </div>
        <div class="card" style="margin-bottom:14px"><h2>Thử thách</h2>
          ${(prep.challenges || []).map((challenge) => `<div class="item" style="margin-bottom:8px"><h3>${esc(challenge.title)}</h3><p>${esc(challenge.question)}</p><button class="btn secondary" data-action="nav" data-value="/exam-preps/${prep.id}/challenges/${challenge.id}">Làm thử thách</button></div>`).join('') || '<p>Chưa có thử thách.</p>'}
        </div>
        <div class="card"><h2>Đề thi thử</h2>
          ${(prep.mockExams || []).map((mock) => `<div class="item" style="margin-bottom:8px"><h3>${esc(mock.title)}</h3><p>${mock.questions?.length || 0} câu · ${mock.durationMinutes || 30} phút</p><button class="btn secondary" data-action="nav" data-value="/exam-preps/${prep.id}/mock-exams/${mock.id}">Làm đề</button></div>`).join('') || '<p>Chưa có đề thi thử.</p>'}
        </div>
      </div>
    </div>
  </div>`;
}

function renderLesson() {
  const prep = state.exam;
  const lesson = prep?.lessons?.find((item) => item.id === state.route.params.lessonId);
  if (!lesson) return `<div class="pad"><p>Không tìm thấy bài học.</p></div>`;
  return `<div class="pad">
    <button class="btn ghost" data-action="nav" data-value="/exam-preps/${prep.id}">← ${esc(prep.title)}</button>
    <h1>${esc(lesson.title)}</h1>
    <div class="card"><p style="white-space:pre-wrap">${esc(lesson.content || '')}</p></div>
    ${!lesson.done ? `<button class="btn" style="margin-top:14px" data-action="lesson-complete" data-value="${prep.id}|${lesson.id}">Đánh dấu đã học</button>` : '<p class="small">Đã hoàn thành bài này.</p>'}
  </div>`;
}

function renderChallenges() {
  const prep = state.exam;
  if (!prep) return `<div class="pad"><p>Đang tải…</p></div>`;
  return `<div class="pad">
    <button class="btn ghost" data-action="nav" data-value="/exam-preps/${prep.id}">← ${esc(prep.title)}</button>
    <h1>Thử thách</h1>
    ${(prep.challenges || []).map((challenge) => `<div class="item" style="margin-bottom:10px"><h3>${esc(challenge.title)}</h3><p>${esc(challenge.question)}</p><button class="btn secondary" data-action="nav" data-value="/exam-preps/${prep.id}/challenges/${challenge.id}">Làm</button></div>`).join('') || '<p>Chưa có thử thách.</p>'}
  </div>`;
}

function renderChallenge() {
  const prep = state.exam;
  const challenge = prep?.challenges?.find((item) => item.id === state.route.params.challengeId);
  if (!challenge) return `<div class="pad"><p>Không tìm thấy thử thách.</p></div>`;
  const result = state.attempt;
  return `<div class="pad">
    <button class="btn ghost" data-action="nav" data-value="/exam-preps/${prep.id}">← ${esc(prep.title)}</button>
    <h1>${esc(challenge.title)}</h1>
    <div class="card"><p>${esc(challenge.question)}</p>
      <div class="field"><label>Câu trả lời</label><textarea id="challenge-answer" class="input" rows="4">${result ? esc(result.details?.[0]?.given || '') : ''}</textarea></div>
      <button class="btn" data-action="challenge-submit" data-value="${prep.id}|${challenge.id}">Nộp bài</button>
      ${result ? `<div style="margin-top:14px"><b>${result.score}/${result.total} điểm</b><p>${result.details?.map((d) => `${d.correct ? '✓' : '✗'} ${esc(d.question)}<br><span class="small">Đáp án: ${esc(d.expected)}</span>`).join('<br>')}</p></div>` : ''}
    </div>
  </div>`;
}

function renderMock() {
  const prep = state.exam;
  const mock = prep?.mockExams?.find((item) => item.id === state.route.params.mockId);
  if (!mock) return `<div class="pad"><p>Không tìm thấy đề thi thử.</p></div>`;
  const result = state.attempt;
  return `<div class="pad">
    <button class="btn ghost" data-action="nav" data-value="/exam-preps/${prep.id}">← ${esc(prep.title)}</button>
    <h1>${esc(mock.title)}</h1><p>${mock.durationMinutes || 30} phút · ${mock.questions?.length || 0} câu</p>
    ${(mock.questions || []).map((question, index) => `<div class="card" style="margin-bottom:10px"><b>Câu ${index + 1}. ${esc(question.question)}</b><div class="field" style="margin-top:8px"><textarea class="input" rows="3" data-qid="${question.id}">${result ? esc(result.details?.find((d) => d.id === question.id)?.given || '') : ''}</textarea></div>${result ? `<p class="small">${result.details?.find((d) => d.id === question.id)?.correct ? '✓ Đúng' : `✗ Đáp án: ${esc(question.answer)}`}</p>` : ''}</div>`).join('')}
    <button class="btn" data-action="mock-submit" data-value="${prep.id}|${mock.id}">Nộp đề</button>
    ${result ? `<div class="card" style="margin-top:14px"><h2>Kết quả: ${result.score}/${result.total}</h2></div>` : ''}
  </div>`;
}

function renderAttempt() {
  const attempt = state.attempt;
  if (!attempt) return `<div class="pad"><p>Không tìm thấy bài làm.</p></div>`;
  return `<div class="pad">
    <button class="btn ghost" data-action="nav" data-value="${state.route.params.prepId ? `/exam-preps/${state.route.params.prepId}` : '/exam-preps/past'}">← Quay lại</button>
    <h1>Kết quả bài làm</h1>
    <div class="card"><h2>${attempt.score}/${attempt.total} điểm</h2><p>${new Date(attempt.created_at).toLocaleString('vi-VN')}</p></div>
    ${(attempt.details || []).map((detail) => `<div class="card" style="margin-top:10px"><b>${detail.correct ? '✓' : '✗'} ${esc(detail.question)}</b><p>Bạn trả lời: ${esc(detail.given || '')}</p><p class="small">Đáp án: ${esc(detail.expected || '')}</p></div>`).join('')}
  </div>`;
}

function renderLab() {
  const apps = state.labApps || [];
  return `<div class="pad">
    <h1>Lab</h1><p>Tạo app học tập nhỏ bằng AI, chạy ngay trong iframe sandbox.</p>
    <div class="lab-split">
      <div class="list">${apps.map((app) => `<div class="item"><h3>${esc(app.name)}</h3><p>${esc(app.prompt || '')}</p><p class="small">${esc(app.visibility)}</p><button class="btn secondary" style="margin-top:8px" data-action="nav" data-value="/lab/${app.slug}">Mở app</button></div>`).join('') || '<div class="item"><p>Chưa có app nào.</p></div>'}</div>
      <div class="card"><h2>Tạo app mới</h2><div class="field"><label>Tên app (tuỳ chọn)</label><input id="lab-name" class="input" placeholder="App đếm ngược học tập" /></div><div class="field"><label>Mô tả</label><textarea id="lab-prompt" class="input" rows="3" placeholder="Tạo app đếm ngược 25 phút, có checklist…"></textarea></div><button class="btn" data-action="lab-create">Tạo bằng AI</button></div>
    </div>
    <div class="row" style="margin-top:14px"><button class="btn ghost" data-action="nav" data-value="/calendar">Lịch</button><button class="btn ghost" data-action="nav" data-value="/showcase">Khám phá</button></div>
  </div>`;
}

function renderLabApp() {
  const app = state.labApp;
  if (!app) return `<div class="pad"><p>${esc(state.routeError || 'Đang tải…')}</p></div>`;
  return `<div class="pad">
    <button class="btn ghost" data-action="nav" data-value="/lab">← Lab</button>
    <h1>${esc(app.name)}</h1><p>${esc(app.prompt || '')}</p>
    <div class="row"><button class="btn secondary" data-action="lab-publish" data-value="${app.slug}|${app.visibility === 'public' ? 'private' : 'public'}">${app.visibility === 'public' ? 'Chuyển private' : 'Công khai'}</button></div>
    <iframe sandbox="allow-scripts" style="width:100%;height:440px;border:1px solid var(--line);border-radius:14px;background:#fff;margin-top:14px" srcdoc="${esc(app.html || '<p>Chưa có nội dung</p>')}"></iframe>
  </div>`;
}

function renderCalendar() {
  const events = state.calendar || [];
  return `<div class="pad">
    <h1>Lịch</h1><p>Lịch học, kỳ thi và nhắc nhở.</p>
    <div class="desktop-grid">
      <div class="list">${events.map((event) => `<div class="item"><h3>${esc(event.title)}</h3><p>${fmtDate(event.event_date)} · ${esc(event.kind || 'study')}</p><button class="btn ghost" data-action="calendar-delete" data-value="${event.id}">Xóa</button></div>`).join('') || '<div class="item"><p>Chưa có sự kiện.</p></div>'}</div>
      <div class="card"><h2>Thêm sự kiện</h2><div class="field"><label>Tên</label><input id="calendar-title" class="input" placeholder="Học Toán 45 phút" /></div><div class="field"><label>Ngày</label><input id="calendar-date" class="input" type="date" /></div><div class="field"><label>Loại</label><select id="calendar-kind" class="input"><option value="study">Học</option><option value="exam">Thi</option><option value="review">Ôn lại</option></select></div><button class="btn" data-action="calendar-add">Thêm</button></div>
    </div>
  </div>`;
}

function renderShowcase() {
  const data = state.showcase || { preps: [], apps: [], teachers: [] };
  if (state.route.params.teachers) {
    return `<div class="pad">
      <h1>Giáo viên</h1><p>Hồ sơ giáo viên và đề công khai.</p>
      <div class="row"><button class="btn ghost" data-action="nav" data-value="/showcase">Đề & app</button><button class="btn ghost" data-action="nav" data-value="/showcase/teachers">Giáo viên</button></div>
      <div class="list" style="margin-top:14px">${(data.teachers || []).map((teacher) => `<div class="item"><h3>${esc(teacher.name)}</h3><p>${esc(teacher.school || '')} · ${esc(teacher.className || '')} · ${teacher.prepCount || 0} đề</p><button class="btn secondary" style="margin-top:8px" data-action="nav" data-value="/teachers/${teacher.id}">Xem hồ sơ</button></div>`).join('') || '<div class="item"><p>Chưa có giáo viên.</p></div>'}</div>
    </div>`;
  }
  return `<div class="pad">
    <h1>Khám phá</h1><p>Đề được chia sẻ, app công khai và giáo viên.</p>
    <div class="row"><button class="btn ghost" data-action="nav" data-value="/showcase">Đề & app</button><button class="btn ghost" data-action="nav" data-value="/showcase/teachers">Giáo viên</button><button class="btn ghost" data-action="nav" data-value="/teachers">Tất cả giáo viên</button></div>
    ${(data.teachers || []).length ? `<div class="card" style="margin-top:14px"><h2>Giáo viên</h2>${data.teachers.map((teacher) => `<div class="item" style="margin-bottom:8px"><h3>${esc(teacher.name)}</h3><p>${esc(teacher.school || '')} · ${esc(teacher.className || '')}</p><button class="btn secondary" data-action="nav" data-value="/teachers/${teacher.id}">Xem</button></div>`).join('')}</div>` : ''}
    <div class="card" style="margin-top:14px"><h2>Đề chia sẻ</h2>${(data.preps || []).map((prep) => `<div class="item" style="margin-bottom:8px"><h3>${esc(prep.title)}</h3><p>${esc(prep.author || 'Học sinh')} · ${esc(subjectName(prep.subject))}</p><button class="btn secondary" data-action="nav" data-value="/share/a/${prep.shareId}">Xem</button></div>`).join('') || '<p>Chưa có đề chia sẻ.</p>'}</div>
    <div class="card" style="margin-top:14px"><h2>App công khai</h2>${(data.apps || []).map((app) => `<div class="item" style="margin-bottom:8px"><h3>${esc(app.name)}</h3><p>${esc(app.prompt || '')}</p><button class="btn secondary" data-action="nav" data-value="/lab/${app.slug}">Mở</button></div>`).join('') || '<p>Chưa có app công khai.</p>'}</div>
  </div>`;
}

function renderTeacher() {
  const teacher = state.teacher;
  if (!teacher) return `<div class="pad"><p>Không tìm thấy giáo viên.</p></div>`;
  return `<div class="pad"><button class="btn ghost" data-action="nav" data-value="/teachers">← Giáo viên</button><h1>${esc(teacher.name || 'Giáo viên')}</h1><p>${esc(teacher.school || '')} · ${esc(teacher.class_name || teacher.className || '')}</p>
    <div class="list">${(state.teacherPreps || []).map((prep) => `<div class="item"><h3>${esc(prep.title)}</h3><p>${esc(subjectName(prep.subject))}</p><button class="btn secondary" data-action="nav" data-value="/share/a/${prep.shareId}">Xem</button></div>`).join('') || '<div class="item"><p>Chưa có đề công khai.</p></div>'}</div></div>`;
}

function renderChild() {
  const child = state.child?.child;
  if (!child) {
    const links = state.dashboard?.children || [];
    return `<div class="pad"><h1>Tài khoản con</h1>${links.length ? links.map((link) => `<div class="item" style="margin-bottom:8px"><h3>${esc(link.child?.name || link.email)}</h3><p>${link.status === 'linked' ? `${link.child.chats} chat · ${link.child.preps} đề` : 'Đang chờ đăng ký'}</p>${link.child ? `<button class="btn secondary" data-action="nav" data-value="/child/${link.child.id}">Xem tiến độ</button>` : ''}</div>`).join('') : '<p>Chưa liên kết tài khoản con.</p>'}</div>`;
  }
  return `<div class="pad"><button class="btn ghost" data-action="nav" data-value="/dashboard">← Tiến độ</button><h1>${esc(child.name || 'Học sinh')}</h1><p>${child.chats} chat · ${child.preps} đề · ${child.usageMinutes} phút</p>
    <div class="card"><h2>Đề ôn tập</h2>${(state.child.preps || []).map((prep) => `<div class="item" style="margin-bottom:8px"><h3>${esc(prep.title)}</h3>${prepProgress(prep)}</div>`).join('') || '<p>Chưa có đề.</p>'}</div>
    <div class="card" style="margin-top:14px"><h2>Hội thoại</h2>${(state.child.chats || []).map((chat) => `<div class="item" style="margin-bottom:8px"><h3>${esc(chat.title || 'Cuộc trò chuyện')}</h3><p>${esc(subjectName(chat.subject))}</p></div>`).join('') || '<p>Chưa có hội thoại.</p>'}</div>
  </div>`;
}

function renderShare() {
  const prep = state.share?.prep || state.exam;
  if (!prep) return `<div class="pad"><p>${esc(state.routeError || 'Không tìm thấy đề chia sẻ.')}</p></div>`;
  return `<div class="pad"><button class="btn ghost" data-action="nav" data-value="/showcase">← Khám phá</button><h1>${esc(prep.title)}</h1><p>${esc(state.share?.author?.name || 'Học sinh')} · ${esc(subjectName(prep.subject))} · ${fmtDate(prep.examDate)}</p>
    <div class="row"><button class="btn" data-action="join-share" data-value="${prep.shareId}">Tham gia</button><button class="btn secondary" data-action="nav" data-value="/showcase">Khám phá thêm</button></div>
    <div class="card" style="margin-top:14px"><h2>Kế hoạch</h2>${(prep.plan?.days || []).map((day) => `<div style="margin:10px 0"><b>Ngày ${esc(day.day)} · ${esc(day.focus || '')}</b><ul>${(day.tasks || []).map((task) => `<li>${esc(task)}</li>`).join('')}</ul></div>`).join('')}</div>
  </div>`;
}

function renderHavsStats() {
  const d = state.dashboard || {};
  return `<div class="pad">
    <h1>Tiến độ</h1><p>Tổng quan học tập, lịch và thành tích.</p>
    <div class="stat-grid">
      <div class="stat"><b>${d.chats || 0}</b><span>Cuộc trò chuyện</span></div>
      <div class="stat"><b>${d.messages || 0}</b><span>Tin nhắn</span></div>
      <div class="stat"><b>${d.preps || 0}</b><span>Đề ôn tập</span></div>
      <div class="stat"><b>${d.attempts || 0}</b><span>Lần làm bài</span></div>
    </div>
    <div class="desktop-grid" style="margin-top:14px">
      <div class="card"><h2>Lối tắt</h2><div class="row"><button class="btn secondary" data-action="nav" data-value="/exam-preps">Ôn thi</button><button class="btn secondary" data-action="nav" data-value="/lab">Lab</button><button class="btn secondary" data-action="nav" data-value="/calendar">Lịch</button><button class="btn secondary" data-action="nav" data-value="/showcase">Khám phá</button></div></div>
      <div class="card"><h2>Sắp tới</h2>${(d.events || []).length ? d.events.map((event) => `<div class="item" style="margin-bottom:8px"><h3>${esc(event.title)}</h3><p>${fmtDate(event.event_date)}</p></div>`).join('') : '<p>Chưa có sự kiện.</p>'}</div>
    </div>
    ${d.role === 'parent' ? `<div class="card" style="margin-top:14px"><h2>Tài khoản con</h2>${(d.children || []).map((link) => `<div class="item" style="margin-bottom:8px"><h3>${esc(link.child?.name || link.email)}</h3><p>${link.status === 'linked' ? `${link.child.chats} chat · ${link.child.preps} đề · ${link.child.usageMinutes} phút` : 'Đang chờ đăng ký'}</p>${link.child ? `<button class="btn secondary" data-action="nav" data-value="/child/${link.child.id}">Xem</button>` : ''}</div>`).join('') || '<p>Chưa liên kết.</p>'}</div>` : ''}
    ${d.role === 'teacher' ? `<div class="card" style="margin-top:14px"><h2>Lớp học</h2><p>${esc(d.school || 'Chưa cập nhật trường')} · ${esc(d.className || 'Chưa cập nhật lớp')}</p></div>` : ''}
  </div>`;
}

function renderHavsSettings() {
  const p = state.profile || {};
  const settings = state.settings || p.settings || {};
  const plat = window.havsPlatform;
  const deviceLabel = plat?.deviceLabel ? plat.deviceLabel() : 'Web Browser';
  const pushLabel = plat?.pushGranted ? 'Đã bật' : 'Chưa cấp quyền';
  const canInstall = plat ? (!plat.isNativeAndroid && !plat.isStandalone) : true;
  const ccAccounts = state.commandcodeAccounts || [];
  const aiActive = state.aiActive || {};
  return `<div class="pad">
    <h1>Cài đặt</h1>
    <div class="card" style="margin-bottom:14px"><div class="row"><div class="avatar">${esc((p.name || 'H')[0].toUpperCase())}</div><div class="grow"><b>${esc(p.name || 'Học sinh')}</b><p style="margin:2px 0 0">${esc(state.user?.email || '')}</p></div><span class="badge">${esc(deviceLabel)}</span></div></div>
    <div class="card" style="margin-bottom:14px">
      <div class="row" style="margin-bottom:6px"><h2 style="margin:0">Tài khoản AI (Command Code)</h2><div class="grow"></div><span class="badge">${esc(aiActive.provider || 'commandcode')}</span></div>
      <p class="small">Chat: <b>${esc(aiActive.model || 'deepseek/deepseek-v4.1-flash')}</b> · Vision: <b>${esc(aiActive.visionModel || 'deepseek/deepseek-v4-flash-vision-exp')}</b></p>
      ${ccAccounts.length ? `<div class="list" style="margin-bottom:14px">
        ${ccAccounts.map((acc) => `<div class="item" style="display:flex;align-items:center;gap:10px;padding:10px 12px">
          <div class="grow">
            <b>${esc(acc.name)}</b> ${acc.isDefault ? '<span class="badge">Đang dùng</span>' : ''}
            <p class="small" style="margin:2px 0 0">Key: <code>${esc(acc.keyHint)}</code> · Model: ${esc(acc.model)}</p>
          </div>
          ${!acc.isDefault ? `<button class="btn secondary small" style="width:auto;padding:8px 12px" data-action="cc-activate" data-value="${esc(acc.id)}">Dùng tài khoản này</button>` : `<button class="btn ghost small" style="width:auto;padding:8px 12px" data-action="cc-activate" data-value="${esc(acc.id)}">Kiểm tra</button>`}
          ${ccAccounts.length > 1 ? `<button class="btn danger small" style="width:auto;padding:8px 10px" data-action="cc-delete" data-value="${esc(acc.id)}">Xóa</button>` : ''}
        </div>`).join('')}
      </div>` : ''}
      <div class="field"><label>Tên gợi nhớ tài khoản Command Code mới (tùy chọn)</label><input id="cc-account-name" class="input" placeholder="VD: Command Code #2 (tự động nhận nếu dán auth.json)" /></div>
      <div class="field"><label>Dán Command Code API Key (<code>user_...</code>) hoặc nội dung file <code>~/.commandcode/auth.json</code></label><textarea id="cc-account-key" class="input" rows="3" style="font-family:monospace" placeholder='user_... hoặc {"apiKey":"user_...","userName":"..."}'></textarea></div>
      <div class="field"><label>Chế độ lưu</label>
        <select id="cc-account-mode" class="input">
          <option value="add">Thêm tài khoản mới & đặt làm mặc định (giữ tài khoản cũ để chuyển đổi)</option>
          <option value="replace">Cập nhật ghi đè tài khoản Command Code hiện tại</option>
        </select>
      </div>
      <button class="btn" data-action="cc-save">Lưu & Kích hoạt tài khoản Command Code</button>
    </div>
    <div class="desktop-grid">
      <div class="card" style="margin-bottom:14px"><h2>Hồ sơ</h2>
        <div class="field"><label>Tên hiển thị</label><input id="set-name" class="input" value="${esc(p.name || '')}" /></div>
        <div class="field"><label>Giọng nói</label><select id="set-voice" class="input">${(state.voices || []).map((v) => `<option value="${v.id}" ${p.voice === v.id ? 'selected' : ''}>${esc(v.name)} (${esc(v.locale)})</option>`).join('')}<option value="none" ${p.voice === 'none' ? 'selected' : ''}>Không dùng</option></select></div>
        <div class="field"><label>Giờ học quen thuộc</label><input id="set-study-time" class="input" type="time" value="${esc(p.studyTime || '')}" /></div>
        <div class="field"><label>Sở thích</label><input id="set-interests" class="input" value="${esc((p.interests || []).join(', '))}" placeholder="toán, vật lý" /></div>
        <button class="btn secondary" data-action="settings-save">Lưu hồ sơ</button>
      </div>
      <div>
        <div class="card" style="margin-bottom:14px"><h2>Giao diện</h2>
          <div class="field"><label>Theme</label><select id="set-theme" class="input"><option value="dark" ${p.theme === 'dark' ? 'selected' : ''}>Tối</option><option value="light" ${p.theme === 'light' ? 'selected' : ''}>Sáng</option></select></div>
          <div class="field"><label><input id="set-notifications" type="checkbox" ${p.notifications !== false ? 'checked' : ''}/> Thông báo</label></div>
          <div class="field"><label><input id="set-dyslexia" type="checkbox" ${settings.dyslexia ? 'checked' : ''}/> Chế độ dyslexia</label></div>
          <div class="field"><label><input id="set-focus" type="checkbox" ${settings.focusMode ? 'checked' : ''}/> Chế độ tập trung</label></div>
          <button class="btn secondary" data-action="settings-save">Lưu cài đặt</button>
        </div>
        <div class="card" style="margin-bottom:14px"><h2>Thiết bị & Đa nền tảng</h2>
          <p class="small">Môi trường hiện tại: <b>${esc(deviceLabel)}</b> · Thông báo đẩy: <b>${esc(pushLabel)}</b></p>
          <p class="small">Đồng bộ thời gian thực qua SSE giữa PC, Mac, iPad, iPhone và Android.</p>
          <div class="row" style="margin-top:10px">
            ${canInstall ? '<button class="btn secondary" data-action="install-app">📲 Cài ứng dụng (PWA)</button>' : ''}
            <button class="btn ghost" data-action="request-push">🔔 Cấp quyền thông báo</button>
          </div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-bottom:14px"><h2>Khám phá</h2><div class="row"><button class="btn ghost" data-action="nav" data-value="/lab">Lab</button><button class="btn ghost" data-action="nav" data-value="/calendar">Lịch</button><button class="btn ghost" data-action="nav" data-value="/showcase">Showcase</button><button class="btn ghost" data-action="nav" data-value="/teachers">Giáo viên</button></div></div>
    ${p.role === 'parent' ? `<div class="card" style="margin-bottom:14px"><h2>Tài khoản con</h2><div class="field"><label>Email con</label><input id="child-email" class="input" type="email" placeholder="con@example.com" /></div><button class="btn secondary" data-action="add-child">Liên kết tài khoản</button><div class="list" style="margin-top:10px">${(state.dashboard?.children || []).map((link) => `<div class="item"><h3>${esc(link.child?.name || link.email)}</h3><p>${link.status === 'linked' ? `${link.child.chats} chat · ${link.child.preps} đề` : 'Đang chờ đăng ký'}</p></div>`).join('') || '<p>Chưa liên kết.</p>'}</div></div>` : ''}
    ${p.role === 'teacher' ? `<div class="card" style="margin-top:14px;margin-bottom:14px"><h2>Lớp học</h2><div class="field"><label>Trường</label><input id="set-school" class="input" value="${esc(p.school || '')}" /></div><div class="field"><label>Lớp</label><input id="set-class" class="input" value="${esc(p.className || '')}" /></div><button class="btn secondary" data-action="settings-save">Lưu trường/lớp</button></div>` : ''}
    <button class="btn danger" data-action="logout">Đăng xuất</button>
    <p class="small center-text" style="margin-top:18px">havsAI · Web / PWA / Android Đa nền tảng</p>
  </div>`;
}

function renderPaymentsDisabled() {
  return `<div class="pad"><h1>Thanh toán đã tắt</h1><p>havsAI không có gói trả phí, Stripe hay Play Billing. Mọi tính năng học tập đang mở.</p><button class="btn" data-action="nav" data-value="/">Về trang chủ</button></div>`;
}

function renderLegal() {
  const page = state.route.params.page;
  const titles = { support: 'Hỗ trợ', 'privacy-policy': 'Chính sách riêng tư', 'terms-conditions': 'Điều khoản sử dụng' };
  return `<div class="pad"><button class="btn ghost" data-action="nav" data-value="/settings">← Cài đặt</button><h1>${titles[page] || 'Thông tin'}</h1><div class="card"><p>havsAI là bản viết lại phục vụ học tập. Dữ liệu chat, upload và tiến độ được lưu trên server của bạn. Không có thanh toán.</p><p>Liên hệ: support@havs.ai</p></div></div>`;
}

document.addEventListener('click', async (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const value = el.dataset.value || '';
  if (action === 'nav') {
    event.preventDefault();
    navigate(value || '/');
    return;
  }
  if (action === 'exam-open') { navigate(`/exam-preps/${value}`); return; }
  if (action === 'exam-search') {
    const q = document.getElementById('exam-search')?.value.trim() || '';
    navigate(`/exam-preps/search?q=${encodeURIComponent(q)}`);
    return;
  }
  if (action === 'exam-create') {
    const title = document.getElementById('prep-title')?.value.trim();
    const subject = document.getElementById('prep-subject')?.value;
    const examDate = document.getElementById('prep-date')?.value;
    try {
      const created = await api('/api/exam-preps', { method: 'POST', body: JSON.stringify({ title, subject, examDate }) });
      await api(`/api/exam-preps/${created.id}/generate`, { method: 'POST' }).catch(() => {});
      toast('Đã tạo đề và sinh kế hoạch');
      navigate(`/exam-preps/${created.id}`);
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'exam-generate') {
    try {
      await api(`/api/exam-preps/${value}/generate`, { method: 'POST' });
      toast('Đã sinh kế hoạch');
      navigate(`/exam-preps/${value}`);
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'exam-catalog-create') {
    try {
      const created = await api('/api/exam-preps/from-catalog', { method: 'POST', body: JSON.stringify({ catalogId: value }) });
      await api(`/api/exam-preps/${created.id}/generate`, { method: 'POST' }).catch(() => {});
      toast('Đã tạo đề từ danh mục');
      navigate(`/exam-preps/${created.id}`);
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'exam-share') {
    try {
      const data = await api(`/api/exam-preps/${value}/share`, { method: 'POST' });
      const url = `${location.origin}${data.url}`;
      if (navigator.share) await navigator.share({ title: 'havsAI', url }).catch(() => {});
      else await navigator.clipboard?.writeText(url).catch(() => {});
      toast('Đã tạo link chia sẻ');
      await loadRouteData(); render();
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'lesson-complete') {
    const [prepId, lessonId] = value.split('|');
    try {
      await api(`/api/exam-preps/${prepId}/lessons/${lessonId}/complete`, { method: 'POST' });
      toast('Đã hoàn thành bài học');
      await loadRouteData(); render();
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'challenge-submit') {
    const [prepId, challengeId] = value.split('|');
    const answer = document.getElementById('challenge-answer')?.value || '';
    try {
      const data = await api(`/api/exam-preps/${prepId}/challenges/${challengeId}/attempt`, { method: 'POST', body: JSON.stringify({ answers: { [challengeId]: answer } }) });
      state.attempt = data.attempt;
      render();
      toast(`Kết quả: ${data.attempt.score}/${data.attempt.total}`);
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'mock-submit') {
    const [prepId, mockId] = value.split('|');
    const answers = {};
    document.querySelectorAll('[data-qid]').forEach((input) => { answers[input.dataset.qid] = input.value; });
    try {
      const data = await api(`/api/exam-preps/${prepId}/mock-exams/${mockId}/attempts`, { method: 'POST', body: JSON.stringify({ answers }) });
      state.attempt = data.attempt;
      render();
      toast(`Kết quả: ${data.attempt.score}/${data.attempt.total}`);
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'lab-create') {
    const name = document.getElementById('lab-name')?.value.trim();
    const prompt = document.getElementById('lab-prompt')?.value.trim();
    if (!prompt) { toast('Nhập mô tả app'); return; }
    el.disabled = true;
    try {
      const data = await api('/api/lab/apps', { method: 'POST', body: JSON.stringify({ name, prompt }) });
      toast('Đã tạo app');
      navigate(`/lab/${data.app.slug}`);
    } catch (error) { toast(error.message); } finally { el.disabled = false; }
    return;
  }
  if (action === 'lab-publish') {
    const [slug, visibility] = value.split('|');
    try {
      await api(`/api/lab/apps/${slug}`, { method: 'PATCH', body: JSON.stringify({ visibility }) });
      toast('Đã cập nhật');
      await loadRouteData(); render();
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'calendar-add') {
    const title = document.getElementById('calendar-title')?.value.trim();
    const date = document.getElementById('calendar-date')?.value;
    const kind = document.getElementById('calendar-kind')?.value || 'study';
    if (!title || !date) { toast('Nhập tên và ngày'); return; }
    try {
      await api('/api/calendar', { method: 'POST', body: JSON.stringify({ title, date, kind }) });
      toast('Đã thêm sự kiện');
      await loadRouteData(); render();
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'calendar-delete') {
    try {
      await api(`/api/calendar/${value}`, { method: 'DELETE' });
      await loadRouteData(); render();
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'cc-save') {
    const name = document.getElementById('cc-account-name')?.value.trim() || '';
    const apiKey = document.getElementById('cc-account-key')?.value.trim() || '';
    const mode = document.getElementById('cc-account-mode')?.value || 'add';
    if (!apiKey) { toast('Vui lòng dán API key hoặc nội dung auth.json của Command Code'); return; }
    el.disabled = true;
    try {
      const res = await api('/api/ai/commandcode', { method: 'POST', body: JSON.stringify({ name, apiKey, mode }) });
      await loadRouteData();
      render();
      if (res.testResult?.ok) {
        toast(`Đã kích hoạt tài khoản Command Code thành công (${res.testResult.latencyMs} ms)`);
      } else {
        toast(`Đã lưu nhưng kiểm tra kết nối báo: ${res.testResult?.error || 'chưa kết nối được'}`);
      }
    } catch (error) {
      toast(error.message === 'invalid_auth_json' ? 'Nội dung JSON auth.json không hợp lệ' : error.message);
    } finally {
      el.disabled = false;
    }
    return;
  }
  if (action === 'cc-activate') {
    try {
      const res = await api('/api/ai/commandcode', { method: 'POST', body: JSON.stringify({ action: 'activate', id: value }) });
      await loadRouteData();
      render();
      if (res.testResult?.ok) {
        toast(`Đã chuyển sang tài khoản Command Code (${res.testResult.latencyMs} ms)`);
      } else {
        toast(`Đã chuyển nhưng kết nối báo: ${res.testResult?.error || 'lỗi'}`);
      }
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'cc-delete') {
    try {
      await api('/api/ai/commandcode', { method: 'POST', body: JSON.stringify({ action: 'delete', id: value }) });
      await loadRouteData();
      render();
      toast('Đã xóa tài khoản Command Code');
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'settings-save') {
    const interests = (document.getElementById('set-interests')?.value || '').split(',').map((item) => item.trim()).filter(Boolean);
    const body = {
      name: document.getElementById('set-name')?.value.trim(),
      voice: document.getElementById('set-voice')?.value,
      theme: document.getElementById('set-theme')?.value,
      studyTime: document.getElementById('set-study-time')?.value,
      interests,
      notifications: document.getElementById('set-notifications')?.checked,
      school: document.getElementById('set-school')?.value.trim(),
      className: document.getElementById('set-class')?.value.trim(),
      settings: {
        ...(state.settings || {}),
        dyslexia: !!document.getElementById('set-dyslexia')?.checked,
        focusMode: !!document.getElementById('set-focus')?.checked
      }
    };
    try {
      const data = await api('/api/settings', { method: 'PATCH', body: JSON.stringify(body) });
      state.profile = data.profile;
      state.settings = data.settings || {};
      toast('Đã lưu cài đặt');
      render();
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'join-share') {
    try {
      const data = await api(`/api/exam-preps/join/${value}`, { method: 'POST' });
      toast('Đã tham gia đề');
      navigate(`/exam-preps/${data.id}`);
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'child-open') { navigate(`/child/${value}`); return; }
});

window.addEventListener('popstate', () => {
  state.route = parseRoute();
  if (state.view === 'main') {
    loadRouteData().then(() => render()).catch((error) => { state.routeError = error.message; render(); });
  }
});

const EXAM_SOURCES = [
  ['files', '📤', 'Tệp của bạn', 'TẢI LÊN GHI CHÉP, HÌNH ẢNH HOẶC SÁCH GIÁO KHOA'],
  ['school', '🏫', 'Trường của tôi', 'BỘ ĐỀ VÀ TÀI LIỆU CỦA TRƯỜNG'],
  ['curriculum', '📘', 'Chương trình học', 'TOÁN HỌC · TIỂU HỌC (LỚP 1-5), LỚP...'],
  ['official', '🇻🇳', 'Kỳ thi chính thức', 'ĐỀ THI CHÍNH THỨC']
];

function examDateISO(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function examDatePretty(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' });
}

function openExamWizard(source) {
  state.examWizard = {
    step: source ? 1 : 0,
    source: source || 'files',
    subject: state.subject || 'math',
    examDate: '',
    uploadId: null,
    uploadName: '',
    uploadPages: 0
  };
  render();
}

function renderExamWizard() {
  const wizard = state.examWizard;
  if (!wizard) return '';

  if (wizard.step === 0) {
    return `<div class="wizard-backdrop">
      <div class="wizard-hit" data-action="close-wizard"></div>
      <div class="modal wizard-sheet">
        <div class="wizard-sheet-head">
          <button class="icon-btn" data-action="close-wizard">✕</button>
          <b>Bài mới</b>
          <span class="icon-btn invisible">✕</span>
        </div>
        <div class="source-list">
          ${EXAM_SOURCES.map(([id, icon, title, subtitle]) => `<button class="source-option ${wizard.source === id ? 'active' : ''}" data-action="wizard-source" data-value="${id}">
            <span class="source-icon">${icon}</span>
            <span class="grow" style="text-align:left"><b>${title}</b><small>${subtitle}</small></span>
            ${wizard.source === id ? '<span class="source-check">✓</span>' : ''}
          </button>`).join('')}
        </div>
        <button class="btn" data-action="wizard-next">Tiếp tục</button>
      </div>
    </div>`;
  }

  const progress = wizard.step === 1 ? 33 : wizard.step === 2 ? 66 : 100;
  const bar = `<div class="wizard-bar">
    <button class="icon-btn" data-action="${wizard.step === 1 ? 'close-wizard' : 'wizard-back'}">←</button>
    <div class="wizard-progress"><span style="width:${progress}%"></span></div>
    <button class="icon-btn" data-action="close-wizard">✕</button>
  </div>`;

  if (wizard.step === 1) {
    return `<div class="wizard-overlay">
      ${bar}
      <h1 class="center-text wizard-title">Bạn thi môn gì?</h1>
      <div class="field"><input id="wizard-subject-search" class="input" placeholder="Nhập môn học của bạn" autocomplete="off" /></div>
      <div class="center-text" style="margin-bottom:18px"><button class="btn secondary" style="width:auto" data-action="wizard-add-subject">＋ Thêm môn học của bạn</button></div>
      <p class="section-label">MÔN HỌC TỔNG QUÁT</p>
      <div class="subject-grid">
        ${SUBJECTS.map(([id, label]) => `<button class="subject-tile ${wizard.subject === id ? 'active' : ''}" data-action="wizard-subject" data-value="${id}" data-subject-tile="${esc(label)}">
          <span>${SUBJECT_META[id] || '📘'}</span><b>${esc(label)}</b>
        </button>`).join('')}
      </div>
      <button class="btn wizard-cta" data-action="wizard-next">Tiếp tục</button>
    </div>`;
  }

  if (wizard.step === 2) {
    const options = [
      ['Ngày mai', 1],
      ['Trong 2 ngày nữa', 2],
      ['Trong 3 ngày nữa', 3],
      ['Vài ngày tới', 10]
    ];
    return `<div class="wizard-overlay">
      ${bar}
      <h1 class="center-text wizard-title">Khi nào bạn có bài kiểm tra?</h1>
      <div class="date-list">
        ${options.map(([label, offset]) => {
          const value = examDateISO(offset);
          const date = new Date(`${value}T00:00:00`);
          return `<button class="date-option ${wizard.examDate === value ? 'active' : ''}" data-action="wizard-date-next" data-value="${value}">
            <span class="grow"><b>${label}</b><small>${examDatePretty(value)}</small></span>
            <span class="date-chip"><b>${date.getDate()}</b><small>THG ${date.getMonth() + 1}</small></span>
          </button>`;
        }).join('')}
      </div>
      <div class="or-sep"><span>HOẶC</span></div>
      <input id="wizard-date-custom" type="date" class="input hidden" value="${wizard.examDate || ''}" />
      <div class="center-text"><button class="btn secondary" style="width:auto" data-action="wizard-pick-date">📅 Chọn ngày</button></div>
      ${wizard.examDate ? `<p class="center-text small" style="margin-top:14px">Đã chọn: ${esc(examDatePretty(wizard.examDate))}</p>
        <button class="btn" data-action="wizard-next">Tiếp tục</button>` : ''}
    </div>`;
  }

  return `<div class="wizard-overlay">
    ${bar}
    <h1 class="center-text wizard-title">Tải tài liệu học lên</h1>
    <p class="center-text">Chỉ nội dung môn ${esc(subjectName(wizard.subject))}</p>
    <div class="upload-hero">
      <div class="upload-phone">📱</div>
      <b>Chụp ảnh</b>
      <p>Từ ghi chép, sách giáo khoa và đề thi cũ của bạn.</p>
      <button class="btn" style="width:auto" data-action="wizard-upload" data-value="camera">Mở máy ảnh</button>
    </div>
    <p class="section-label center-text">Lựa chọn khác</p>
    <div class="row" style="justify-content:center">
      <button class="btn secondary" data-action="wizard-upload" data-value="gallery">🖼 Thư viện ảnh</button>
      <button class="btn secondary" data-action="wizard-upload" data-value="file">📁 Chọn tệp</button>
    </div>
    <input id="wizard-camera" type="file" accept="image/*" capture="environment" class="hidden" />
    <input id="wizard-gallery" type="file" accept="image/*" class="hidden" />
    <input id="wizard-file" type="file" accept="image/*,application/pdf" class="hidden" />
    ${wizard.uploadName ? `<div class="item attach-preview"><span>📄</span><div class="grow"><b>${esc(wizard.uploadName)}</b><small>${wizard.uploadPages ? `${wizard.uploadPages} trang` : 'Đã tải lên'}</small></div><button class="btn ghost" data-action="wizard-remove-upload">Bỏ</button></div>` : ''}
    <div class="info-box"><span>ⓘ</span><p><b>Vì sao tài liệu của bạn quan trọng</b><br>Bạn càng thêm nhiều tài liệu, havsAI càng hiểu rõ hơn. havsAI xác định các chủ đề, lập kế hoạch và tạo bài luyện sát với bài kiểm tra của bạn.</p></div>
    <button class="btn ghost" data-action="wizard-create">Tiếp tục không có tài liệu</button>
    <button class="btn" data-action="wizard-create">Tiếp tục${wizard.uploadId ? ' với tài liệu' : ''}</button>
  </div>`;
}

async function createExamFromWizard() {
  const wizard = state.examWizard;
  if (!wizard) return;
  const title = `${subjectName(wizard.subject)}${wizard.examDate ? ` · ${wizard.examDate}` : ''}`;
  try {
    const created = await api('/api/preps', {
      method: 'POST',
      body: JSON.stringify({
        title,
        subject: wizard.subject,
        examDate: wizard.examDate,
        uploadId: wizard.uploadId || null,
        source: wizard.source
      })
    });
    try { await api(`/api/preps/${created.id}/generate`, { method: 'POST' }); } catch {}
    state.examWizard = null;
    toast('Đã tạo kỳ thi và sinh kế hoạch');
    navigate(`/exam-preps/${created.id}`);
  } catch (error) {
    toast(error.message);
  }
}

function renderProfilePage() {
  const profile = state.profile || {};
  const name = profile.name || 'Học sinh';
  const meta = [profile.age ? String(profile.age) : '', profile.country || 'Việt Nam'].filter(Boolean).join(' · ');
  const week = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'];
  const today = (new Date().getDay() + 6) % 7;
  return `<div class="pad profile-page">
    <div class="profile-head">
      <div class="profile-avatar">${esc(name[0].toUpperCase())}</div>
      <h1>${esc(name)}</h1>
      <p>${esc(meta)}</p>
      <button class="btn secondary profile-settings" data-action="nav" data-value="/settings">⚙ Cài đặt</button>
    </div>
    <div class="card plan-card">
      <div class="row">
        <div class="grow"><b>${profile.plan === 'free' || !profile.plan ? 'Cơ bản' : esc(profile.plan)}</b><p style="margin:0">Gói miễn phí</p></div>
        <button class="btn plan-cta" data-action="upgrade">Học nhanh hơn ✨</button>
      </div>
    </div>
    <button class="card invite-card" data-action="invite">
      <span class="coin">🪙</span>
      <span class="grow" style="text-align:left"><b>Mời bạn & nhận thêm lượt dùng</b><p>Nhận đến 400x lượt dùng khi bạn mời bạn bè.</p></span>
      <span class="chev">›</span>
    </button>
    <div class="card streak-card">
      <div class="row"><span class="flame">🔥</span><div class="grow"><b>Bạn chưa có streak nào</b><p>Hãy bắt đầu ngay hôm nay và tạo streak đầu tiên của bạn!</p></div></div>
      <div class="streak-week">${week.map((label, index) => `<div class="streak-day ${index === today ? 'today' : ''}"><span>${label}</span><i>🔥</i></div>`).join('')}</div>
    </div>
    <p class="small center-text muted" style="margin-top:16px">${esc(state.user?.email || '')}</p>
  </div>`;
}
