# Kết quả rà soát và kiểm nghiệm bản hiện tại

[README](../README.md) · [Hướng dẫn](GUIDE.md) · [Kiến trúc](ARCHITECTURE.md) · [Tích hợp](INTEGRATIONS.md)

Ngày kiểm tra: **09/10/2026**, múi giờ **Asia/Bangkok (UTC+7)**. Phạm vi: source trong workspace, build, các bộ test hiện có và kiểm tra chỉ đọc trên Docker chính. Không đổi logic nghiệp vụ, không reset database chính, không chủ động tạo thêm dữ liệu CRM để kiểm tra.

## 1. Kết quả chạy mới

| Hạng mục                 | Lệnh                                         | Kết quả                            |
| ------------------------ | -------------------------------------------- | ---------------------------------- |
| Typecheck source         | `npm run typecheck`                          | Đạt                                |
| Typecheck source và test | `npm run test:types`                         | Đạt                                |
| ESLint                   | `npm run lint`                               | Đạt                                |
| Build                    | `npm run build`                              | Đạt                                |
| Unit + coverage          | `npm run test:cov -- --runInBand --no-cache` | **308/308**, 50 suite, 75,456 giây |
| E2E HTTP                 | `npm run test:e2e -- --runInBand --no-cache` | **4/4**, 15,303 giây               |
| Integration              | `npm run test:integration -- --no-cache`     | **27/27**, 41,131 giây             |

**Tổng: 339 test đạt.** Số 333 trong báo cáo trước không còn là tổng test của source hiện tại. Thời gian phụ thuộc máy và các tác vụ chạy đồng thời; không phải chỉ số hiệu năng API.

Integration dùng project `ads_tiktok_test`, PostgreSQL 16 tại 55432 (`integration_test`, dữ liệu tmpfs), Redis 7 tại 56379. Preflight xác nhận đăng nhập DB/Redis trước suite. Suite tạo lại schema và flush Redis kiểm thử; database chính dùng cổng 5432/6379 không nằm trong phạm vi này.

| Coverage phần được Jest đo | Kết quả    |
| -------------------------- | ---------- |
| Statements                 | **90,69%** |
| Branches                   | **83,01%** |
| Functions                  | **90,39%** |
| Lines                      | **91,45%** |

Nguồn: `coverage/coverage-final.json` của lần chạy mới. Bốn chỉ số vượt ngưỡng 80%. Cấu hình loại trừ tools, main, database, module và file kiểm thử; không diễn giải đây là coverage toàn bộ hệ thống hay kiểm thử giao diện trình duyệt.

## 2. Source và container có cùng bản không?

Sau khi cập nhật tài liệu, `npm run format:check` đạt; kiểm tra liên kết tương đối trong README và sáu file Markdown của `docs` không phát hiện liên kết hỏng.

Sau build, so sánh SHA-256 từng file JavaScript trong `dist` local với `/app/dist` của container đang chạy: **89/89 file khớp**, không có file thiếu/thừa trong tập `.js`. Đây là đối chiếu mã đã biên dịch tại thời điểm kiểm tra, không bao gồm toàn bộ dependency, image layer hay file cấu hình môi trường.

## 3. Dữ liệu Docker chính đã quan sát

Snapshot lấy lúc **10:04:48 ngày 09/10/2026** (03:04:48 UTC), trước khi stack chính dừng trong lúc thực hiện lần rà này. Generator đang hoạt động nên các truy vấn tiếp theo có thể có số lượng khác.

| Cấu hình không chứa secret              | Giá trị quan sát                        |
| --------------------------------------- | --------------------------------------- |
| NODE_ENV                                | development                             |
| BITRIX24_MOCK                           | false — đồng bộ vào CRM thật            |
| TIKTOK_EVENTS_MOCK                      | true                                    |
| MOCK_LEADS_ENABLED                      | true                                    |
| Chu kỳ / giới hạn generator             | 1 phút / 1.000 sự kiện mỗi lần chạy app |
| Cho phép mock vào CRM thật              | true                                    |
| ADMIN_API_KEY                           | Chưa cấu hình                           |
| NOTIFY_WEBHOOK_URL / REPORT_WEBHOOK_URL | Chưa cấu hình                           |

