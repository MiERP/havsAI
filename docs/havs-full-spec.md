# havsAI — full product spec (original Astra research + rewrite)

## 1. Evidence and method

- Shipped artifact: `co.astra_ai.app.twa` 3.4.336 (TWA shell, 4 split APKs pulled from Galaxy A23).
- Runtime: Chrome 152 on the A23, CDP via `adb forward tcp:9222 localabstract:chrome_devtools_remote`.
- Captured: onboarding DOM/text, 74 first-party JS chunks (5.2 MB), i18n (`/api/i18n/vi-VN`), network transactions.
- No account credentials were used. Authenticated areas (`/chat`, `/dashboard`, `/settings`) redirect to `/login` and were not entered; their behavior is inferred from shipped JS/i18n and product routes.

## 2. Observed stack

- Client: Next.js App Router + React, Turbopack chunks, tRPC client, Tailwind-like styling, Sentry.
- API: `/api/trpc/*` (batch + streaming links), `/api/auth/get-session`, `/api/i18n/:locale`, `/api/realtime`, `/api/e`, `/api/evlog/ingest`, `/api/uploads` (signed URL flow), `/api/legal/*`, `/api/surveys`, `/api/product_tours`, `/api/web_experiments`.
- Auth: session cookie via auth provider (email OTP, Google, Apple; disposable/undeliverable email checks).
- Uploads: `files.createUploadUrls` / `examPrep.onboardingDrafts.createUploadUrls` return `{id, signedUrl, downloadUrl}`; client PUTs bytes to `signedUrl`.
- Realtime: `/api/realtime` channel protocol `{type: connected|error|disconnected|ping}` and events `{id, event, channel, data}` with reconnect logic (used for cross-device/profile updates).
- Billing: Stripe.js on web + native Play Billing bridge (`app_package`, `native_billing_key`, `supports_native_billing`, `force_native_billing`, product `astra_ai_plus_yearly`, Chromium PAY intent).
- Analytics: PostHog (project `phc_F7dF…`), Singular (`astra_ai_9becea26`), TikTok pixel, Google Ads/GTM, Sentry.
- Media: voice samples at `cdn.astra-ai.co/tutor-persona-voice-samples-v4/<locale>/<voice>.mp3`.

## 3. Product map (from i18n and routes)

Personas: student, parent, teacher (parent flows include child accounts, child progress, guardian permission, parental controls).

Onboarding steps observed in URLs / i18n:
- `welcome`, `role-select`, `voice`, `basic-profile-info`, `age`, `region`, `country`, `school`, `school-year`, `study-time`, `interests`, `referral-source`, `push-notifications`, `profile-ready`, `purchase-success`.
- Exam-prep emergency flow: `emergency-creation-intent`, `emergency-exam-date`, `emergency-goal`, `emergency-join-school`, `emergency-subjects`, `emergency-notes-choice`, `emergency-file-upload`, `emergency-worry`.
- Official exam flow: `official-exam-pick`, `onboarding-intent`, `goals-recap`, `frustrations`, `explore-experience`.
- Teacher flow: `showcase`, `help-focus`, `pain-points`, `time-saved`, `voices`, `subjects`, `request-drawer`, `request-sent`.

Chat capabilities (i18n `chat.*`):
- Streaming tutor answers, reasoning/thinking states, tool activity (web search, read material, update goals, memory, curriculum, calendar, computer, app build/edit).
- Subject switching, suggested questions, image capture and web images, document/PDF (max pages), canvas, math keyboard, periodic table (118 elements), chemistry/physics keyboards, mood check-in, knowledge-level dialog (A1–C2), solver mode, limits/upgrade prompts.

Exam prep (`features.examPrep.*` + `examPrep.*`):
- Create/join exam prep, upload notes, generate study plan, lessons, challenges, shared public preview, invite metadata, progress/mastery, school/curriculum filters, official exams by country.

Dashboard/settings:
- Learning hours, weekly heatmap, subjects score, exam preps, streak, savings, achievements.
- Settings: profile image, notifications, marketing, role, theme, dyslexia mode, private profile, child accounts, parent connection, usage limits/top-up/promo tiers, focus mode (blocked apps, time limits, pause).

Monetization:
- Free limits with usage buckets (`subscription`, `topUp`, `promo`) and tiers; Plus monthly/yearly; upgrade confirmation; restore subscription; Stripe checkout and Google Play native billing.

## 4. API inventory (observed)

