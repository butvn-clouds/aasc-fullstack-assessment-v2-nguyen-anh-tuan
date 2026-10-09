# Kết quả kiểm thử – 09/10/2026

Ngày kiểm tra: **09/10/2026** (Asia/Bangkok, UTC+7).

## 1. Kết quả chạy kiểm thử

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Typecheck source | `npm run typecheck` | Đạt |
| Typecheck source và test | `npm run test:types` | Đạt |
| ESLint | `npm run lint` | Đạt |
| Build | `npm run build` | Đạt |
| Unit + coverage | `npm run test:cov -- --runInBand --no-cache` | **308/308**, 50 suites, 75,456 giây |
| E2E HTTP | `npm run test:e2e -- --runInBand --no-cache` | **4/4**, 15,303 giây |
| Integration | `npm run test:integration -- --no-cache` | **27/27**, 41,131 giây |

**Tổng: 339/339 test đạt.**

Integration sử dụng project `ads_tiktok_test`, PostgreSQL 16 (cổng 55432, database `integration_test`, tmpfs) và Redis 7 (cổng 56379).

| Coverage do Jest đo | Kết quả |
| --- | ---: |
| Statements | **90,69%** |
| Branches | **83,01%** |
| Functions | **90,39%** |
| Lines | **91,45%** |

Nguồn coverage: `coverage/coverage-final.json`.

## 2. Kết quả tích hợp Bitrix24 thật

- **Đã kiểm thử kết nối và đồng bộ với Bitrix24 CRM thật; luồng đồng bộ chạy thông suốt**
- Cấu hình Docker: `BITRIX24_MOCK=false`, `TIKTOK_EVENTS_MOCK=true`, `MOCK_LEADS_ENABLED=true`.
- Dữ liệu đầu vào TikTok được giả lập; hệ thống đồng bộ sang Bitrix24 thật.
- Snapshot ghi nhận **605 deal mode real**, trạng thái `open`, tiền tệ `VND`.

## 3. Dữ liệu Docker ghi nhận

Snapshot: **10:04:48 ngày 09/10/2026** (03:04:48 UTC).

| Cấu hình | Giá trị |
| --- | --- |
| NODE_ENV | development |
| BITRIX24_MOCK | false |
| TIKTOK_EVENTS_MOCK | true |
| MOCK_LEADS_ENABLED | true |
| Generator | 1 phút / tối đa 1.000 sự kiện mỗi lần chạy app |
| Cho phép mock vào CRM thật | true |
| ADMIN_API_KEY | Chưa cấu hình |
| NOTIFY_WEBHOOK_URL / REPORT_WEBHOOK_URL | Chưa cấu hình |

| Bảng | Số bản ghi |
| --- | ---: |
| leads | 1.522 |
| deals | 605 |
| webhook_events | 1.523 |
| conversion_outbox | 0 |
| notification_outbox | 605 |
| migrations | 6 |

| Score | Trạng thái lead | Lead | Deal liên kết cùng mode |
| ---: | --- | ---: | ---: |
| 30 | synced | 450 | 0 |
| 60 | synced | 467 | 0 |
| 80 | converted | 381 | 381 |
| 90 | converted | 224 | 224 |

Queue `bitrix-sync`: **355 completed**, **0 failed**, **1 waiting**, **0 active/delayed** tại thời điểm kiểm tra.

Notification outbox: **605 bản ghi `logged`**; chưa ghi nhận 605 lần gửi HTTP thành công.

## 4. Kết quả kiểm tra HTTP trên Docker

| Endpoint / tác vụ | Kết quả |
| --- | --- |
| `/health`, `/docs`, `/docs-json` | HTTP 200 |
| `/api/v1/leads?page=1&limit=10` | HTTP 200 |
| `/api/v1/deals?status=open&assigned_to=1` | HTTP 200 |
| `/api/v1/config/mappings`, `/api/v1/config/rules` | HTTP 200 |
| `/api/v1/analytics/conversion-rates?date_range=30d` | HTTP 200 |
| `/api/v1/analytics/campaign-performance?date_range=30d` | HTTP 200 |
| Export JSON, 30d | HTTP 200, 1.535 dòng |
| Export CSV, 30d | HTTP 200, 349.283 byte |
| Export XLSX, 30d | HTTP 200, 1.535 dòng dữ liệu, ExcelJS mở được |
| Campaign performance, `date_range=bad` | HTTP 400 |
| SSE, 20 kết nối / 60 giây | Chưa hoàn tất phép đo; không có báo cáo mới |

## 5. Kết quả kiểm thử chức năng

| Chức năng | Kết quả được ghi nhận |
| --- | --- |
| Webhook TikTok | Kiểm tra chữ ký đúng/sai, raw body, thiếu event ID, sự kiện trùng qua HTTP |
| Chuẩn hóa và dedup | Email/phone, gộp liên hệ phụ, attribution lần đầu, xử lý đồng thời |
| Form completion / interaction | Timeline, chống cộng điểm lặp theo sự kiện |
| CRM Lead / Deal | Mapping, nguồn, cập nhật, rule, phân công, amount; đồng bộ với CRM thật |
| Rule 70/85 | Kiểm tra biên 69/70/84/85 và trường hợp thiếu liên hệ |
| Retry / idempotency | Kiểm tra retry đồng thời, xử lý lỗi sau tạo bản ghi |
| 429 / lỗi DB | BullMQ retry, Retry-After, lỗi DB tạm thời |
| Notification | Rollback, HTTP 503 rồi thành công, hai sender, phục hồi lease |
| Conversion won | Transaction deal/timeline/outbox, mock conversion, rollback, callback đồng thời |
| Analytics / ROI | Tách mode mock/real, CPL/ROI, xử lý ngoại tệ |
| CSV / JSON / XLSX | HTTP export đủ **20.000 lead** trong database test |
| Batch / báo cáo / cảnh báo | Nhập theo lô, phục hồi Redis, multipart, retry, cron và điều kiện cảnh báo |
| Session / rate limit | Tạo/thu hồi/hết hạn phiên, giới hạn đăng nhập sai |
