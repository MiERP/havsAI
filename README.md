# havsAI — TWA app

havsAI gồm vỏ Android TWA, web app và backend thật; không có thanh toán.
Một mock PWA nhỏ (`web-mock/`) được giữ để test hợp đồng postMessage.

## Màu thương hiệu

- Cam chính `#ea580c`: nút, bubble người dùng, trạng thái active và nét vẽ canvas.
- Xanh `#00a10d`: "havs" trong logo, chỉ báo live/online.
- Màn hình chào mừng: nền trắng, wordmark "havs" xanh + "AI" cam.
- Admin có thể đổi toàn bộ palette dark/light tại `/admin` → Giao diện; server phục vụ qua `/theme.css`.

## Trang quản trị

- Mở trực tiếp `/admin` bằng trình duyệt (không nằm trong nav app).
- Tài khoản seed lần đầu: `admin` / `admin`; lần đăng nhập đầu bắt buộc đổi mật khẩu trước khi dùng các tab khác.
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` chỉ dùng để seed khi bảng `admin_accounts` còn trống.
- Quản lý: tài khoản (disable, soft-delete, restore, logout-all), chat/prep/upload/lab/calendar/attempt/parent link/event, palette màu dark/light, AI provider (chat/vision, test kết nối, default, API key mã hoá) và audit log.
- User bị disable hoặc xóa mềm bị chặn đăng nhập; xóa user là soft-delete, nội dung xóa cứng có xác nhận.
- Admin dùng cookie riêng, CSRF token, rate limit đăng nhập; API key không bao giờ trả về plaintext.
- API key AI được mã hoá bằng `SETTINGS_KEY` hoặc `fullstack/data/settings.key` (0600). Deploy script backup cả DB và key này.
- Chỉ quản lý màu sắc, không có layout builder/feature flags.

## Full-stack app (Đa thiết bị, Đa nền tảng: Web + PWA + Android TWA)

Bản full-stack nằm trong `fullstack/`:

- `server.js` — Node HTTP server, SQLite built-in (`node:sqlite`), auth OTP, onboarding,
  chat SSE, quản lý hội thoại (`PATCH/DELETE /api/chats/:id`), uploads, exam prep, dashboard. Không có thanh toán/gói trả phí.
- `public/` — Ứng dụng Web tự thích ứng (Responsive Desktop / Tablet / Mobile) kiêm PWA cài đặt độc lập trên Windows, macOS, Linux, iOS/iPadOS Safari và Android:
  - **Mobile (`< 768px`)**: Thanh điều hướng dưới cùng (`.bottom-nav`), ngăn kéo lịch sử chat trượt ngang (`.chat-sidebar`).
  - **Tablet (`>= 768px`) & Desktop (`>= 1024px`)**: Thanh điều hướng dọc bên trái (`.side-nav`), cột lịch sử chat cố định (tạo mới, tìm kiếm, đổi tên, xóa đoạn chat), bố cục 2 cột cho Ôn thi / Tiến độ / Lịch / Lab, hỗ trợ kéo-thả tệp (`drag-and-drop`), dán ảnh từ clipboard (`Ctrl+V`), và phím tắt (`Ctrl/Cmd+K` tạo chat mới, `/` đặt con trỏ vào ô nhập).
  - **Cầu nối đa nền tảng (`window.havsPlatform`)**: Tự động nhận diện `Android TWA` (qua `MessagePort` hai chiều `havs-native-ready`, `havs-set-theme`, `havs-identify`, `havs-track-event`, `havs-request-push-permission`), `Installed PWA` (`display-mode: standalone`), hoặc `Web Browser`, đồng thời đồng bộ tức thời giữa nhiều tab/thiết bị qua SSE (`/api/realtime`).
  - **PWA & Offline Shell**: `manifest.webmanifest` (`orientation: "any"`, `icon.svg`, `icon-maskable.svg`, shortcuts) + Service Worker `/sw.js` cache gói giao diện tĩnh.
- AI: mặc định **Command Code + DeepSeek** (`deepseek/deepseek-v4.1-flash`), đọc key từ
  `~/.commandcode/auth.json`. Có thể override bằng `COMMANDCODE_API_KEY`,
  `COMMANDCODE_MODEL`, `COMMANDCODE_BASE_URL`; hoặc dùng trực tiếp DeepSeek với
  `AI_PROVIDER=deepseek` + `DEEPSEEK_API_KEY`. `AI_PROVIDER=mock` để chạy offline.
- Chạy: `node fullstack/server.js` → `http://localhost:3000`.
- Đặc tả đầy đủ: `docs/havs-full-spec.md` và `docs/SPEC-multiplatform-web.md`.

