# Hướng dẫn cài đặt và sử dụng

[Về README](../README.md) · [Tích hợp](INTEGRATIONS.md) · [Kết quả](RESULTS.md)

## 1. Cài đặt

Yêu cầu: Docker Desktop đang chạy và Docker Compose v2; chạy npm trên máy cần Node.js 22 và dependency từ `npm ci`. Chạy lệnh tại thư mục gốc dự án, ví dụ `D:\AASC\ads_tiktok`. Tất cả giờ lịch trong tài liệu là Asia/Bangkok (UTC+7).

| Môi trường         | App                                  | PostgreSQL                               | Redis                      | Dữ liệu                                                    |
| ------------------ | ------------------------------------ | ---------------------------------------- | -------------------------- | ---------------------------------------------------------- |
| Compose phát triển | `127.0.0.1:3000`                     | `127.0.0.1:5432`, DB `leads`             | `127.0.0.1:6379`           | Volume giữ qua restart                                     |
| Compose kiểm thử   | App mở cổng ngẫu nhiên khi Jest chạy | `127.0.0.1:55432`, DB `integration_test` | `127.0.0.1:56379`          | PostgreSQL tmpfs; suite tạo lại schema và flush Redis test |
| Compose production | `127.0.0.1:3000`                     | Nội bộ Docker                            | Nội bộ Docker, có mật khẩu | Volume riêng theo Compose project                          |

Khởi tạo trên PowerShell khi chưa có `.env`:

```powershell
Copy-Item .env.example .env
```

Demo không gọi CRM thật: sửa `NODE_ENV=development`, `BITRIX24_MOCK=true`, `TIKTOK_EVENTS_MOCK=true`, `MOCK_LEADS_ENABLED=false`. `DB_USER=postgres`, `DB_NAME=leads`, `DB_PASSWORD` phải khớp database đã khởi tạo; Redis dev không dùng mật khẩu. Đổi `DB_PASSWORD` trong `.env` không đổi mật khẩu của PostgreSQL đã có volume.

Docker: sao chép `.env.example` thành `.env`, chọn chế độ CRM theo tài liệu tích hợp. Demo hoàn toàn dùng `BITRIX24_MOCK=true`, `TIKTOK_EVENTS_MOCK=true`. Không chép đè `.env` đã cấu hình.

```bash
docker compose up -d --build
docker compose logs --tail=100 app
```

Truy cập `http://localhost:3000/docs`; `/health` cần báo PostgreSQL và Redis `up`. Dữ liệu nằm trong volume PostgreSQL/Redis; `docker compose down` giữ volume, không dùng tùy chọn xóa volume nếu cần giữ dữ liệu.

```powershell
docker compose ps
(Invoke-RestMethod http://localhost:3000/health).status
```

Kết quả mong đợi: app/PostgreSQL/Redis healthy và `status=ok`. Compose tự chạy đủ sáu migration trước khi mở app; không cần seed để có rule/mapping mặc định.

Chạy trực tiếp: Node.js 22, PostgreSQL 16 và Redis 7; sửa DB/Redis host, port trong `.env` cho đúng.

```bash
npm ci
npm run migration:run
npm run start:dev
```

`npm run seed` là tùy chọn: ghi đè mapping, rules và chi phí mẫu trong database. Không chạy seed trên dữ liệu cấu hình cần giữ. Khi chưa có cấu hình trong DB, ứng dụng dùng mặc định trong `src/config/configuration.ts`.

Trên PowerShell nếu chặn `npm.ps1`, dùng `npm.cmd` hoặc `npx.cmd`.

## 2. Demo từ lead đến chuyển đổi

1. Bật hai biến mock như trên; mở Swagger và Authorize nếu có API key.
2. Gọi `POST /webhooks/tiktok/leads`, body `{}`, chữ ký trống. Swagger chuẩn bị payload và ký hộ; 202 nghĩa là đã tiếp nhận, chưa phải CRM đồng bộ xong.
3. Xem `GET /api/v1/leads` và `GET /api/v1/deals`. Rule mặc định chọn lead có liên hệ và điểm từ 70 (từ 85 ưu tiên cao); cấu hình DB có thể khác. Lead khác có thể chuyển bằng `POST /api/v1/leads/:id/convert-to-deal`.
4. Chọn một deal, lấy `bitrix24Id`. Trong nhóm Chạy thử, gọi `POST /mock/bitrix24/{entity}/{action}`, chọn `deal` và `update`:

```json
{ "id": 27, "fields": { "STAGE_ID": "WON", "PROBABILITY": 100, "OPPORTUNITY": 16200000 } }
```

Thay 27 bằng ID CRM vừa lấy. Mock tự gọi webhook cập nhật deal. Dùng `LOSE` để thử thất bại.

5. Xem `GET /mock/bitrix24/conversions`: chuyển đổi được xử lý theo chu kỳ khoảng 5 giây, trạng thái mock thành công là `mocked`; `sent` dành cho gửi API thật thành công.
6. Xem thống kê, tải báo cáo CSV/JSON/XLSX và kiểm tra số tiền/trạng thái.

Các thao tác CRM mock không khả dụng khi `BITRIX24_MOCK=false`. Xóa bản ghi CRM mock không xóa lead/deal nội bộ.

## 3. Tự sinh lead định kỳ

Mock chọn ngẫu nhiên chất lượng: 30% yếu (30 điểm), 30% cần chăm sóc (60 điểm), 25% đủ điều kiện (80 điểm), 15% ưu tiên cao (90 điểm). Đây là tỷ lệ demo, không phải tỷ lệ chuyển đổi thực tế của TikTok; từng đợt nhỏ có thể khác tỷ lệ này. Mọi mức đều có email hợp lệ và ngân sách; lead yếu thiếu điện thoại, các mức còn lại bổ sung điện thoại, thành phố và câu trả lời. Scoring thật tính điểm từ dữ liệu, không gán điểm trực tiếp: hiện cộng theo bước 10 nên không sinh điểm lẻ như 22/59. Rule mặc định xét tạo deal từ 70, ưu tiên cao từ 85; rule tùy chỉnh trong DB vẫn có hiệu lực.

| Nhóm           | Dữ liệu tạo ra                                 | Điểm ban đầu | Rule mặc định      |
| -------------- | ---------------------------------------------- | ------------ | ------------------ |
| Yếu (30%)      | Email + câu trả lời ngân sách                  | 30           | Chỉ lead           |
| Chăm sóc (30%) | Email + điện thoại + ngân sách                 | 60           | Chỉ lead           |
| Khá (25%)      | Email + điện thoại + thành phố + 2 câu trả lời | 80           | Deal normal        |
| Tốt (15%)      | Email + điện thoại + thành phố + 3 câu trả lời | 90           | Deal high priority |

Đây là điểm tính từ `scoreLead`, không có trường score giả gửi thẳng vào database. Điểm có thể đổi sau tương tác: `user.interact` cộng 5, `form.complete` cộng 10, tối đa 100. Hiện luồng tương tác chỉ ghi timeline/cộng điểm, chưa tự enqueue xét lại rule. Để chuyển lead sau tương tác, dùng API convert-to-deal hoặc một lần đồng bộ lead tiếp theo.

```dotenv
MOCK_LEADS_ENABLED=true
MOCK_LEADS_INTERVAL_MINUTES=1
MOCK_LEADS_MAX_TOTAL=50
```

Mỗi đợt tạo ngẫu nhiên 5–10 lead, đợt cuối giới hạn theo số còn lại. Dùng `0.5` để chạy mỗi 30 giây; mặc định là 15 phút, khoảng hợp lệ 0.5–1440 phút. Đợt đầu chờ một chu kỳ; đợt kế tiếp được lên lịch sau khi đợt trước kết thúc. Bộ đếm tính số webhook được nhận, không phải số deal thành công; đặt lại mỗi lần khởi động và tính riêng từng instance.

Đổi `.env` rồi chạy `docker compose up -d --no-deps app`. Sửa code cần thêm `--build`. Với CRM thật, phải bật thêm `MOCK_LEADS_ALLOW_REAL_CRM=true`; dữ liệu demo sẽ được tạo thật trong portal. Xem cấu hình bắt buộc ở tài liệu tích hợp.

Gửi một payload qua CLI: `npm run mock:tiktok`. CLI và server phải dùng cùng `TIKTOK_WEBHOOK_SECRET` khác `change-me`; secret tạm của bộ tự sinh không được chia sẻ ra CLI.

## 4. Xác thực và API quản trị

`ADMIN_API_KEY` bảo vệ `/api` và `/mock` qua header `X-API-Key`. Để trống chỉ phù hợp demo local. Có thể tạo phiên Redis:

1. `POST /api/v1/auth/sessions` bằng API key để lấy `accessToken`.
2. Dùng `Authorization: Bearer <accessToken>`.
3. `GET /api/v1/auth/sessions/current` xem hạn; `DELETE` cùng đường dẫn để đăng xuất.