tRPC procedures observed directly in network:
`appVersion.checkForUpdates`, `banners.list`, `banners.markSeen`, `profile.getProfile`,
`profile.updateDeviceIdentifiers`, `profile.updateOnboardingProfile`, `profile.getUserCount`,
`profile.getJoinedCountsByRole`, `limits.getOwn`, `files.createUploadUrls`,
`examPrep.onboardingDrafts.getActive`, `examPrep.onboardingDrafts.createUploadUrls`,
`examPrep.onboardingDrafts.upsert`, `examPrep.onboardingDrafts.listSchoolExamPreps`,
`examPrep.onboardingDrafts.countSchoolExamPreps`, `examPrep.officialExams.countries`,
`examPrep.officialExams.list`, `examPrep.sharing.getExamPrepPublicPreview`,
`examPrep.sharing.getInviteMetadata`.

Inferred from client code: `chat.addSubject`, `chat.subjects`, subscription upgrade/restore, profile child-account operations, push registration, notification settings, focus mode.

## 5. Data model (inferred)

- `user` (id, email, role, auth providers), `session`.
- `profile` (name, age, country, locale, school, grade, subjects, voice, goals, exam date, onboarding state, plan, limits, theme, flags).
- `chat` (id, user, subject, title, timestamps), `message` (role, content, reasoning, tool calls, artifacts, images, tokens).
- `exam_prep` (draft/active, exam, subjects, sources, plan, lessons, challenges, mastery, share id).
- `upload` (owner, filename, mime, size, storage key), `subscription` (plan, status, period), `usage_bucket` (subscription/topup/promo), `child_account`, `device`, `event`.

## 6. havsAI architecture (implemented in the project root)

- `app/` — Kotlin TWA shell `com.havs.ai` (launcher, postMessage bridge, push, deep links, review, identify) already tested on the A23.
- `fullstack/server.js` — Node HTTP server:
  - SQLite (built-in `node:sqlite`): users, sessions, profiles, chats, messages, uploads, preps, events.
  - Auth: email OTP (dev code `123456`), HttpOnly session cookie `havs_session`.
  - Onboarding/profile/limits/voices/preps/dashboard/events/uploads.
  - Chat streaming over SSE. Model provider: **Command Code** (`https://api.commandcode.ai/provider/v1/chat/completions`, default `deepseek/deepseek-v4.1-flash`) reading the local `~/.commandcode/auth.json`, or direct DeepSeek (`AI_PROVIDER=deepseek` + `DEEPSEEK_API_KEY`), or offline mock.
  - PDF: `pdfjs-dist` + `@napi-rs/canvas`; scanned pages OCR by DeepSeek Vision.
  - **No payments/subscriptions** (removed by request). Usage minutes are tracked for stats only.
- `fullstack/public/` — mobile-first SPA (login, onboarding, chat, exam prep, stats, settings) with streaming text, image attachment, speech synthesis.
- `web-mock/` — original bridge test harness (kept for the Android bridge contract).

## 7. Coverage matrix

Implemented in havsAI:
- Auth (email OTP), onboarding (role/name/age/subjects/voice/goal/exam date), profile, limits.
- Chat with SSE streaming, subjects, suggested prompts, image upload, TTS playback.
- Chat tools: web search, `read_material` (PDF text + DeepSeek Vision OCR), canvas.
- Exam prep: create/generate plan, lessons, challenges, mock exams, attempts/scoring,
  mastery, public share/join, official/school/curriculum/search/past catalog.
- Lab: AI-generated self-contained apps, sandboxed preview, private/public.
- Calendar: study/exam/review events, child calendar access for linked parents.
- Showcase/teachers: shared preps, public lab apps, teacher profiles.
- Parent/teacher personas: child linkage/progress, teacher school/class.
- Settings: theme, dyslexia, focus mode, study time, interests, notifications.
- TWA shell `com.havs.ai` loaded with the web app on the A23.

Next for closer parity:
- Google/Apple OAuth and password reset (needs provider credentials).
- i18n locale switching and translated UI.
- Real FCM push with `google-services.json`; full notification delegation.
- Pixel-level UI parity and brand assets (only if you own them).

## 8. Security notes

- Session cookies HttpOnly/SameSite=Lax; no tokens stored in localStorage.
- Upload allowlist (png/jpeg/webp/pdf), 8 MB cap, sanitized filenames.
- SQL uses prepared statements; JSON bodies size-capped.
- For production: add CSRF tokens for cookie-auth POSTs, rate limiting on OTP/chat, object-storage signed URLs, provider key vault, and Play/Stripe webhook verification.