## Vị trí cấu hình API DeepSeek

Code nằm ở `fullstack/server.js`:

- dòng 18–34: loader đọc `fullstack/.env` trước khi cấu hình provider.
- dòng 49–53: khối `DEEPSEEK` gồm `apiKey`, `baseUrl`, `model`.
- dòng 54: chọn provider (`commandcode` mặc định, `deepseek`, hoặc `mock`).

Cách khuyến nghị (không sửa code):

```powershell
Copy-Item fullstack\.env.example fullstack\.env
notepad fullstack\.env
```

Điền key DeepSeek của bạn:

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

Rồi khởi động lại `node fullstack/server.js`. Kiểm tra:

```powershell
curl http://localhost:3000/api/health
# {"ok":true,"provider":"deepseek"}
```

- Biến môi trường thật luôn thắng giá trị trong `.env`.
- Không tạo `.env`: mặc định dùng **Command Code** đọc `~/.commandcode/auth.json`
  với model `deepseek/deepseek-v4.1-flash`.
- Không hardcode key vào `server.js`; `.env` đã nằm trong `.gitignore`.

## Vision và PDF

- **Pipeline tuần tự:** `ảnh/PDF scan → vision_analyze (DeepSeek OCR) → tutor DeepSeek`.
  Không chạy hai model song song cho cùng một câu trả lời; chỉ song song khi OCR nhiều
  trang độc lập.
- **Chỉ dùng DeepSeek:** model `deepseek/deepseek-v4-flash-vision-exp`, fallback cùng
  model. Bắt buộc `VISION_REASONING_EFFORT=off`; nếu không model trả `content` rỗng và
  chỉ có reasoning.
- **Upload:** client resize ảnh về cạnh dài 1568px, JPEG quality 0.82 trước khi gửi;
  chat gửi `uploadId` thay vì nhồi ảnh vào mỗi tin nhắn. PDF được PDF.js kiểm tra số
  trang và mật khẩu; tối đa 50 trang (`PDF_MAX_PAGES`).
- **read_material (PDF):** `pdfjs-dist` trích text theo trang. Nếu text ít hơn
  `max(40, 20 × số trang)` (PDF scan), server render tối đa 3 trang
  (`PDF_VISION_PAGES`) bằng `@napi-rs/canvas` ở scale 2 rồi OCR bằng DeepSeek Vision
  (2 trang song song, `PDF_VISION_CONCURRENCY`). Kết quả được cache theo upload và trả
  kèm số trang để trích dẫn.
- **Ảnh:** `vision_analyze` gọi DeepSeek Vision một lần, cache text theo upload.
- Override: `VISION_MODEL`, `VISION_FALLBACK_MODEL`, `VISION_REASONING_EFFORT`,
  `VISION_BASE_URL`, `VISION_API_KEY`, `PDF_MAX_PAGES`, `PDF_VISION_PAGES`,
  `PDF_VISION_CONCURRENCY`.
- Cài dependency: `cd fullstack && npm install` (cần Node 22.5+).
- Lưu ý: DeepSeek Vision là bản experimental; nếu trả rỗng, kiểm tra
  `reasoning_effort=off` và tăng `max_tokens`.

## Đọc thành tiếng (TTS)

- `fullstack/public/speech.js` chuyển câu trả lời thành lời nói tiếng Việt trước khi gửi TTS:
  phân số (`1/2` → "1 phần 2", `$\frac{1}{2}$` → "một phần hai"), lũy thừa, căn, đơn vị
  (`m/s`, `m/s²`, `kg/m³`, `mol/L`), ký hiệu (`%`, `°C`, `×`, `÷`, `≈`, `≤`, `√`, `π`),
  phương trình hóa học (`\to` → "tạo thành", `\rightleftharpoons` → "thuận nghịch",
  `H_2O` → "H hai O", trạng thái rắn/khí/lỏng/dung dịch) và ký hiệu sinh học
  (`5'`, cặp bazơ `A-T` → "A liên kết T"). Bỏ qua quy tắc tiếng Việt khi `subject = english`.
