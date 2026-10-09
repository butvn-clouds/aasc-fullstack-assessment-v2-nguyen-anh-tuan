# Bitrix24 ⇄ Google Sheets Lead Sync

Kết quả nghiệm thu hai chiều, chống trùng, xung đột và webhook:
[LIVE-ACCEPTANCE.md](docs/LIVE-ACCEPTANCE.md).

### Quy tắc chống trùng

Trước khi tạo Lead, tra cứu email hoặc số điện thoại; tìm thấy thì cập nhật Lead
hiện có. Nếu hai thông tin trỏ tới các Lead khác nhau, báo lỗi để đối chiếu.
Nhiều dòng Sheet được phép liên kết cùng Lead ID. Các dòng cần ghi được xử lý theo
thứ tự số dòng tăng dần; dòng ghi sau ưu tiên trên trường cùng được gửi. Ô optional
trống không xóa giá trị CRM. Các cập nhật cùng Lead không chạy trong cùng batch.
Dòng không thay đổi hash vẫn được bỏ qua, không tự ghi đè thay đổi từ dòng khác.
Chiều ngược cập nhật các trường trong `reverseColumns` về từng dòng cùng liên kết,
áp dụng chính sách xung đột riêng từng dòng. Số cập nhật ngược tính theo dòng Sheet,
còn số Lead kiểm tra tính theo ID duy nhất.

Yêu cầu **Classic CRM có Leads**. Hướng dẫn kiểm tra chế độ CRM, phục hồi khi tạo Lead
bị gián đoạn và chạy bộ kiểm tra: [Vận hành Lead](docs/LEAD-OPERATIONS.md).

Tự động hóa việc đồng bộ dữ liệu leads từ Google Sheets sang Bitrix24 CRM, thay thế cho quy trình
nhập liệu thủ công hiện tại. Xây dựng bằng **NestJS + TypeScript**.

> Có đồng bộ thuận/ngược, webhook và Admin. Cron mặc định chiều thuận; chọn hướng bằng `SYNC_DIRECTION=forward|reverse|both`.
> Sau dọn dẹp, dùng API dưới /api/v1/sync; /sync/trigger và /sync/status đã được bỏ.

## Mục lục