| Bảng                | Số bản ghi |
| ------------------- | ---------: |
| leads               |      1.522 |
| deals               |        605 |
| webhook_events      |      1.523 |
| conversion_outbox   |          0 |
| notification_outbox |        605 |
| migrations          |          6 |

| Score | Trạng thái lead | Lead | Deal liên kết cùng mode |
| ----: | --------------- | ---: | ----------------------: |
|    30 | synced          |  450 |                       0 |
|    60 | synced          |  467 |                       0 |
|    80 | converted       |  381 |                     381 |
|    90 | converted       |  224 |                     224 |

Tại snapshot, cả 605 deal thuộc mode real, trạng thái open, tiền tệ VND. Cả 605 thông báo là `logged`: chỉ ghi thông báo demo vì thiếu URL nhận, **không phải 605 lần gửi HTTP thành công**. Không có deal won/conversion để xác nhận vòng won→TikTok từ dữ liệu live này; luồng đó được kiểm tra bằng integration.

Queue `bitrix-sync`: 355 completed, 0 failed, 1 waiting, 0 active/delayed lúc đọc. Completed có chính sách dọn theo tuổi/số lượng, không phải tổng lịch sử lead. Tỷ lệ lead có deal tại snapshot khoảng 39,75%; không dùng nó làm tỷ lệ chuyển đổi thực tế của TikTok.

Ngrok cũng đang chạy lúc kiểm tra container ban đầu. API key chưa cấu hình là trạng thái demo hiện hữu; cần bật bảo vệ API trước khi công khai toàn bộ app qua tunnel. Lần rà này không thay cấu hình bảo mật đang dùng và không ghi secret/địa chỉ portal vào tài liệu.

## 4. Kiểm tra HTTP trên Docker

Đã gọi chỉ đọc trước khi app dừng:

| Endpoint                                                | Kết quả                                           |
| ------------------------------------------------------- | ------------------------------------------------- |
| `/health`, `/docs`, `/docs-json`                        | HTTP 200                                          |
| `/api/v1/leads?page=1&limit=10`                         | HTTP 200                                          |
| `/api/v1/deals?status=open&assigned_to=1`               | HTTP 200                                          |
| `/api/v1/config/mappings`, `/api/v1/config/rules`       | HTTP 200                                          |
| `/api/v1/analytics/conversion-rates?date_range=30d`     | HTTP 200                                          |
| `/api/v1/analytics/campaign-performance?date_range=30d` | HTTP 200                                          |
| Export JSON, 30d                                        | HTTP 200, đọc được **1.535 dòng**                 |
| Export CSV, 30d                                         | HTTP 200, 349.283 byte                            |
| Export XLSX, 30d                                        | HTTP 200, ExcelJS mở được, **1.535 dòng dữ liệu** |
| Campaign performance với `date_range=bad`               | HTTP 400                                          |

1.535 dòng xuất được lấy sau snapshot 1.522 lead; generator tiếp tục tạo dữ liệu giữa hai lần đọc. Không dùng chênh lệch đó để kết luận bản ghi trùng hay thất thoát.

**Đo tải SSE lần này chưa hoàn tất.** Lệnh 20 SSE/60 giây kết thúc mà không có báo cáo; kiểm tra tiếp thấy stack chính đã dừng (`service "app" is not running`). Không ghi nhận kết quả PASS hoặc p95 mới. Số p95 23 ms của lần trước không được dùng thay thế. Không tự khởi động lại stack để tránh thay đổi trạng thái vận hành giữa lúc cập nhật tài liệu.

## 5. Bằng chứng theo yêu cầu chức năng