- **Ngắt nghỉ**: `splitForSpeech()` chia câu trả lời tại dấu câu và gán khoảng lặng —
  hết câu `.` `!` `?` `…` 420 ms, dấu hai chấm 340 ms, chấm phẩy 280 ms, phẩy 200 ms,
  cắt do dài câu 180 ms. Không cắt sai trong số thập phân (`3,14`, `1.5`) hay giờ (`10:30`),
  cắt dài câu ở ranh giới từ (tối đa ~165 ký tự/lần) và gộp các mảnh vụn.
  Client phát tuần tự từng câu bằng hai thẻ audio luân phiên, tải trước câu kế tiếp nên
  khoảng lặng đúng như cấu hình thay vì bị độ trễ mạng chen vào.
- `app.js` chỉ có **một chủ sở hữu phiên đọc** (`speechEpoch`): mỗi lần đọc hủy cả audio MP3
  và Web Speech, callback của lần đọc cũ bị bỏ qua nên không còn hai giọng chồng nhau.
  Danh sách giọng được làm mới qua `voiceschanged` và chọn theo ngôn ngữ + giới tính.
  Nếu một câu MP3 lỗi, các câu còn lại được đọc bằng giọng thiết bị (không đọc lại phần đã đọc).
- Prompt hệ thống (`server.js`, `FORMULA_RULES`) yêu cầu model xuất mọi công thức bằng LaTeX
  trong `$...$` cho Toán, Lý, Hóa, Sinh để KaTeX render và bộ chuyển đổi đọc đúng.
- `/api/tts` hiện vẫn dùng Google Translate TTS (`tl=vi`) và **bỏ qua** tham số `voice`;
  bốn giọng trong `/api/voices` chỉ khác nhau ở tốc độ phát trên client.

## Ôn thi từ tài liệu

- Tài liệu tải ở wizard hoặc nút “Gắn tài liệu” trong trang kỳ ôn; lưu ở bảng `uploads`
  (dùng chung với chat, mỗi bản ghi thuộc một `user_id`). Trang kỳ ôn hiển thị tài liệu đã gắn.
- `POST /api/preps/:id/generate` và `/api/exam-preps/:id/generate` gửi tối đa 14.000 ký tự
  tài liệu cho model, yêu cầu schema v2: `topics`, 5 ngày, mỗi ngày có bài học tự học
  (`intro`, `sections` có LaTeX, `example` có lời giải, 2 câu `practice`).
- Bài học hiển thị tại `/exam-preps/:id/lessons/:lessonId`; “Đánh dấu đã học” lưu trong
  `preps.lessons_json` và được giữ nguyên khi tạo lại nội dung.
- Nếu model lỗi/timeout/trả JSON hỏng, kế hoạch rơi về mẫu chung, `plan.generatedBy = "fallback"`,
  trang ghi rõ lỗi kèm nút “Tạo lại bằng AI”.
- Giới hạn tải lên: `MAX_UPLOAD_MB` (mặc định 20MB, khớp `UPLOAD_MAX_MB` phía client);
  PDF vẫn giới hạn `PDF_MAX_PAGES` trang.

## Luồng đã triển khai

- **Chat tools**
  - `web_search`: DuckDuckGo HTML + Wikipedia fallback; kết quả được chèn vào ngữ cảnh và hiển thị chip `🔎` trong chat.
  - `read_material`: đọc file text/markdown, PDF.js trích text PDF, và OCR trang scan
    bằng DeepSeek Vision; hiển thị chip `📄` kèm số trang / `OCR`.
  - **Canvas**: vẽ tay trên điện thoại, gửi ảnh vào chat qua upload.
- **Exam prep nâng cao**: tạo đề → AI sinh kế hoạch 5 ngày → bài học theo ngày,
  thử thách, đề thi thử, chấm điểm, mastery, chia sẻ link và tham gia đề của người khác.
- **Exam prep catalog**: đề chính thức, đề trường, giáo trình, tìm kiếm, lịch sử làm bài.
- **Lab**: tạo app học tập bằng AI (HTML tự chứa), chạy trong iframe sandbox, đổi private/public.
- **Calendar**: thêm/xóa sự kiện học, thi, ôn tập; tự thêm ngày thi khi tạo đề.
- **Showcase/teachers**: đề chia sẻ, app công khai, hồ sơ giáo viên và đề của giáo viên.
- **Settings**: tên, giọng nói, theme sáng/tối, dyslexia, focus mode, giờ học, sở thích,
  trường/lớp cho giáo viên.
