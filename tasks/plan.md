# Implementation Plan: Multi-Device & Multi-Platform Web + PWA (`havsAI`)

## Overview
Transform `fullstack/` into a responsive, multi-device, multi-platform Web & PWA application that scales from 320px mobile/TWA screens to 768px tablets and 1440px+ desktop monitors, while adding full PWA installability, a unified Android TWA / Web platform bridge, chat history management, and real-time multi-device synchronization.

## Architecture Decisions
1. **Single Codebase, Adaptive Shell:** Keep `fullstack/public/` as the single source of truth so Desktop Web, Mobile Web, Installed PWA (iOS/Android/Desktop), and Android TWA share 100% of features and routes without duplication.
2. **CSS Grid Responsive Breakpoints:**
   - Default (`< 768px`): Single-column mobile view with sticky `.header`, `.bottom-nav`, and slide-over chat history drawer.
   - Tablet (`>= 768px`): Left navigation rail + main workspace content area with 2-column cards.
   - Desktop (`>= 1024px`): Left navigation rail + dedicated Chat History / Context column (`280px`) + fluid main workspace (`max-width: 1440px`).
3. **Unified Platform Bridge (`window.havsPlatform`):** Automatically detects `android-twa` (when Custom Tabs `MessagePort` connects with `havs-native-ready`), `pwa` (`display-mode: standalone`), or `web` browser, routing theme changes, analytics events, identity, and notifications to either the Android native bridge or Web APIs.
4. **Self-Contained SVG Icons & Service Worker:** Serve `/icon.svg`, `/icon-maskable.svg`, and `/sw.js` directly from `fullstack/public/` with zero external dependencies.

## Task List

### Phase 1: Foundation (Backend Multi-Device Sync & PWA Assets)
- [x] Task 1: Add user chat management (`PATCH /api/chats/:id`, `DELETE /api/chats/:id`) and multi-device realtime events (`chat.deleted`, `profile.updated`) in `fullstack/server.js`.
- [x] Task 2: Add multi-platform PWA assets (`icon.svg`, `icon-maskable.svg`, `sw.js`, updated `manifest.webmanifest`, iOS/PWA meta tags in `index.html`).

### Checkpoint: Foundation
- [x] Backend unit/integration tests and PWA static checks pass (`npm --prefix fullstack test`).

### Phase 2: Core Multi-Device UI & Platform Bridge
- [x] Task 3: Implement unified `havsPlatform` bridge (Android TWA `postMessage` + Web/PWA APIs, install prompt, Web Notifications, drag-and-drop & paste uploads, keyboard shortcuts) and Chat History management (sidebar + mobile drawer) in `fullstack/public/app.js`.
- [x] Task 4: Upgrade `fullstack/public/styles.css` and `fullstack/public/features.js` with responsive Tablet/Desktop layouts (left navigation sidebar, multi-column Exam Prep / Dashboard / Calendar grids, split-screen Lab builder, platform/device status in Settings).

### Checkpoint: Complete
- [x] All acceptance criteria met
- [x] Full test suite passes (`npm --prefix fullstack test` and `./gradlew :app:testDebugUnitTest`)

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Static test regexes in `tests/static.test.js` check exact CSS/HTML patterns | High | Preserve all existing selectors (`--accent: #ea580c`, `.logo`, `theme-color`, KaTeX self-host, iframe sandbox) and extend tests additively |
| Service Worker caching stale API responses | Medium | Only cache static shell assets (`/`, `/styles.css`, `/app.js`, `/features.js`, `/vendor/katex/*`); bypass `/api/*`, `/admin*`, and `/uploads/*` |
| Mobile/TWA regression from desktop CSS | High | Scope desktop/tablet layout changes strictly inside `@media (min-width: 768px)` and `@media (min-width: 1024px)` |

## Open Questions
- None.
