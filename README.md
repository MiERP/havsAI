# havsAI — TWA app

havsAI gồm vỏ Android TWA, web app và backend thật; không có thanh toán.
Một mock PWA nhỏ (`web-mock/`) được giữ để test hợp đồng postMessage.

## Màu thương hiệu

- Xanh chính `#00a10d`: nền splash, status/navigation bar, nút chính, bubble người dùng.
- Vàng nhấn `#d6a400`: logo, badge, trạng thái active, CTA phụ và nét vẽ canvas.

## Full-stack app (web + backend)

Bản full-stack nằm trong `fullstack/`:

- `server.js` — Node HTTP server, SQLite built-in (`node:sqlite`), auth OTP, onboarding,
  chat SSE, uploads, exam prep, dashboard. Không có thanh toán/gói trả phí.
- `public/` — SPA mobile-first (login, onboarding, chat, ôn thi, tiến độ, cài đặt).
- AI: mặc định **Command Code + DeepSeek** (`deepseek/deepseek-v4.1-flash`), đọc key từ
  `~/.commandcode/auth.json`. Có thể override bằng `COMMANDCODE_API_KEY`,
  `COMMANDCODE_MODEL`, `COMMANDCODE_BASE_URL`; hoặc dùng trực tiếp DeepSeek với
  `AI_PROVIDER=deepseek` + `DEEPSEEK_API_KEY`. `AI_PROVIDER=mock` để chạy offline.
- Chạy: `node fullstack/server.js` → `http://localhost:3000`.
- Đặc tả đầy đủ: `docs/havs-full-spec.md`.

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
log OTP khi thiếu mailer, `assetlinks.json`, cùng các bất biến frontend
(KaTeX self-host + `trust: false`, iframe Lab `sandbox="allow-scripts"`, host App
Links/PWA).

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