- **Realtime**: SSE `/api/realtime` (connected/ping, chat.message, prep.updated, parent.updated) — app có chỉ báo `● live`.
- **Parent/teacher**:
  - Onboarding theo vai trò: phụ huynh nhập email con; giáo viên nhập trường/lớp.
  - Phụ huynh liên kết tài khoản con (kể cả chờ đăng ký), xem chat/đề/phút sử dụng của con.
  - Dashboard giáo viên hiển thị trường/lớp; hồ sơ giáo viên xuất hiện trong showcase.

## Route web

```text
/                         chat
/login                    email OTP
/onboarding               onboarding theo vai trò
/dashboard                tiến độ
/dashboard/children/:id   tiến độ con (phụ huynh)
/child/:id                chi tiết con
/exam-preps               danh sách đề
/exam-preps/official      đề chính thức
/exam-preps/school        đề trường
/exam-preps/curriculum    giáo trình
/exam-preps/search        tìm kiếm
/exam-preps/past          lịch sử làm bài
/exam-preps/:id           chi tiết đề
/exam-preps/:id/lessons/:lessonId
/exam-preps/:id/challenges
/exam-preps/:id/challenges/:challengeId
/exam-preps/:id/mock-exams/:mockId
/exam-preps/:id/attempts/:attemptId
/share/a/:shareId         đề chia sẻ công khai
/join/:shareId            tham gia đề
/lab, /lab/:slug          AI app lab
/calendar, /calendar/:userId
/showcase, /showcase/teachers, /teachers/:id
/settings
/pay                      thông báo thanh toán đã tắt
```

## Thành phần

- `app/` — Android app (Kotlin): TWA launcher, postMessage bridge, push, deep link,
  review, identify, dev tools, analytics.
- `web-mock/` — PWA giả lập (Node thuần, không dependency).
- `api-mock/` — API giả lập cho event/chat.
- `bridge-contract/` — JSON Schema của message bridge.
- `docs/protocol.md` — đặc tả giao thức native ↔ web.

## Yêu cầu

- JDK 17
- Android SDK: platform 35, build-tools 35.0.0
- Gradle 8.11.x (hoặc dùng wrapper nếu đã sinh)
- Node.js 22.5+ (dùng `node:sqlite`)

## Build

```bash
./gradlew :app:assembleDebug      # Linux/macOS
gradlew.bat :app:assembleDebug    # Windows
```

APK: `app/build/outputs/apk/debug/app-debug.apk`.

## Chạy full-stack

```bash
node fullstack/server.js     # http://localhost:3000
adb reverse tcp:3000 tcp:3000
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.havs.ai/.twa.LauncherActivity
```

Tùy chọn: `web-mock/` (cổng 5173) và `api-mock/` (8787) vẫn dùng để test riêng
hợp đồng postMessage.

Native log: `adb logcat -s HavsTWA HavsBridge HavsFCM`.

## Test

```bash
./gradlew :app:testDebugUnitTest
./gradlew :app:connectedDebugAndroidTest
adb shell pm verify-app-links --re-verify com.havs.ai
```

Deep link thủ công:

```bash
adb shell am start -a android.intent.action.VIEW -d "havs-identify://set?userId=demo"
adb shell am start -a android.intent.action.VIEW -d "havs-push://permission"
adb shell am start -a android.intent.action.VIEW -d "app-review://launch"
```

Push-open là activity nội bộ (`exported="false"`), không nhận intent từ app khác;
kiểm thử bằng `:app:connectedDebugAndroidTest`.

## TWA / asset links

TWA chỉ chạy full-screen khi URL là HTTPS và `/.well-known/assetlinks.json` của
origin chứa đúng package + SHA-256 của chứng chỉ ký. Server tự sinh file này từ
biến môi trường (xem `fullstack/.env.example`):

```ini
ANDROID_SHA256_FINGERPRINTS=AA:BB:CC:...
ANDROID_PACKAGE_NAME=com.havs.ai
```

Lấy fingerprint bằng:

```bash
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey \
  -storepass android -keypass android
```