`SESSION_TTL_SECONDS` mặc định 3600, giới hạn 60–86400. Đây là phiên quản trị chung, chưa có tài khoản/phân quyền từng người.

| Nhóm     | API chính                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| Lead     | `GET /api/v1/leads`, `GET /api/v1/leads/:id`, `POST /api/v1/leads/import`, `POST /api/v1/leads/:id/convert-to-deal` |
| Deal     | `GET /api/v1/deals?status=open&assigned_to=1`                                                                       |
| Sự kiện  | `GET /api/v1/webhook-events?status=failed`                                                                          |
| Cấu hình | `GET/PUT /api/v1/config/mappings`, `rules`, `costs`                                                                 |
| Thống kê | `GET /api/v1/analytics/conversion-rates`, `campaign-performance`, `stream`                                          |
| Báo cáo  | `GET /api/v1/reports/export`, `POST /api/v1/reports/deliveries`, `GET /api/v1/reports/deliveries/:id`               |

`id` trong API lead là UUID nội bộ; `bitrix24Id` là ID số CRM. Nhập dữ liệu nhận mảng tối đa 1000 sự kiện; phản hồi phân biệt `queued`, `duplicate`, `invalid`, `failed`, `pending_recovery`. Dữ liệu đã lưu nhưng chưa enqueue được sẽ có bộ phục hồi thử lại mỗi 10 giây.

Ví dụ PowerShell, lấy dữ liệu và xuất JSON (thay khóa; nếu không cấu hình API key thì bỏ `-Headers`):

```powershell
$apiHeaders = @{ 'X-API-Key' = '<ADMIN_API_KEY>' }
$leads = Invoke-RestMethod 'http://localhost:3000/api/v1/leads?page=1&limit=10&source=tiktok' -Headers $apiHeaders
$leads.total
$leads.items | Select-Object id, score, status, bitrix24Id
Invoke-WebRequest 'http://localhost:3000/api/v1/reports/export?format=json&date_range=30d' -Headers $apiHeaders -OutFile leads.json
```

`items` chỉ chứa một trang, `total` mới là tổng bản ghi khớp bộ lọc. `limit` mặc định 10, tối đa 100. `GET /leads` và `GET /deals` không tự lọc mode như API analytics; dùng báo cáo để so sánh số liệu theo mode CRM.