- [Kiến trúc tổng quan](#kiến-trúc-tổng-quan)
- [Tính năng đã triển khai (MVP)](#tính-năng-đã-triển-khai-mvp)
- [Yêu cầu hệ thống](#yêu-cầu-hệ-thống)
- [1. Thiết lập Google API credentials](#1-thiết-lập-google-api-credentials)
- [2. Thiết lập Bitrix24 webhook](#2-thiết-lập-bitrix24-webhook)
- [3. Chuẩn bị Google Sheet](#3-chuẩn-bị-google-sheet)
- [4. Cấu hình mapping rules](#4-cấu-hình-mapping-rules)
- [5. Cài đặt & chạy](#5-cài-đặt--chạy)
- [6. Kích hoạt đồng bộ thủ công](#6-kích-hoạt-đồng-bộ-thủ-công)
- [7. Deploy bằng Docker](#7-deploy-bằng-docker)
- [8. Test & coverage](#8-test--coverage)
- [9. Troubleshooting](#9-troubleshooting)
- [10. Monitor & maintain](#10-monitor--maintain)
- [API usage](docs/API-USAGE.md)
- [Test plan](docs/TEST-PLAN.md)
- [Tính năng nâng cao & mức độ hoàn thiện](#tính-năng-nâng-cao--mức-độ-hoàn-thiện)
- [Kịch bản kiểm thử (Test Cases)](#kịch-bản-kiểm-thử-test-cases)

---

## Kiến trúc tổng quan

Sheet → SyncService → Bitrix24; Bitrix24 → TwoWaySyncService → Sheet.
HTTP, CLI và cron dùng chung service; webhook dùng cùng chiều reverse.

Chi tiết thiết kế từng module, luồng xử lý, và các quyết định kỹ thuật được mô tả trong
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Tính năng đã triển khai (MVP)

- ✅ Đọc dữ liệu từ Google Sheets (Google Sheets API v4), mapping linh hoạt qua `config/mapping.json`
  (bao gồm custom fields dạng `UF_CRM_*`).
- ✅ Tạo/cập nhật lead trong Bitrix24 (`crm.lead.add`, `crm.lead.update`), ghi lại Lead ID vào Sheet.
- Tra trùng liên hệ qua crm.duplicate.findbycomm trước khi tạo lead.
- ✅ Idempotency: tính sync-hash cho mỗi hàng, bỏ qua (skip) nếu dữ liệu không đổi kể từ lần đồng bộ trước.
- ✅ Cột trạng thái trên Sheet: Lead ID, Trạng thái đồng bộ, Thời gian đồng bộ cuối, Thông báo lỗi.
- Log console và lịch sử 100 lần chạy gần nhất, lưu bền vững trong `data/sync-history.json`.
- ✅ Chạy theo lịch (cron, cấu hình được) + trigger thủ công qua CLI hoặc HTTP endpoint.
- Google có giới hạn tốc độ; API đọc có retry. Batch ghi CRM chỉ retry lệnh con bị từ chối do quota; không replay sau timeout.
- ✅ Batch method của Bitrix24 (`batch`) để tối ưu số lượng round-trip khi cần.
- ✅ Chuẩn hóa dữ liệu: email (lowercase/trim), số điện thoại (loại bỏ ký tự thừa), ngân sách
  (chấp nhận "10tr", "10,000,000", "10.000.000 VND"...).
- ✅ Cấu hình 100% qua biến môi trường + file mapping, không hard-code secrets.

## Yêu cầu hệ thống

- Node.js ≥ 18 (khuyến nghị 20)
- Một Google Sheet chứa dữ liệu leads (xem mẫu tại `sample-data/sample-leads-template.csv`)
- Một portal Bitrix24 có quyền dùng REST API, CRM Leads và Inbound Webhook; kiểm tra quyền/gói thực tế trước khi triển khai.

## 1. Thiết lập Google API credentials

Khuyến nghị dùng **Service Account** (không cần OAuth consent screen, phù hợp cho server/cron chạy nền).

1. Vào [Google Cloud Console](https://console.cloud.google.com/) → tạo project mới (hoặc dùng project có sẵn).
2. Bật **Google Sheets API**: APIs & Services → Library → tìm "Google Sheets API" → Enable.
3. Tạo Service Account: APIs & Services → Credentials → Create Credentials → Service Account.
4. Vào tab **Keys** của Service Account vừa tạo → Add Key → Create new key → JSON. File JSON sẽ được tải về.
5. Mở Google Sheet cần đồng bộ → nút **Share** → share cho email của Service Account
   (dạng `xxx@xxx.iam.gserviceaccount.com`) với quyền **Editor** (cần quyền ghi để cập nhật Lead ID/trạng thái).
6. Lưu file JSON vào `./credentials/google-service-account.json` (thư mục `credentials/` đã có trong `.gitignore`,
   **không commit file này**), rồi trỏ `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` tới đường dẫn đó trong `.env`.
   - Nếu deploy lên môi trường không có filesystem bền vững (một số PaaS), có thể dán toàn bộ nội dung JSON
     vào biến `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` thay vì dùng file.

> Muốn dùng OAuth2 (user-level) thay vì Service Account? Đặt `GOOGLE_AUTH_MODE=oauth2` và điền
> `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` trong `.env`.

## 2. Thiết lập Bitrix24 webhook

Cách đơn giản nhất, khuyến nghị cho hệ thống chạy nền:

1. Đăng nhập Bitrix24 (vai trò Admin) → **Applications** → **Developer resources** →
   **Other** → **Inbound webhook**.
2. Chọn quyền (scope) tối thiểu cần thiết: `crm` (để dùng các method `crm.lead.*`).
3. Bitrix24 sẽ sinh ra một URL dạng:
   `https://yourcompany.bitrix24.vn/rest/1/xxxxxxxxxxxxxxxx/`
4. Dán URL này vào `BITRIX24_WEBHOOK_URL` trong file `.env`.

Bitrix24 hiện dùng Inbound webhook; OAuth Bitrix24 chưa được hỗ trợ.

## 3. Chuẩn bị Google Sheet

Cách nhanh nhất: import file mẫu `sample-data/sample-leads-template.csv` vào Google Sheets
(File → Import → Upload), sau đó xóa các hàng dữ liệu mẫu và điền dữ liệu thật.

Sheet cần có đúng các cột sau ở hàng đầu tiên (tên cột phải khớp chính xác với `config/mapping.json`):

| Cột                     | Bắt buộc                         | Ghi chú                                    |
| ----------------------- | -------------------------------- | ------------------------------------------ |
| Tên khách hàng          | ✅                               | Map sang `TITLE` + `NAME` trong Bitrix24   |
| Email                   |                                  | Dùng để chống trùng lặp                    |
| Số điện thoại           |                                  | Dùng để chống trùng lặp                    |
| Công ty                 |                                  |                                            |
| Nguồn lead (UTM Source) |                                  | Map sang custom field `UF_CRM_UTM_SOURCE`  |
| Ngân sách dự kiến       |                                  | Chấp nhận "10tr", "10,000,000"...          |
| Trạng thái              |                                  | Map sang `STATUS_ID`                       |
| Người phụ trách         |                                  | ID số của user Bitrix24 (`ASSIGNED_BY_ID`) |
| Ghi chú                 |                                  | Map sang `COMMENTS`                        |
| Lead ID Bitrix24        | ✅ (hệ thống tự ghi)             | Cột ẩn để tracking, không tự nhập          |
| Trạng thái đồng bộ      | ✅ (hệ thống tự ghi)             | Chờ xử lý / Đã đồng bộ / Lỗi               |
| Thời gian đồng bộ cuối  | ✅ (hệ thống tự ghi)             | ISO timestamp                              |
| Thông báo lỗi           | ✅ (hệ thống tự ghi)             | Chi tiết lỗi nếu có                        |
| Sync Hash               | ✅ (hệ thống tự ghi, nên ẩn cột) | Dùng nội bộ để phát hiện thay đổi          |

> **Ghi chú về "Người phụ trách":** Bitrix24 field `ASSIGNED_BY_ID` gửi **ID số**. Cột có thể
> nhận ID hoặc nhãn enum đã cấu hình, chẳng hạn `Nguyễn Tuấn (#15)`; reverse hiển thị nhãn đó.
> Có thể để trống để CRM dùng mặc định. Tên/ID phải lấy từ đúng portal và giữ mapping cập nhật.

## 4. Cấu hình mapping rules

File `config/mapping.json` định nghĩa toàn bộ ánh xạ. Có thể sửa file này **mà không cần build lại code**
(Docker mount `config/` có quyền ghi để lưu từ Admin).

```json
{
  "sheetColumn": "Ngân sách dự kiến",
  "bitrixField": "OPPORTUNITY",
  "type": "number",
  "required": false
}
```

Các `type` của dạng `fields`: `string`, `email`, `phone`, `number`, `enum`, `date`. Với field multi-value của Bitrix24
(EMAIL, PHONE), thêm `"multiValue": true` và `"valueType": "WORK" | "MOBILE" | "HOME"`.

Sau khi sửa file bằng editor, restart để áp dụng. Sửa và lưu từ Admin có hiệu lực ngay.
Mapping dạng fields hiện tại được chuyển trong bộ nhớ; khi lưu từ Admin sẽ dùng columns,
transforms, dedupFields và additionalFields. Một cột ra TITLE và NAME vẫn được giữ.
Enum dạng fields không có `values` giữ cách chuẩn hóa cũ; giá trị phải khớp STATUS_ID portal.
CSV mẫu dùng `NEW`/`IN_PROCESS`; hãy thay bằng mã trạng thái của portal nếu khác.
Với enum theo nhãn, dùng transforms type enum và khai báo values nhãn → ID.

### Ví dụ nâng cao

`config/mapping.advanced.example.json` minh họa enum tiếng Việt, nhiều email/điện thoại
phân cách bằng `;`, ngày `DD/MM/YYYY` hoặc `YYYY-MM-DD`, và trường kéo về Sheet.
Muốn dùng mẫu, đặt `MAPPING_CONFIG_PATH=./config/mapping.advanced.example.json`,
`SYNC_DIRECTION=both`, rồi restart. Trước đó phải tạo/đổi custom field
`UF_CRM_APPOINTMENT_DATE` theo portal và thêm cột `Ngày hẹn` nếu dùng.
Mẫu dùng trường chuẩn `UTM_SOURCE`; mapping đang chạy vẫn giữ custom field của bạn.
Hai chiến lược hợp lệ là `bitrix_wins` và `sheet_wins` (ưu tiên theo cấu hình, không phải last-write-wins).

## 5. Cài đặt & chạy

Dùng Node.js 20, chạy trong thư mục dự án:

```bash
npm ci
cp .env.example .env
# Điền thông tin Google, Bitrix24 và MANAGEMENT_API_KEY trước khi khởi động.
npm run build
npm run start:prod
```

PowerShell dùng Copy-Item .env.example .env; nếu chặn npm.ps1, dùng npm.cmd.
Không ghi đè .env đang có. Admin: http://localhost:3000/admin; Swagger: http://localhost:3000/docs.
PORT đổi cổng local; nếu đổi Docker phải cập nhật cả ports và healthcheck.
Không chạy server local và Docker cùng một Sheet.

OAuth Google tài khoản cá nhân: dùng oauth hoặc oauth2. Client ID/Secret phải thuộc cùng client.
Helper scripts/get-oauth-refresh-token.js không tự đọc .env: truyền Client ID/Secret qua
biến môi trường terminal, đăng nhập và cấp quyền, rồi lưu refresh token vào .env.
Redirect URI của helper là http://localhost:3999/oauth2callback. Không chia sẻ token/secret.

## 6. Kích hoạt đồng bộ thủ công

Mở Admin, nhập MANAGEMENT_API_KEY. Chọn đồng bộ lên CRM hoặc cập nhật về Sheet.
API cần header x-api-key; ví dụ Bash:

```bash
curl -X POST http://localhost:3000/api/v1/sync/run -H "x-api-key: $MANAGEMENT_API_KEY"
curl -X POST http://localhost:3000/api/v1/sync/reverse-run -H "x-api-key: $MANAGEMENT_API_KEY"
```

- GET/PUT /api/v1/sync/admin/config: đọc/lưu mapping, có API key.
- GET /api/v1/sync/admin: kiểm tra API key, trả JSON.
- GET /admin: HTML công khai; không phải API đồng bộ.
- POST /webhooks/bitrix24/leads: token riêng BITRIX24_WEBHOOK_SECRET.

CLI không mở HTTP hoặc cron:

```bash
npm run sync:run
npm run sync:cli
npm run sync:reverse:cli
```

Lệnh đầu cần build; hai lệnh sau dùng ts-node. CLI và server dùng chung khóa tệp `data/sync.lock`: nếu một job khác đang chạy, CLI dừng ngay với `SYNC_LOCKED` (mã thoát 1) thay vì ghi đè. Trong Docker dùng `docker compose exec sync-service node dist/cli/sync-cli.js` để cùng volume `./data`.
Cron dùng SYNC_CRON (hoặc SYNC_CRON_EXPRESSION cũ), mặc định mỗi 15 phút. SYNC_DIRECTION nhận forward (mặc định), reverse hoặc both; both chạy reverse trước rồi forward. Hai lượt dùng khóa chung nhưng không phải một giao dịch nguyên tử.

## 7. Deploy bằng Docker

```bash
docker compose up --build -d
docker compose logs --tail 100 sync-service
```

config/ mount ghi được; credentials/ chỉ đọc. Không cần npm ci trên host nếu chỉ chạy Docker.
Sau sửa .env cần recreate container. Sau sửa code cần build lại image.
Không đưa .env, credentials, archive sao lưu hoặc token vào Git/image. Container chạy bằng user `node` (không phải root).

### Bảo mật khi triển khai

- Đặt sau reverse proxy có HTTPS (ứng dụng không tự làm TLS); đặt `TRUST_PROXY` theo số proxy.
- Dùng `MANAGEMENT_API_KEY` dài, ngẫu nhiên (từ chối khóa mẫu); sai 10 lần/5 phút/IP sẽ bị khóa tạm.
- Swagger tắt mặc định ở production. Các header bảo mật/CSP do helmet cung cấp.
- Xoay (rotate) khóa nếu từng chia sẻ file `.env` hoặc service account qua kênh không an toàn.
- Chạy `npm audit --omit=dev` định kỳ. Các lỗ hổng mức cao đã vá bằng `overrides`; 8 cảnh báo mức trung bình còn lại cần nâng major NestJS/googleapis.

### Chạy ngrok cùng Docker để nhận webhook

Điền `NGROK_AUTHTOKEN` trong `.env` bằng authtoken tài khoản ngrok (khác token webhook Bitrix).
Lấy tại https://dashboard.ngrok.com/get-started/your-authtoken. Không commit token.

```bash
docker compose --profile tunnel up -d --build
docker compose logs --tail 50 ngrok
```

Ngrok chuyển tiếp tới `sync-service:PORT` trong mạng Docker, chờ app healthy trước khi chạy.
Lấy URL HTTPS trong log, điền vào `PUBLIC_BASE_URL` (không thêm `/docs` hoặc đường dẫn webhook), rồi:

```bash
docker compose up -d --force-recreate sync-service
```

Cấu hình Outbound Bitrix gửi tới `PUBLIC_BASE_URL/webhooks/bitrix24/leads`.
Mở `PUBLIC_BASE_URL/docs` để kiểm tra tunnel; sửa Lead thật để kiểm tra webhook.
Nếu URL được cấp thay đổi, cập nhật cả `.env` và URL Outbound trên Bitrix.
Không cần chạy ngrok hoặc app riêng trên host. Dừng tunnel bằng `docker compose stop ngrok`.
Profile `tunnel` là tùy chọn; lệnh Compose bình thường không tạo container ngrok mới.
Image và biến token theo [hướng dẫn Docker chính thức của ngrok](https://ngrok.com/download/docker).

## 8. Test & coverage

Jest áp dụng ngưỡng tối thiểu 70% cho statements, branches, functions và lines. Test Admin nạp JavaScript qua Jest để đo coverage, không bỏ frontend khỏi báo cáo. Test DOM giả lập không thay thế kiểm tra bố cục trên trình duyệt.

```bash
npm run build
npm test -- --runInBand
npm run test:cov -- --runInBand
npm run test:performance
npm run test:e2e
```

Test dùng mock, không chứng minh kết nối live. Performance 150 dòng có tại
src/sync/sync.service.performance.spec.ts và sample-data/perf-150.csv.
Coverage phải đo lại trên bản hiện tại; không sử dụng số liệu của bộ code đã bỏ.

### Chạy test nhẹ RAM (máy 8–16 GB)

| Lệnh                       | Khi nào dùng                                                                 | Đo thực tế*                            |
| -------------------------- | ---------------------------------------------------------------------------- | -------------------------------------- |
| `npm run test:light`       | Chạy hằng ngày, 2 worker, không gồm test hiệu năng                           | ~13 s, ~1,1 GB                         |
| `npm test`                 | Toàn bộ test đơn vị, số worker = 50% số core                                 | nhanh, RAM thấp hơn cấu hình cũ ~2 lần |
| `npm run test:cov`         | Đo coverage (engine V8, ngưỡng 70%)                                          | ~36 s, ~0,8 GB                         |
| `npm run test:performance` | Test 150 dòng, chạy tuần tự vì phụ thuộc thời gian                           | ~5 s, ~0,4 GB                          |
| `npm run verify`           | Trước khi nộp/commit: typecheck → lint → test+coverage → performance → build | đủ mọi cổng chất lượng                 |

\*Đo trên máy thử 1 core / 4 GB. Cấu hình cũ (ts-jest kiểm tra kiểu trong mỗi worker) chạy 4 worker cần ~3,9 GB và ~260 s;
cấu hình hiện tại cần ~1,9 GB và ~19 s cho cùng 254 test.

Jest **không còn kiểm tra kiểu** để tiết kiệm RAM (`isolatedModules`); việc đó do `npm run typecheck` (tsc) đảm nhiệm và nằm trong
`npm run verify`. Luôn chạy `verify` trước khi nộp. Nếu máy vẫn nặng: `npx jest --maxWorkers=1`. Worker vượt 400 MB được tự khởi động lại (`workerIdleMemoryLimit`).

## 9. Troubleshooting

- invalid_client: kiểm tra Client ID/Secret cùng OAuth client; invalid_grant: kiểm tra/cấp lại refresh token.
- Google 403: kiểm tra quyền Sheet và tài khoản được cấp quyền.
- Sai tab: GOOGLE_SHEET_WORKSHEET_NAME phải khớp đúng tên, kể cả hoa/thường.
- Thiếu cột hoặc required: đối chiếu mapping; Trạng thái khác Trạng thái đồng bộ.
- Phone: nhập dạng văn bản để giữ số 0 đầu, dùng số hợp lệ đầy đủ; CSV dùng UTF-8.
- Custom field UF_CRM_* phải tồn tại trên portal. Không tự đổi field của người dùng khi dọn code.
- API 401: nhập MANAGEMENT_API_KEY. Webhook dùng token khác.
- Mapping lưu lỗi: kiểm tra quyền ghi thư mục config.
- 429/timeouts: giãn lịch, giảm SYNC_BITRIX_CONCURRENCY; không chạy lại batch ghi mù quáng.
- 409 `SYNC_LOCKED`: đang có job khác chạy. Chờ xong rồi chạy lại. Nếu chắc chắn không còn tiến trình nào (vừa crash), khóa tự hết hạn sau `SYNC_LOCK_TTL_MS` (10 phút) hoặc xóa `data/sync.lock`.
- 429 từ API: IP bị khóa tạm vì nhập sai API key/token nhiều lần; chờ theo `retryAfterSeconds`. Sau reverse proxy đặt `TRUST_PROXY=1` để tính đúng IP.
- `/docs` trả 404: Swagger tắt ở production; đặt `ENABLE_SWAGGER=true` rồi recreate container.
- `SHEET_CHANGED_DURING_SYNC`: có người sort/chèn/xóa dòng lúc đang đồng bộ. Không có gì bị ghi; chỉ cần chạy lại.
- Webhook trả 202 nhưng Sheet chưa đổi: sự kiện chạy nền, tra kết quả ở lịch sử trên Admin; lỗi tạm thời được thử lại tối đa 3 lần.

## 10. Monitor & maintain

### Kiểm tra kết nối trên Admin

Sau khi đăng nhập, bấm **Kiểm tra kết nối**. Endpoint `POST /api/v1/sync/admin/connections/check` cần `x-api-key`, chỉ kiểm tra quyền đọc Google và CRM; không chứng minh quyền ghi hoặc realtime hoạt động. Credentials không trả về trình duyệt.

Đặt `PUBLIC_BASE_URL=https://<domain-công-khai>` trong môi trường rồi restart để Admin hiển thị URL nhận Outbound. Cấu hình token ở `BITRIX24_WEBHOOK_SECRET`; không nhập URL Inbound vào `PUBLIC_BASE_URL`. Nút kiểm tra không gọi URL công khai và không tự đăng ký webhook trên Bitrix.

Xem log console bằng docker compose logs và kết quả trên Admin/cột lỗi của Sheet.
Không có /sync/status hoặc file logs/sync.log trong bộ đã hợp nhất.
Admin hiển thị kết quả trong phiên và lịch sử 100 lần chạy gần nhất qua `GET /api/v1/sync/admin/history` (cần `x-api-key`). Bấm tải lịch sử để xem kết quả, số dòng lỗi và thông báo đã loại bỏ dữ liệu nhạy cảm. Docker mount `./data:/app/data`; local có thể đổi `SYNC_HISTORY_DIR`. Giữ quyền ghi thư mục này và không commit dữ liệu vận hành. Lịch sử không phải audit log đầy đủ; lỗi chưa nhận diện được có thông báo chung. Không dùng endpoint đồng bộ làm healthcheck.

## Tính năng nâng cao & mức độ hoàn thiện

### Mốc CRM và chuyển đổi cấu hình

Mapping mẫu có `statusColumns.crmModifiedAt: "CRM Modified At"`. Cột này lưu DATE_MODIFY đã đọc từ CRM, tách khỏi thời gian job chạy. Cột mới được thêm khi ghi Sheet; Lead ID được ẩn khi chuẩn bị layout. Mapping cũ chưa khai báo cột này vẫn dùng cơ chế timestamp cũ: nên thêm khóa trước khi nghiệm thu conflict. Không điền giờ máy local vào cột CRM.

Sau ghi CRM, hệ thống giữ mốc CRM đã đọc trước khi ghi (Lead mới để trống); lần reverse sau sẽ đối chiếu lại. Điều này có thể tạo thêm một lần pull nhưng tránh coi thay đổi ngoài ứng dụng là đã đồng bộ. Lần chuyển đổi đầu thiếu mốc sẽ xử lý thận trọng theo chính sách ưu tiên đã chọn.

`GOOGLE_DETECT_FORMATS=true` (mặc định) đọc metadata định dạng cho vùng có dữ liệu, chuyển ô DATE/DATE_TIME sang YYYY-MM-DD theo ngày của Sheet và giữ nguyên số thường. Trường ngày chỉ giữ ngày, không giữ giờ. Tắt bằng false nếu chỉ nhập ngày dạng văn bản và muốn giảm một lượt đọc metadata.

Lookup kiểm tra cả email và phone, từ chối nhiều Lead cùng khớp hoặc hai liên hệ trỏ tới Lead khác nhau. Bitrix giới hạn chủ động 2 lượt/giây trong một process; mỗi lần retry đều lấy lượt mới. Google cũng tính quota cho từng lần retry. Giới hạn này không điều phối nhiều instance; batch ghi vẫn không replay mù quáng sau timeout.

- Reverse chỉ cập nhật Lead ID đã có trên Sheet và các trường trong `reverseColumns`; không nhập Lead CRM mới, không đồng bộ Deals. Khi thiếu `reverseColumns`, chỉ chọn `STATUS_ID` và `ASSIGNED_BY_ID` từ mapping; `{}` tắt kéo trường về.
- Webhook ONCRMLEADADD/ONCRMLEADUPDATE dùng HTTPS công khai, token application_token.
  Cấu hình Outbound webhook trên portal; localhost không nhận được sự kiện Internet.
- Enum, multi-value email/phone và date có transforms; mapping fields cũ được hỗ trợ đọc.
- Admin hỗ trợ biểu mẫu: Đọc JSON vào biểu mẫu → sửa tên cột/mã CRM/kiểu dữ liệu/trường kéo về → Áp dụng biểu mẫu → Lưu thay đổi. Có thể dùng JSON cho cấu hình nâng cao. Tải lại/đăng xuất yêu cầu xác nhận nếu chưa lưu. Lịch sử hiển thị cả lỗi từng dòng.
- Mapping người phụ trách dùng `ASSIGNED_BY_ID`: nhập ID số người dùng Bitrix, không nhập tên. Đổi các giá trị tên cũ trên Sheet trước khi chạy; không tự suy đoán ID. Trạng thái phải là ID thực tế của portal hoặc nhãn enum đã khai báo.
- `CONFLICT_RESOLUTION_STRATEGY=bitrix_wins` (mặc định) hoặc `sheet_wins`: reverse kiểm tra hash Sheet và DATE_MODIFY CRM. Với `SYNC_DIRECTION=both`, chiều thuận cũng kiểm tra CRM trước khi ghi bản ghi đã liên kết có thay đổi. Nếu CRM đổi và ưu tiên CRM, kéo trường được chọn về trước, giữ hash cũ cho dữ liệu chỉ có ở Sheet; lần chạy tiếp theo đẩy phần thay đổi còn lại. `forward` chỉ đẩy Sheet lên CRM; reverse thủ công/webhook vẫn là yêu cầu kéo riêng.
- Không đồng bộ xóa, không tự ghép hàng nháp thiếu ID khi reverse. Khóa tệp chỉ bảo vệ các tiến trình dùng chung volume; nhiều bản sao trên máy khác nhau cần khóa phân tán (Redis/PostgreSQL).
- Đọc toàn bộ Sheet vào bộ nhớ, truy vấn CRM theo nhóm ID liên kết. Khóa chỉ có hiệu lực trong một process. Không có giao dịch nguyên tử giữa hai API: thay đổi bên ngoài xảy ra giữa bước đọc và ghi vẫn có rủi ro xung đột. Không đổi thứ tự dòng khi job chạy.
- Cột hệ thống được chuẩn bị và Lead ID được ẩn trước khi ghi CRM. Dòng cần ghi chuyển sang `Chờ xử lý`, rồi `Đã đồng bộ` hoặc `Lỗi`. Nếu job dừng giữa chừng, đối chiếu trước khi chạy lại.
- Idempotency dựa trên Lead ID/hash và email/phone. Nếu lần tạo đã thành công nhưng mất phản hồi hoặc ghi Sheet thất bại, dòng không có email/phone không thể tự phục hồi ID an toàn; cần đối chiếu CRM thủ công. Không cam kết exactly-once.

## Kịch bản kiểm thử

Các bước, tiền điều kiện và kết quả mong đợi được tách trong [Test plan](docs/TEST-PLAN.md).
Thực hiện live trên Sheet/portal thử nghiệm riêng; không dùng dữ liệu khách thật.

### API reference

Các route quản trị, xác thực, response và webhook được mô tả trong [API usage](docs/API-USAGE.md).

Kịch bản video dưới 5 phút: [docs/DEMO.md](docs/DEMO.md).