Không cấu hình fingerprint thì route trả 503 thay vì phát hành file rỗng/sai.
`web-mock/.well-known/assetlinks.json` chỉ chứa fingerprint debug để thử local;
không dùng file đó cho bản phát hành.
Host App Links lấy từ `manifestPlaceholders["appLinkHost"]` trong
`app/build.gradle.kts`, dùng chung giá trị với `DEFAULT_WEB_URL`. Với dev qua
`http://localhost`, app tự fallback sang Custom Tabs (có thanh địa chỉ) nhưng
bridge postMessage vẫn hoạt động nếu Chrome chấp nhận origin.

## OTP email

- **Dev/local:** OTP được in ra console khi request tới `localhost`/`127.0.0.1`.
  Đặt `ALLOW_DEV_OTP=true` để dùng mã cố định `123456`; cờ này bị bỏ qua khi
  `NODE_ENV=production`.
- **Production:** cấu hình `RESEND_API_KEY` + `OTP_FROM_EMAIL` (Resend HTTP API,
  không cần thêm dependency) hoặc `SMTP_URL` + `OTP_FROM_EMAIL` (cần
  `cd fullstack && npm install nodemailer`). Thiếu mailer thì
  `/api/auth/request-code` trả 503 `email_not_configured` và OTP không bị ghi log,
  kể cả khi quên đặt `NODE_ENV=production` nhưng host không phải localhost.

## Kiểm thử tự động

```bash
cd fullstack
npm test
```

Bộ test dùng `node:test` và DB tạm qua `HAVS_DATA_DIR`, bao phủ: OTP/cookie,
quyền tải upload, PDF lỗi và giới hạn trang, tạo đề từ upload, production không
log OTP khi thiếu mailer, `assetlinks.json`, admin login/CSRF/theme/AI provider,
soft-delete user, hard-delete nội dung, audit, cùng các bất biến frontend
(KaTeX self-host + `trust: false`, iframe Lab `sandbox="allow-scripts"`, host App
Links/PWA).

## Deploy VPS

Một lệnh trên VPS: tự backup SQLite, pull `main`, `npm ci --omit=dev`, chạy
test, restart systemd/pm2 và health-check.

```bash
sudo bash /opt/havs-ai/deploy/deploy.sh
```

Từ máy local:

```bash
ssh root@103.20.102.229 'bash /opt/havs-ai/deploy/deploy.sh'
```

Nếu VPS chưa có `.git` (lỗi `fatal: not a git repository`), copy script lên VPS
một lần rồi để nó tự bootstrap repo (repo private, dùng SSH key có sẵn trên VPS):

```bash
scp deploy/deploy.sh root@103.20.102.229:/tmp/havs-deploy.sh
ssh root@103.20.102.229 \
  'APP_DIR=/opt/havs-ai SERVICE=havs-ai bash /tmp/havs-deploy.sh'
```

Nếu đường dẫn/service khác mặc định:

```bash
sudo APP_DIR=/opt/havs-ai RUN_USER=havsai SERVICE=havsai PORT=3000 \
  bash deploy/deploy.sh
```

Script backup DB và `fullstack/data/settings.key` (nếu có), không sửa
`fullstack/.env` hay nội dung data. Chi tiết biến, backup và khôi phục DB:
`deploy/README.md`.

## Giới hạn có chủ đích

- Không tái tạo PairIP, Facebook SDK, Singular SDK.
- FCM cần `google-services.json` của project Firebase của bạn; bản mặc định
  không kèm file này nên không nhận push thật. `PushOpenActivity` là activity nội
  bộ và được kiểm thử bằng `PushOpenActivityTest` + `PushRoutePolicyTest`.
- Thanh toán đã bị bỏ: không có Play Billing/Stripe, không có gói Plus; route `/pay` chỉ báo đã tắt.
- Google/Apple OAuth chưa bật vì cần client ID/secret và redirect URI của bạn; hiện dùng email OTP.
- DelegationService là stub; notification delegation đầy đủ cần implement
  `TrustedWebActivityService`.
- Không có pcap/sniffing (bản gốc cũng không có).

## Kết quả kiểm thử trên Galaxy A23 (SM-A235F, Android 14)

