# Kiến trúc sau hợp nhất

## Thành phần

- AppConfigModule: biến môi trường cho Google, retry và cổng HTTP.
- MappingConfigModule: một nguồn mapping, validate và lưu nguyên tử.
- GoogleSheetsService: đọc snapshot, bổ sung cột/lưới, ghi ô theo vị trí.
- Bitrix24ClientService: đọc phân trang và ghi batch CRM tối đa 50 lệnh.
- SyncService: Sheet → CRM, hash và tra trùng liên hệ.
- TwoWaySyncService: CRM → Sheet, đối chiếu Lead ID và xung đột.
- RealtimeSyncService: webhook gọi cùng luồng reverse theo một ID.
- ApiModule: API quản trị có API key, Admin HTML và webhook có token riêng.
- AppSchedulerModule: chọn forward/reverse/both theo SYNC_DIRECTION; both chạy reverse trước.
- CliAppModule: hai CLI dùng cùng service, không tạo HTTP hoặc cron.

## Luồng và giới hạn

Chiều thuận đọc Sheet, kiểm tra header, chuẩn bị cột hệ thống và ẩn ID, lập kế hoạch từng hàng,
ghi trạng thái chờ, batch tạo/cập nhật CRM rồi ghi ID/status/hash.
Chiều ngược chỉ truy vấn ID đã liên kết trên Sheet theo nhóm, cập nhật trường trong reverseColumns; không thêm hàng CRM mới.
Hàng nháp chưa có ID được tìm trùng bằng email hoặc phone. Nếu một liên hệ khớp duy nhất,
hàng được liên kết với Lead đó. Nhiều hàng có thể tham chiếu cùng Lead ID; chiều thuận ghi
tuần tự theo số dòng, chiều ngược cập nhật từng hàng. Nếu email và phone trỏ tới hai Lead
khác nhau, hàng báo lỗi để người vận hành đối chiếu.
Không đồng bộ xóa lead hoặc xóa hàng.

Hai lớp khóa bảo vệ forward, reverse, webhook và lưu mapping: hàng đợi trong process (HTTP/cron/webhook) và khóa tệp `data/sync.lock` (O_EXCL + heartbeat + thu hồi khóa quá hạn) giữa các process dùng chung volume, gồm server và CLI.
Chạy CLI khi server đang đồng bộ sẽ nhận 409 `SYNC_LOCKED` thay vì ghi đè nhau. Khóa tệp KHÔNG bảo vệ các bản sao trên máy khác nhau không chung ổ đĩa; khi đó cần khóa phân tán (Redis/PostgreSQL advisory lock).
Đọc lại snapshot và so hash TRƯỚC mọi thao tác ghi; lệch thì dừng với `SHEET_CHANGED_DURING_SYNC` và không ghi gì (kể cả trạng thái).

Reverse dùng DATE_MODIFY và hash. bitrix_wins ưu tiên CRM khi cả hai phía thay đổi;
sheet_wins giữ dữ liệu Sheet. Khi SYNC_DIRECTION=both, forward kiểm tra DATE_MODIFY trước khi ghi hàng đã liên kết có thay đổi.
Với forward, chỉ đẩy dữ liệu Sheet, không tự kéo ngược CRM.
Ưu tiên CRM kéo trường được chọn trước, giữ hash cho thay đổi cục bộ còn chờ đẩy. Hai API không có giao dịch nguyên tử; thay đổi bên ngoài giữa lúc đọc/ghi vẫn là giới hạn.

Lệnh batch ghi CRM không replay tự động sau timeout; job sau tra trùng trước khi tạo.
Retry dành cho lỗi tạm thời khi đọc và các lệnh con batch bị xác nhận từ chối với QUERY_LIMIT_EXCEEDED.
Không gửi lại các lệnh đã thành công. Timeout/mất phản hồi ghi không được replay tự động.
Không bảo đảm exactly-once giữa hai dịch vụ, đặc biệt với dòng thiếu cả email và phone.
Log kỹ thuật ghi console. SyncHistoryService lưu 100 lần chạy gần nhất trong data/sync-history.json, API quản trị có xác thực cho phép xem trên UI. Không có endpoint /sync/status.

## Tương thích sau dọn dẹp

