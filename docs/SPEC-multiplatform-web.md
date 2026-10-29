# Spec: Multi-Device & Multi-Platform Web + PWA (`havsAI`)

## Objective
Upgrade `fullstack/` from a narrow mobile-only (`560px`) TWA view into a complete, responsive **Multi-Device & Multi-Platform Web App + Installable PWA** that works seamlessly across:
1. **Desktop & Laptop Browsers** (Windows, macOS, Linux — wide multi-column workspace, persistent left navigation rail, chat history sidebar with create/rename/delete chat, drag-and-drop & clipboard paste file upload, keyboard shortcuts).
2. **Tablets & iPads** (`768px–1023px` adaptive two-column shell).
3. **Mobile Browsers & Installed PWA** (iOS Safari Add-to-Home-Screen, Android Chrome, Desktop PWA with offline shell caching via `/sw.js`, SVG/PNG icons, and Web Notification fallback).
4. **Android TWA Shell (`com.havs.ai`)** (100% backward-compatible with Custom Tabs `postMessage` bridge via a unified `havsPlatform` adapter).

## Tech Stack
- **Backend:** Node.js `>=22.5` (`node:http`, `node:sqlite`, `pdfjs-dist`, `@napi-rs/canvas`)
- **Frontend:** Vanilla ES2022 SPA (`fullstack/public/app.js`, `fullstack/public/features.js`, `fullstack/public/styles.css`), self-hosted KaTeX (`vendor/katex/`)
- **PWA:** Web App Manifest (`manifest.webmanifest`), Service Worker (`fullstack/public/sw.js`), SVG app icons (`icon.svg`, `icon-maskable.svg`)
- **Android TWA:** Kotlin (`compileSdk = 35`), AndroidX Browser `1.8.0`

## Commands
```bash
# Run fullstack tests
npm --prefix fullstack test

# Start fullstack server
node fullstack/server.js

# Run Android unit tests
./gradlew :app:testDebugUnitTest
```

## Project Structure
```text
fullstack/
  server.js                 → HTTP server, REST/SSE APIs, static & PWA asset serving
  admin.js                  → Admin portal APIs & dynamic /theme.css
  public/
    index.html              → App shell with responsive meta, iOS PWA tags, manifest & scripts
    manifest.webmanifest    → Multi-platform PWA manifest (any orientation, icons, shortcuts)
    sw.js                   → Service worker (app-shell cache + network-first navigation fallback)
    icon.svg                → Scalable brand icon (#00a10d + #ea580c)
    icon-maskable.svg       → Maskable PWA icon for Android/Desktop/iOS
    styles.css              → Mobile-first + Tablet (768px+) + Desktop (1024px+) responsive design system
    app.js                  → Core state, unified platform bridge (TWA + Web), chat & sidebar UI
    features.js             → Multi-column feature views (Exam preps, Lab split-view, Dashboard, Calendar, Settings)
  tests/
    server.test.js          → Backend API tests (including user chat PATCH/DELETE & realtime sync)
    static.test.js          → Static, security, brand & multi-platform PWA invariants
```

## Code Style
- Zero external frontend runtime dependencies; self-hosted assets only (no external CDN `<script>` or `<link>` tags).
- HTML escaping via `esc()` for all dynamic strings; KaTeX rendered with `trust: false`.
- Semantic CSS variables (`--bg`, `--panel`, `--panel-2`, `--line`, `--text`, `--muted`, `--accent`, `--accent-2`, `--on-accent`).

```javascript
// Example: Unified platform adapter (Android TWA postMessage + Web fallback)
window.havsPlatform = {
  get runtime() {
    if (this.port) return 'android-twa';
    if (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone) return 'pwa';
    return 'web';
  }
};
```

## Testing Strategy
- **Integration Tests (`fullstack/tests/server.test.js`):** Test user chat CRUD (`GET /api/chats`, `POST /api/chats`, `PATCH /api/chats/:id`, `DELETE /api/chats/:id`), cross-user isolation, and PWA asset HTTP responses (`/sw.js`, `/icon.svg`, `/manifest.webmanifest`).
- **Static & Invariant Tests (`fullstack/tests/static.test.js`):** Verify syntax (`node --check`), responsive desktop/tablet CSS rules, PWA manifest icons & orientation, Service Worker registration, unified TWA/Web bridge, and existing security invariants.

## Boundaries
- **Always do:** Run `npm --prefix fullstack test` after every slice; preserve all security invariants (`trust: false`, `sandbox="allow-scripts"`, HttpOnly cookies, brand colors `#ea580c` / `#00a10d`).
- **Ask first:** Adding npm dependencies or changing database primary keys.
- **Never do:** Load external JS/CSS from CDNs, break mobile/Android TWA layout, or expose other users' chats/uploads.

## Success Criteria
1. **User Chat Management & Sync API:** Users can create, rename (`PATCH /api/chats/:id`), and delete (`DELETE /api/chats/:id`) their own conversations; profile/theme/chat updates broadcast over `/api/realtime` for multi-device sync.
2. **Installable Multi-Platform PWA:** `manifest.webmanifest` includes valid icons (`icon.svg`, `icon-maskable.svg`), `orientation: "any"`, shortcuts; `/sw.js` caches static shell and handles offline navigation; `index.html` includes Apple PWA meta tags.
3. **Responsive Desktop & Tablet Layout:**
   - `< 768px`: Preserves mobile layout + bottom navigation + collapsible chat history drawer.
   - `>= 768px` & `>= 1024px`: Full-viewport multi-column layout with left navigation sidebar, persistent chat history panel (new chat, switch chat, rename/delete chat), wider chat reading area, two-column Exam Prep / Dashboard / Calendar grids, and side-by-side editor + preview in AI Lab.
4. **Desktop & Cross-Platform Ergonomics:** Drag-and-drop & clipboard image paste in chat, keyboard shortcuts (`Ctrl/Cmd+K` or `/` to focus input), Web Notification & PWA install controls in Settings, and automatic Android TWA `postMessage` bridge handshake when opened inside `com.havs.ai`.

## Open Questions
- None (intent confirmed with user).