| Yêu cầu                       | Đã kiểm chứng                                                                          | Giới hạn                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Webhook TikTok                | Chữ ký đúng/sai, raw body, thiếu event ID, sự kiện trùng qua HTTP                      | Chữ ký là hợp đồng của dự án, chưa nghiệm thu TikTok thật  |
| Chuẩn hóa và dedup            | Email/phone, gộp liên hệ phụ, attribution lần đầu, xử lý đồng thời                     | Chưa thử mọi trường hợp hai lead cũ có liên hệ chéo        |
| Form completion / interaction | Timeline, chống cộng lặp theo sự kiện, cộng điểm                                       | Chưa tự enqueue xét lại rule khi chỉ có tương tác          |
| CRM Lead / Deal               | Mapping, nguồn, cập nhật, rule, phân công, amount; số liệu local đồng bộ real          | Chưa đối soát từng bản ghi trong portal ở lượt này         |
| Rule 70/85 và mock            | Test biên 69/70/84/85, thiếu liên hệ; dữ liệu 30/60 không tự có deal                   | Rule cấu hình DB có thể khác mặc định source               |
| Retry / idempotency           | HTTP giả lập tạo xong rồi ngắt kết nối; retry đồng thời không tạo trùng lead/deal      | Máy chủ HTTP cục bộ, chưa cố tình gây lỗi trên portal thật |
| 429 / lỗi DB                  | BullMQ retry thực, tôn trọng Retry-After, lỗi DB tạm thời được thử lại                 | Không chứng minh tất cả lỗi API bên ngoài                  |
| Notification                  | Rollback cùng deal, HTTP 503 rồi thành công, hai sender, phục hồi lease hết hạn        | Bên nhận phải chống trùng event_id/Idempotency-Key         |
| Conversion won                | Deal/timeline/outbox cùng transaction; mock conversion, rollback và callback đồng thời | TikTok thật chưa nghiệm thu                                |
| Thống kê và ROI               | Mode mock/real tách nhau, không đếm đôi, CPL/ROI, chặn ngoại tệ chưa quy đổi           | Chi phí nhập thủ công đúng nhóm lead/khoảng ngày           |
| CSV/JSON/XLSX                 | HTTP xuất đủ **20.000 lead** trong DB test; Excel đọc được; luồng/hủy tải có test      | Chưa chứng minh ngưỡng RAM production hoặc tải dài hạn     |
| Batch / báo cáo / cảnh báo    | Nhập theo lô, phục hồi Redis, multipart file và retry, cron/điều kiện cảnh báo         | URL gửi live hiện để trống; không coi là đã gửi thực tế    |
| Session / rate limit          | Tạo, thu hồi, hết hạn phiên; đăng nhập sai bị giới hạn                                 | Quyền quản trị chung, rate limit theo tiến trình           |

## 6. Những gì không được suy ra từ kết quả này

- Không có điểm nghiệm thu chính thức 95/100 hay cam kết production từ số test pass.
- Chưa kiểm thử trình duyệt trực tiếp cho toàn bộ Swagger/SSE, CI GitHub của commit cuối hoặc deploy file Compose production.
- Chưa nghiệm thu chữ ký/payload/conversion với TikTok thật; phần này được giữ ở mức mô phỏng theo phạm vi dự án.
- Chưa chứng minh failover nhiều replica, tải dài hạn, khôi phục từ backup hay chống trùng với ứng dụng độc lập cùng ghi vào portal.
- Kết quả API/database là ảnh chụp có thời điểm; trạng thái Docker cuối lần kiểm tra đã khác lúc bắt đầu. Cần chạy lại `/health` và smoke khi bật lại app.

## 7. Chạy lại

Theo [GUIDE — Kiểm thử và bàn giao](GUIDE.md). Bật đúng project test, xác nhận hai cổng 55432/56379; không dùng database app để chạy integration. `--no-cache` giúp loại cache Jest cũ. Các log ERROR có chủ ý trong test không đồng nghĩa suite thất bại.

Tài liệu này ghi nhận kết quả kiểm thử của phiên bản hiện tại và thay thế các số liệu, snapshot cũ. Các giới hạn nghiệm thu và cải tiến cần thiết trước production được trình bày trong [Lộ trình Production](PRODUCTION-ROADMAP.md).