Mapping dạng fields/dedupeColumns vẫn đọc được, chuyển trong bộ nhớ sang
columns/transforms/dedupFields. additionalFields giữ ánh xạ một cột tới nhiều field.
additionalFields chỉ bổ sung payload chiều thuận; chiều ngược dùng reverseColumns, mặc định chỉ status và assigned user nếu chưa khai báo.
Nếu TITLE và NAME khác nhau trên CRM, cấu hình reverseColumns để chọn field ưu tiên cho cột chung.
Admin trả định dạng chuẩn; khi lưu, file sẽ được viết theo định dạng chuẩn.
Không tự đổi mapping trên đĩa khi khởi động.

Giữ alias GOOGLE_WORKSHEET_NAME và GOOGLE_SHEET_WORKSHEET_NAME;
GOOGLE_AUTH_MODE nhận oauth và oauth2; cron nhận SYNC_CRON và SYNC_CRON_EXPRESSION.
SYNC_DIRECTION chọn hướng cron và bật kiểm tra xung đột chiều thuận khi bằng both.
SYNC_CONFLICT_RESOLUTION cũ không còn được dùng.
Dùng CONFLICT_RESOLUTION_STRATEGY=bitrix_wins hoặc sheet_wins cho kiểm tra xung đột hai chiều.

Các engine/client/controller/CLI trùng và test riêng của chúng đã được bỏ.
Test service chính, regression, linked-conflict, lịch sử, HTTP webhook, Admin và performance được duy trì.
app-wiring.spec.ts kiểm tra module thật với external client được mock.
mapping-compat.spec.ts kiểm tra chuyển mapping không mất TITLE/NAME.

Bản sao trước khi dọn: cleanup-backup-20260927.zip (không chứa .env hoặc credentials).
Không đưa bản sao này vào bản bàn giao hoặc image Docker.

## Production safety notes

- Lead creation uses a durable write-ahead journal. Deterministic Bitrix `result_error` responses release the pending create; transport failures or missing batch results remain fail-closed until reconciled.
- Before CRM writes, pending Sheet rows are read again and their mapped-data hash is revalidated. If a row was edited, sorted, inserted or removed in a way that changes the planned row, the run aborts with `SHEET_CHANGED_DURING_SYNC` instead of writing a Lead ID to a potentially wrong row.
- The in-process sync lock serializes cron/HTTP/webhook work inside one Node process. Deploy this service as a single writer per Sheet. Multi-replica deployments require a distributed lock (for example Redis/PostgreSQL advisory locking) before enabling more than one writer.
- The production Docker image runs as the unprivileged `node` user. Runtime secrets must be mounted/provided at deployment time and are intentionally excluded from the submission archive.

## Webhook, bảo mật HTTP (bản cập nhật)

- Webhook `POST /webhooks/bitrix24/leads` chỉ xác thực + ACK 202 ngay; việc kéo dữ liệu chạy nền qua hàng đợi có **gộp sự kiện** (trùng ID chỉ xử lý một lần; nhiều ID gộp thành một lượt kéo toàn Sheet) và **retry tối đa 3 lần** với backoff. Hàng đợi ở bộ nhớ: sự kiện chưa xử lý khi process chết được bù bởi lịch đồng bộ ngược.
- Journal chỉ được giải phóng khi CRM **từ chối rõ ràng** một lệnh tạo. `MISSING_RESULT` và `UNCERTAIN_WRITE` (mất phản hồi) luôn giữ journal (fail-closed) để không tạo lead trùng.
- Xác thực sai nhiều lần (API key: 10 lần / 5 phút / IP; webhook: 20 lần) bị khóa tạm với 429 + `retryAfterSeconds`.
- Header bảo mật bằng helmet, CSP chặt cho Admin UI; Swagger mặc định tắt ở production (`ENABLE_SWAGGER=true` để bật).
- Dependency: các lỗ hổng mức cao đã được vá bằng `overrides` (lodash, multer, js-yaml, qs, file-type, body-parser). Còn 8 cảnh báo mức trung bình chỉ khắc phục được bằng nâng major NestJS 12 / googleapis 182; đã theo dõi, chưa nâng vì rủi ro hồi quy.
