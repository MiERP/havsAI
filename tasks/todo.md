# Task Breakdown: Multi-Device & Multi-Platform Web + PWA

## Task 1: User Chat CRUD & Multi-Device Realtime Sync API
**Description:** Allow authenticated users to rename (`PATCH /api/chats/:id`) and delete (`DELETE /api/chats/:id`) their own chats, and broadcast `chat.deleted`, `chat.updated`, and `profile.updated` events over `/api/realtime` so open tabs across Desktop/Mobile stay in sync.

**Acceptance criteria:**
- [x] `PATCH /api/chats/:id` updates `title` and/or `subject` for the owner's chat and returns `404` for other users.
- [x] `DELETE /api/chats/:id` deletes the chat and its messages in a transaction for the owner and returns `404` for other users.
- [x] Realtime SSE broadcasts `chat.updated`, `chat.deleted`, and `profile.updated`.

**Verification:**
- [x] Tests pass: `npm --prefix fullstack test`

**Dependencies:** None
**Files likely touched:**
- `fullstack/server.js`
- `fullstack/tests/server.test.js`
**Estimated scope:** Small (2 files)

---

## Task 2: Multi-Platform PWA Assets, Manifest & Service Worker
**Description:** Make `havsAI` a first-class installable PWA across Desktop (Windows/macOS/Linux), Android, and iOS Safari with scalable icons, adaptive orientation, offline app-shell caching, and iOS standalone meta tags.

**Acceptance criteria:**
- [x] `fullstack/public/icon.svg` and `fullstack/public/icon-maskable.svg` exist using brand colors (`#00a10d` and `#ea580c`).
- [x] `fullstack/public/manifest.webmanifest` defines `orientation: "any"`, icons (`any` + `maskable`), and shortcuts.
- [x] `fullstack/public/sw.js` caches the static app shell while bypassing `/api/*`, `/admin*`, and `/uploads/*`.
- [x] `fullstack/public/index.html` includes iOS PWA meta tags and icon links without any external CDN URLs.

**Verification:**
- [x] Tests pass: `npm --prefix fullstack test`

**Dependencies:** Task 1
**Files likely touched:**
- `fullstack/public/icon.svg`
- `fullstack/public/icon-maskable.svg`
- `fullstack/public/manifest.webmanifest`
- `fullstack/public/sw.js`
- `fullstack/public/index.html`
- `fullstack/tests/static.test.js`
**Estimated scope:** Medium (5-6 files)

---

## Checkpoint: After Tasks 1-2
- [x] All backend and static tests pass (`npm --prefix fullstack test`)
- [x] PWA manifest, icons, and `/sw.js` are served with correct MIME types

---

## Task 3: Unified Platform Bridge (`havsPlatform`) & Multi-Device Chat Workspace
**Description:** Upgrade `fullstack/public/app.js` with:
1. Unified `window.havsPlatform` adapter supporting Android TWA `postMessage` (`havs-native-ready`, `havs-device-info`, `havs-set-theme`, `havs-identify`, `havs-track-event`, `havs-request-push-permission`) AND Web/PWA fallbacks (`beforeinstallprompt`, Web Notification API, runtime detection).
2. Responsive Desktop/Tablet Navigation Sidebar + Chat History panel (create new chat, switch chat, rename chat, delete chat, mobile drawer toggle).
3. Desktop ergonomics: drag-and-drop file/PDF/image upload onto chat, clipboard image paste (`Ctrl+V`), and keyboard shortcut (`/` or `Ctrl+K` to focus composer).

**Acceptance criteria:**
- [x] `window.havsPlatform` handles Android TWA `MessagePort` messages and provides Web/PWA fallbacks.
- [x] Users can view chat history, start a new chat, switch chats, rename, and delete chats on both Desktop (persistent panel) and Mobile (drawer).
- [x] Drag-and-drop and clipboard paste upload files directly into the chat composer.
- [x] Realtime SSE listener updates chats and theme/profile live across open devices/tabs.

**Verification:**
- [x] Tests pass: `npm --prefix fullstack test`

**Dependencies:** Task 1, Task 2
**Files likely touched:**
- `fullstack/public/app.js`
- `fullstack/tests/static.test.js`
**Estimated scope:** Medium (2 files)

---

## Task 4: Responsive Desktop/Tablet Layout & Multi-Column Feature Views
**Description:** Upgrade `fullstack/public/styles.css` and `fullstack/public/features.js` so Tablet (`>= 768px`) and Desktop (`>= 1024px`) viewports use a full-screen multi-column workspace (left sidebar nav, chat history column, wide content panels, split-view AI Lab editor + preview, multi-column Exam Prep / Dashboard / Calendar, and Multi-Platform / PWA status card in Settings).

**Acceptance criteria:**
- [x] Mobile (`< 768px`) keeps the compact bottom-nav + single-column layout.
- [x] Tablet (`>= 768px`) and Desktop (`>= 1024px`) expand to multi-column layout with sidebar navigation, wider chat messages, 2-column grids for Exam Prep / Stats / Calendar, and split-pane Lab view.
- [x] Settings page includes a "Thiết bị & Đa nền tảng" card showing current runtime (`Web Browser` / `Installed PWA` / `Android TWA`), PWA install button, and notification toggle.

**Verification:**
- [x] Tests pass: `npm --prefix fullstack test`
- [x] Android unit tests pass: `./gradlew :app:testDebugUnitTest`

**Dependencies:** Task 3
**Files likely touched:**
- `fullstack/public/styles.css`
- `fullstack/public/features.js`
- `fullstack/tests/static.test.js`
- `README.md`
**Estimated scope:** Medium (4 files)