- `assembleDebug` + cài đặt: OK.
- Unit test JVM: 5/5 pass.
- `connectedDebugAndroidTest`: 5/5 pass.
- TWA mở full-screen, `relationship validation=true`; postMessage channel ready đúng 1 lần.
- Bridge: `havs-device-info`, `havs-push-state`, `havs-set-theme`, `havs-track-event`, `havs-identify` đều nhận và phản hồi.
- Chat dùng **DeepSeek qua Command Code**: trả lời streaming thật, lưu SQLite, mở lại hội thoại gần nhất sau reload.
- Thanh toán đã bỏ hoàn toàn: không còn nút/màn hình nâng cấp, endpoint subscription trả 404, `NativeBillingActivity` không tồn tại.
- Viewport mobile đã cố định (không còn auto-zoom 1.11x khi focus input).
- `POST_NOTIFICATIONS`: hiển thị dialog hệ thống, cấp quyền thành công, trạng thái gửi về web.
- Push route: `PushOpenActivity` chỉ chuyển route cùng origin (hoặc đường dẫn
  tương đối) cho web; URL ngoài origin bị bỏ qua và không thể đổi `web_url`.
- Lưu ý: app gốc `co.havs_ai.app.twa` vẫn cài trên máy và đăng ký trùng scheme
  (`havs-identify`, `havs-push`, `app-review`, `https://app.havs.ai`).
  Android ưu tiên app gốc, nên khi test phải dùng explicit component, ví dụ:

```bash
adb shell am start -n com.havs.ai/.deeplink.IdentifyActivity \
  -a android.intent.action.VIEW -d "havs-identify://set?userId=demo"
```

Khi phát hành thật, dùng domain/package riêng hoặc gỡ app gốc để tránh xung đột.

## Kiểm thử các luồng mới trên A23

- **web_search**: 2 sự kiện tool (started/done), 5 kết quả DuckDuckGo, câu trả lời trích nguồn Wikipedia.
- **exam prep generation**: tạo đề + sinh kế hoạch 5 ngày, 3 câu luyện tập bằng DeepSeek; lưu `plan_json` và hiển thị trong tab Ôn thi.
- **realtime**: `/api/realtime` trả `connected`; UI hiển thị `● live` và tự cập nhật khi có `chat.message` / `prep.updated`.
- **parent**: tài khoản phụ huynh liên kết tài khoản demo; dashboard hiển thị chat/đề/phút sử dụng của con.
- **teacher**: `teacher@havs.local` hiển thị đúng trường/lớp.
- **canvas**: overlay 1080×2047, gửi bản vẽ thành ảnh qua upload.
- **PDF/OCR**: upload `test.pdf` trả `pageCount=1`; PDF text dùng `read_material` với
  `scanned=false` (58 ký tự). Ảnh `prep.png` được resize thành `prep.jpg` trên client,
  DeepSeek Vision OCR 1263 ký tự, chip `👁`. PDF scan 3 trang ảnh được render và OCR
  song song 2 trang/lần: `scanned=true`, `visionPages=[1,2,3]`, 719 ký tự.
- **Route mới**: đã render và thao tác thật trên A23 cho `/exam-preps`,
  `/exam-preps/:id`, lessons, challenges, mock exams, `/lab`, `/calendar`,
  `/showcase`, `/showcase/teachers`, `/teachers`, `/settings`, `/dashboard`,
  `/share/a/:id`, `/child`, `/pay`.
- **Exam prep**: tạo đề + generate, hoàn thành lesson, nộp challenge 1/1, nộp mock 5/5,
  chia sẻ link và mở public share.
- **Calendar/settings**: thêm sự kiện, lưu theme sáng/tối + dyslexia/focus mode + giờ học/sở thích.
- **Parent/teacher**: liên kết phụ huynh → xem tiến độ con; giáo viên `THPT Havs · 10A1`
  xuất hiện trong `/api/teachers` và showcase.

Giới hạn của các luồng này:

- **read_material**: đọc text/markdown và PDF text tốt; PDF scan chỉ OCR tối đa
  `PDF_VISION_PAGES` trang (mặc định 3), các trang sau chưa OCR.
- Realtime lưu trong bộ nhớ tiến trình, chưa hỗ trợ nhiều instance server.
- Teacher mới có hồ sơ trường/lớp, chưa có danh sách học sinh/điểm danh.
- Web search phụ thuộc DuckDuckGo/Wikipedia, có thể bị chặn tạm thời.