Nhập lịch sử: tạo file JSON chứa **mảng** payload như mẫu trong [ph?n t?ch h?p](#11-t?ch-h?p-tiktok-v?-bitrix24), rồi gửi:

```powershell
Invoke-RestMethod 'http://localhost:3000/api/v1/leads/import' -Method Post -Headers $apiHeaders -ContentType 'application/json' -InFile historical-leads.json
```

HTTP 202 chưa có nghĩa đã tạo CRM xong. Theo dõi webhook event và lead: `new` → `synced` → `converted` nếu khớp rule. Lead đã `synced` nhưng điểm thấp và không có deal là kết quả hợp lệ. Convert thủ công đặt `forceDeal=true`, vì vậy không dùng nó để chứng minh rule 70/85 tự động.

## 5. Thống kê và báo cáo

`date_range` hỗ trợ `7d`, `4w`, `1m` (mỗi tháng quy ước 30 ngày), từ 1 đến 9999 đơn vị. Khoảng lọc dựa trên thời điểm tạo lead. Chi phí campaign nhập qua `PUT /api/v1/config/costs` dạng `{"campaign_id":5000000}`; hệ thống chưa tự lấy chi phí từ TikTok.

Trong Swagger, mở `GET /api/v1/analytics/stream`, nhập khoảng và bấm **Bắt đầu**. SSE giữ kết nối mở nên trình duyệt có thể hiện đang tải; dùng **Dừng** để đóng. API gửi số liệu đầu tiên rồi chỉ phát khi dữ liệu đổi. Có thể kiểm tra bằng:

```bash
curl -N -H "X-API-Key: <API_KEY>" "http://localhost:3000/api/v1/analytics/stream?date_range=30d"
```

Xuất tệp: `GET /api/v1/reports/export?format=xlsx&date_range=7d`; đổi format thành `csv` hoặc `json`. Cả ba định dạng đọc PostgreSQL từng phần. XLSX ghi tệp tạm; CSV/JSON truyền trực tiếp theo tốc độ tải, không gom toàn bộ dữ liệu vào RAM. Ngắt tải sẽ hủy nguồn đọc và trả kết nối DB. Nếu kết nối hoặc truy vấn lỗi giữa chừng, tệp chưa hoàn chỉnh cần tải lại.

Đặt `REPORT_WEBHOOK_URL` để bật gửi Excel 7 ngày từ 08:00 Asia/Bangkok; bộ lập lịch kiểm tra mỗi 5 phút và bù trong ngày, không bù ngày trước. `REPORT_WEBHOOK_TOKEN` tùy chọn gửi qua Bearer. Bên nhận chấp nhận multipart gồm `file`, `report_id`, `date_range`, chống trùng bằng `Idempotency-Key`/`report_id`. Hàng đợi thử tối đa 5 lần; nội dung tệp được tạo lại khi thử lại. Để URL trống sẽ tắt gửi file.

## 6. Thông báo, lịch gửi và vận hành

Thông báo sử dụng `NOTIFY_WEBHOOK_URL`, lưu trước trong `notification_outbox` rồi gửi mỗi 5 giây. Bên nhận dùng `Idempotency-Key` hoặc `event_id` để bỏ qua gửi lặp. Lỗi HTTP được thử lại tối đa 5 lần và tôn trọng `Retry-After`; quá giới hạn giữ trạng thái `failed` để tra cứu. Để URL trống sẽ ghi `logged` cho demo, không đánh dấu gửi thành công. Sau khi xử lý nguyên nhân, có thể đặt lại bản ghi cần gửi bằng SQL quản trị:

```sql
UPDATE notification_outbox
SET status='pending', attempts=0, next_attempt_at=NOW(), lease_token=NULL, error=NULL
WHERE event_key='<event_key cần gửi lại>' AND status='failed';
```

Chi phí báo cáo nhập bằng VND cho đúng khoảng đang xem. Nếu deal won có ngoại tệ chưa quy đổi, API trả `revenue=null`, `roi=null`, `revenue_valid=false` thay vì cộng sai tiền.

Lịch báo cáo kiểm tra mỗi 5 phút sau 08:00, ID `daily-YYYY-MM-DD` chống tạo cùng job trong ngày. Cảnh báo lúc 08:00 dùng dữ liệu 7 ngày: chỉ phát khi có ít nhất 20 lead và tỷ lệ lead→deal nhỏ hơn `REPORT_ALERT_MIN_CONVERSION` (mặc định 0,05). Gửi file thủ công bằng `POST /api/v1/reports/deliveries`, lấy `jobId` để tra `GET /api/v1/reports/deliveries/:id`. Nếu chưa có `REPORT_WEBHOOK_URL`, yêu cầu gửi trả 503; xuất file tải trực tiếp vẫn hoạt động.

Queue lead/sync/report thử tối đa 5 lần, backoff exponential bắt đầu 2 giây. Worker đồng bộ có 3 luồng, giới hạn 3 job/giây (mỗi job có thể gọi nhiều REST method). HTTP 429 có `Retry-After` sẽ trì hoãn nhận job tiếp. Một log `socket hang up` ở lần 1 chưa chứng minh job thất bại cuối cùng; xem trạng thái BullMQ và số lần thử. Job hết lượt được giữ ở failed/dead-letter; thông báo lỗi dùng notification outbox.

Kiểm tra tải nhẹ chỉ đọc trên Docker đang chạy (mặc định 20 SSE và một request thống kê mỗi 2 giây, trong 60 giây):

```bash
docker compose exec -T app node scripts/load-smoke.cjs
```

Có thể truyền `-e SMOKE_SECONDS=300 -e SMOKE_STREAMS=30` vào `docker compose exec` để đổi thời gian/số kết nối. Đây là smoke test tải demo, không thay thế kiểm thử tải dài hạn.

## 7. Triển khai production

Compose production là file độc lập, không ghép với Compose dev. Dùng project riêng nếu chạy cùng máy với môi trường khác; cổng app 3000 vẫn phải trống. Biến đặt trong `.env.production` chỉ được truyền vào container nếu có khai báo trong `environment` của file Compose; generator hiện không được bật qua file production mặc định.

```bash
cp .env.production.example .env.production
docker compose -f docker-compose.prod.yml --env-file .env.production config -q
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Điền secret riêng trước khi chạy; không commit `.env` hay `.env.production`. Production kiểm tra API key, secret TikTok và cấu hình tích hợp thật theo mode; xem `src/config/production-guard.ts`. Đặt mật khẩu DB/Redis mạnh. Compose production chỉ mở app trên `127.0.0.1:3000`, không mở DB/Redis ra ngoài; đặt reverse proxy HTTPS phía trước và sao lưu dữ liệu.

Bitrix callback cần URL công khai HTTPS; localhost chỉ dùng thử nội bộ. Compose phát triển có profile tunnel tùy chọn: cấu hình `NGROK_AUTHTOKEN`, chạy `docker compose --profile tunnel up -d`, lấy URL tại cổng 4040 rồi cấu hình callback trên portal.

## 8. Kiểm thử và bàn giao

### Giới hạn hạ tầng và request

App và migration kiểm tra port (1–65535), host/user/database không được để trống khi đã khai báo. Production bắt buộc DB_PASSWORD và REDIS_PASSWORD ít nhất 16 ký tự; không dùng mật khẩu mặc định. Development vẫn giữ mặc định local.

Pool PostgreSQL mặc định 10 kết nối, thời gian chờ kết nối 5000 ms, đóng kết nối nhàn rỗi sau 30000 ms. Điều chỉnh bằng `DB_POOL_MAX` (1–100), `DB_CONNECTION_TIMEOUT_MS` và `DB_IDLE_TIMEOUT_MS` (1–300000). App thử khởi tạo kết nối tối đa 5 lần, cách nhau 3 giây.

Giới hạn theo IP và endpoint, mỗi 60 giây: API thường 120, webhook TikTok/Bitrix24 600, tạo phiên 10. Health check được miễn giới hạn. Rate limit chạy trước API-key guard nên lần đăng nhập sai cũng được tính. Bộ đếm hiện nằm trong mỗi tiến trình, chưa chia sẻ giữa nhiều instance. Log HTTP và đường dẫn phản hồi lỗi không giữ query string; không gửi secret trong URL.

```bash
npm run lint
npm run format:check
npm run typecheck
npm run test:types
npm run test:cov -- --runInBand --no-cache
npm run test:e2e -- --runInBand --no-cache
docker compose -p ads_tiktok_test -f docker-compose.test.yml up -d --wait
npm run test:integration -- --no-cache
docker compose -p ads_tiktok_test -f docker-compose.test.yml down
npm run build
npm run swagger:export
```

Integration dùng PostgreSQL `integration_test` tại 55432, Redis tại 56379; bài test tạo lại schema database đó. Không trỏ database kiểm thử sang dữ liệu cần giữ. Xuất Swagger cần DB/Redis theo cấu hình đang dùng.

Jest chạy `test/integration-setup.cjs` trước suite: kiểm tra đăng nhập PostgreSQL và Redis. Nếu thất bại ở đây, chưa chạy logic nghiệp vụ. `--no-cache` được dùng trong đợt nghiệm thu mới và tránh cache Jest cũ; không thay thế việc bật đúng Docker test. Có thể giữ stack test đang chạy để thử tiếp; lệnh `down` cuối phần trên là tùy chọn dọn môi trường sau khi xong.

Integration gồm test tạm tạo 20.000 lead trong **database kiểm thử** để xuất CSV/JSON, không tạo 20.000 bản ghi trên CRM thật. Các bài test giả lập HTTP 503/429, mất kết nối và lỗi DB có thể in log ERROR có chủ ý; kết luận dựa trên PASS/FAIL và exit code.

Bàn giao source, lockfile, cấu hình mẫu, Docker/CI, tests và docs. Không đóng gói `.env*` chứa secret, `node_modules`, `dist`, `coverage`, `*.tsbuildinfo`, bản ZIP cũ và tệp thử tạm. Giữ hai file `.env.example`, `.env.production.example`.

Báo cáo JSON/CSV/XLSX, SSE và báo cáo định kỳ chỉ lấy chế độ CRM đang chạy theo `BITRIX24_MOCK`, không cộng deal của mode còn lại. Lead đã có deal ở hai mode được tính một lần trong mỗi báo cáo riêng.

Jest dùng `tsconfig.test.json` với kiểu `node` và `jest`; build dùng `tsconfig.json` và loại file test. `npm test` chạy unit không cần Docker, tối đa hai worker; `npm run test:types` kiểm tra kiểu của cả source và test. Integration cần chạy Compose kiểm thử trước; mỗi lần chạy tạo lại schema và làm sạch Redis riêng trên cổng 55432/56379. Các log ERROR trong tình huống giả lập lỗi không đồng nghĩa test thất bại: xem tổng kết PASS/FAIL và exit code.

## 9. Lỗi thường gặp

### Cổng test bị chiếm hoặc container healthy nhưng không kết nối được

```powershell
docker ps --filter publish=55432 --format "{{.Names}} {{.Ports}}"
docker ps --filter publish=56379 --format "{{.Names}} {{.Ports}}"
docker compose ls
docker compose -p ads_tiktok_test -f docker-compose.test.yml ps
```

Xác định container/Compose project đang giữ cổng. Chỉ dừng stack test cũ sau khi xác nhận; không dừng stack `ads_tiktok` để giải phóng cổng test. Nếu Docker không có container nào giữ cổng, kiểm tra tiến trình khác bằng `Get-NetTCPConnection -LocalPort 55432,56379 -ErrorAction SilentlyContinue`.

Khi cổng đã trống, dựng lại container test bị lỗi networking:

```powershell
docker compose -p ads_tiktok_test -f docker-compose.test.yml up -d --force-recreate --wait
docker compose -p ads_tiktok_test -f docker-compose.test.yml ps
npm.cmd run test:integration -- --no-cache
```

Cột PORTS phải có `127.0.0.1:55432->5432/tcp` và `127.0.0.1:56379->6379/tcp`. Chỉ thấy `5432/tcp`/`6379/tcp` chưa đủ để Jest trên máy truy cập. Không tiếp tục chạy test nếu Compose vẫn báo bind port thất bại.

### Sai mật khẩu PostgreSQL kiểm thử

Nếu integration báo `password authentication failed for user "postgres"`, hạ tầng ở cổng 55432 không khớp mật khẩu kiểm thử `test`. Không đổi `.env` của app chính. Dựng lại đúng stack test bằng `docker compose -p ads_tiktok_test -f docker-compose.test.yml up -d --force-recreate --wait`, rồi chạy `npm run test:integration`. Compose test có tên riêng và PostgreSQL dùng tmpfs (dữ liệu kiểm thử không lưu qua lần dựng lại). Jest kiểm tra kết nối DB/Redis trước khi chạy suite; bước này không xóa dữ liệu.

| Hiện tượng                               | Kiểm tra                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| TikTok 401                               | Chữ ký, raw body, secret và timestamp; tự ký chỉ được hỗ trợ trong chế độ demo trên Swagger         |
| Bitrix callback 401                      | `auth.application_token` phải khớp `BITRIX24_APP_TOKEN`                                             |
| API quản trị 401                         | API key hoặc phiên Bearer còn hiệu lực                                                              |
| Webhook 202 nhưng chưa thấy lead         | Xem sự kiện failed, log worker và Redis; 202 không bảo đảm xử lý nghiệp vụ thành công               |
| Không tự sinh thêm mock                  | Bật generator, chờ đủ chu kỳ, kiểm tra giới hạn mỗi lần chạy và log lỗi                             |
| Lead/deal không có số tiền               | Kiểm tra rule amount, ngân sách demo và lần đồng bộ; bản ghi cũ không tự được cập nhật khi đổi code |
| Currency incorrect                       | Portal phải có VND; không đổi nhãn tiền tệ sang USD mà giữ nguyên số tiền VND                       |
| Có dữ liệu custom field nhưng không thấy | Thêm trường vào bố cục biểu mẫu lead trên Bitrix                                                    |
| SSE tải mãi                              | Kết nối được thiết kế mở liên tục; dùng khung Bắt đầu/Dừng trong Swagger                            |
| Mock ID trùng ID CRM thật                | Kiểm tra `bitrix_mode` và `ORIGIN_ID`, không xóa dữ liệu để né xung đột                             |

## 10. Khởi động lại và làm sạch dữ liệu

Giữ dữ liệu và cập nhật source: `docker compose up -d --build --no-deps app`. Đổi biến `.env` cần recreate bằng `up -d --no-deps app`; chỉ `restart` không áp dụng biến môi trường mới.

Chỉ khi chủ động muốn xóa sạch **dữ liệu local** của stack hiện tại:

```powershell
docker compose --profile tunnel down --volumes
docker compose up -d --build --wait
```

Lệnh này xóa lead/deal, cấu hình mapping/rules/costs, raw events, outbox, queue, cache và phiên local; sau đó migration tạo bảng mới và ứng dụng dùng rule mặc định. File `.env` và dữ liệu đã tạo trên Bitrix24 thật không bị xóa. Nếu generator vẫn bật, dữ liệu sẽ sinh lại sau một chu kỳ. Không dùng quy trình này để xử lý lỗi test hoặc sao lưu.

