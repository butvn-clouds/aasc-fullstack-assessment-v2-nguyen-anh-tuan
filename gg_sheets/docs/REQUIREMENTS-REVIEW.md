# Đối chiếu source với đề Google Sheets ↔ Bitrix24

Ngày cập nhật: 29/09/2026. Phạm vi: source `gg_shets`, test local, Docker và các ca API thật
được ghi tại [LIVE-ACCEPTANCE.md](LIVE-ACCEPTANCE.md).

## 1. Phân tích đề

MVP bắt buộc là **Sheet → CRM**: tạo/cập nhật đúng Lead, chống trùng bằng email hoặc phone,
ghi ID và trạng thái về Sheet, phát hiện thay đổi bằng hash, chạy cron và kích hoạt thủ công.
Độ đúng chiếm 40%, chất lượng code 25%, độ tin cậy/hiệu năng 20%; cần ưu tiên ba nhóm này.

Google cần hỗ trợ **cả Service Account và OAuth2**. Bitrix cho phép **webhook hoặc OAuth2**,
nên việc chọn Inbound webhook đáp ứng yêu cầu xác thực; không bắt buộc thêm OAuth Bitrix.
Conflict resolution cho phép chiến lược ưu tiên một bên; không bắt buộc last-write-wins.

Nâng cao gồm reverse sync, webhook realtime, xử lý enum/multi-value/normalization/validation
và Admin. Source đã có cả bốn nhóm; cần kiểm tra tính nhất quán với MVP và kiểm thử thực tế.

## 2. Ma trận yêu cầu

| Yêu cầu                                       | Triển khai / bằng chứng                                                               | Kết luận và giới hạn                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Đọc 9 cột dữ liệu chuẩn, mapping/custom field | `google-sheets.service.ts`, `mapping-config.service.ts`, `config/mapping.json`        | Có; tên custom field phải tồn tại trên portal                                                                        |
| Tạo/cập nhật Lead                             | `sync.service.ts`, `bitrix24-client.service.ts`, TC1/TC2 trong `sync.service.spec.ts` | Có; chỉ nhận ID hợp lệ khi tạo thành công                                                                            |
| Chống trùng email **hoặc** phone              | `crm.duplicate.findbycomm`, `regressions.spec.ts`                                     | Có; nhiều match hoặc email/phone trỏ hai Lead thì báo lỗi, không tự gộp                                              |
| Lead ID ẩn, pending/success/error/time/hash   | `ensureLayout`, `writeStatusBatch`                                                    | Đã sửa: chuẩn bị trước ghi CRM, luôn ẩn ID kể cả mapping cũ                                                          |
| Logging từng lượt/từng dòng                   | console, `SyncHistoryService`, Admin history                                          | Có số tạo/cập nhật/skip/lỗi, chi tiết từng dòng; lịch sử lưu 100 lượt, tối đa 50 lỗi/lượt                            |
| Cron và manual HTTP/CLI                       | `sync-scheduler.service.ts`, controller, CLI                                          | Có; cron cấu hình hướng forward/reverse/both                                                                         |
| Google Service Account + OAuth2               | `GoogleSheetsService.buildClient`                                                     | Có; cần xác nhận credentials/quyền bằng nghiệm thu live                                                              |
| Google range/batch/format detection           | đọc worksheet range, metadata ngày, batchUpdate RAW                                   | Có; trường ngày chuẩn hóa về ngày, không giữ giờ                                                                     |
| Bitrix REST + batch                           | client, tối đa 50 lệnh/batch                                                          | Có; `crm.lead.list` dùng đọc Lead, phương thức chuyên dụng dùng tra trùng                                            |
| Rate limit/backoff/retry                      | limiter, retry util, `batch-retry.spec.ts`                                            | Có; retry giới hạn, backoff tối đa 60 giây; chỉ replay lệnh ghi bị xác nhận từ chối vì quota                         |
| Idempotency                                   | Lead ID/hash, tra trùng, khóa chung                                                   | Có trong điều kiện ID hoặc liên hệ có thể đối chiếu; không bảo đảm exactly-once giữa hai API                         |
| Cấu hình/bảo vệ credentials                   | `.env.example`, mapping, API key guard, webhook token guard, ignore files             | Có; không đọc/ghi lại secrets trong đợt review này; chưa thể kiểm tra lịch sử Git vì thư mục hiện chưa là repository |
| Reverse và conflict                           | `two-way-sync.service.ts`, `linked-conflict.spec.ts`                                  | Có; chỉ Lead đã liên kết, chỉ trường được chọn, bitrix_wins/sheet_wins                                               |
| Realtime webhook                              | controller + guard + `webhook-http.spec.ts`                                           | Có endpoint và test HTTP; cần URL HTTPS công khai và thử sự kiện portal thật                                         |
| Advanced transforms                           | enum, multi_value, number, date, email/phone, required                                | Có; bổ sung mẫu nâng cao và giữ date/enum/reverse khi đọc mapping legacy                                             |
| Web Admin                                     | `src/admin`, API cấu hình/history/manual/check connection                             | Có; API key, form mapping + JSON, validation; test DOM không thay kiểm tra giao diện trên browser                    |
| Coverage ≥70%                                 | Jest đặt ngưỡng 70% cho statements/branches/functions/lines                           | Xem kết quả kiểm tra cuối bên dưới                                                                                   |
| Performance 100+                              | `sync.service.performance.spec.ts`, CSV 150 dòng                                      | Có test 150 dòng, giới hạn batch; số đo mock không đại diện tốc độ API live                                          |
| Deliverables                                  | README, architecture, JSON/env/CSV, Docker, API reference, test plan                  | Có trong workspace; chưa khởi tạo Git repository hoặc remote; video chưa được tạo                                    |

Tra trùng dùng phương thức chuyên dụng để so khớp thông tin liên hệ thay vì tìm chuỗi con.
Tham khảo [Bitrix duplicate API](https://apidocs.bitrix24.com/api-reference/crm/duplicates/crm-duplicate-find-by-comm.html).
Retry lệnh con dựa trên mã lỗi do CRM trả về; xem [Bitrix error codes](https://apidocs.bitrix24.com/error-codes.html).
Giới hạn thời gian backoff phù hợp hướng dẫn [Google Sheets usage limits](https://developers.google.com/workspace/sheets/api/limits).

## 3. Những điểm sai đã sửa

1. **MVP kéo ngược ngoài ý muốn:** trước đây forward cũng áp dụng bitrix_wins, có thể ghi CRM về Sheet.
   Nay chỉ bật kiểm tra xung đột chiều thuận khi `SYNC_DIRECTION=both`.
2. **Ghi CRM trước khi chuẩn bị Sheet:** thiếu cột trạng thái hoặc Sheet không cho ghi có thể khiến Lead đã tạo
   nhưng chưa lưu ID. Nay layout/ẩn ID và ghi trạng thái chờ phải thành công trước lệnh ghi CRM.
3. **Lead ID/header không an toàn:** chặn header trùng và ID sai; nhiều hàng cùng ID được cập nhật tuần tự theo số dòng;
   không lưu `null`, `0`, boolean hoặc object thành Lead ID.
4. **Batch bỏ qua retry lỗi quota:** chỉ gửi lại lệnh con bị `QUERY_LIMIT_EXCEEDED`, có giới hạn/backoff;
   giữ kết quả thành công, không gửi lại lệnh tạo sau mất phản hồi.
5. **Mapping validation thiếu:** chặn cột hệ thống đè dữ liệu, nhiều cột trạng thái chung tên,
   nhiều nguồn ghi cùng CRM field, đường dẫn field sai và multi-value sai cú pháp.
6. **Chuyển legacy mất thông tin:** giữ reverseColumns, enum values, separator và date.
7. **Cấu hình retry/concurrency không hợp lệ:** báo lỗi rõ thay vì âm thầm bỏ xử lý;
   Bitrix đọc các biến retry chung thay vì số cố định.
8. **CSV/README không khớp code:** sửa mẫu owner dạng tên, trạng thái tiếng Việt thiếu enum;
   cập nhật kiến trúc/hướng sync; thêm lệnh test performance và sửa script e2e trỏ file không tồn tại.

## 4. Phần nâng cao và cách dùng

- Đặt `SYNC_DIRECTION=both` để cron chạy reverse rồi forward với conflict policy.
- `config/mapping.advanced.example.json` có enum tiếng Việt, nhiều email/phone,
  ngày hẹn custom field, reverse status/owner, một cột ra TITLE + NAME.
- Map tên người phụ trách bằng enum `values` tên → ID nếu không muốn nhập ID vào Sheet.
- Webhook có token riêng `BITRIX24_WEBHOOK_SECRET`; lấy URL công khai qua `PUBLIC_BASE_URL`.
- Admin lưu mapping có hiệu lực ngay, có lịch sử và kiểm tra kết nối.

Không tự thay `mapping.json` đang chạy hoặc `.env` bằng file mẫu. Portal phải có custom field phù hợp.

## 5. Kiểm tra và nghiệm thu

Các lệnh tái lập (PowerShell có thể dùng `npm.cmd`):

```sh
npm ci
npm run build
npm run test:cov -- --runInBand
npm run test:performance
npm run test:e2e
```

Kết quả trên bản sửa ngày 29/09/2026:

| Kiểm tra                                                | Kết quả                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run build`                                         | Thành công                                                                                 |
| `npm run test:cov -- --runInBand`                       | **25 suites, 231 tests passed**                                                            |
| Statements                                              | **88.65%**                                                                                 |
| Branches                                                | **74.74%**                                                                                 |
| Functions                                               | **86.89%**                                                                                 |
| Lines                                                   | **90.12%**                                                                                 |
| ESLint toàn bộ src/test (không tự sửa)                  | Thành công, không có lỗi/cảnh báo                                                          |
| Performance 150 dòng và HTTP integration                | Đã chạy trong bộ test trên                                                                 |
| `docker compose --env-file .env.example config --quiet` | Hợp lệ; Docker cảnh báo không đọc được cấu hình người dùng, nhưng lệnh kiểm tra trả exit 0 |

Báo cáo HTML local: `coverage/lcov-report/index.html`. Các ngưỡng 70% giữ nguyên,
không loại thêm file để nâng số coverage. Đã build image mới và tạo lại container app.

Đã nghiệm thu tạo/cập nhật, chống trùng email/phone, nhiều dòng cùng Lead, hai chính sách
xung đột và chạy lại không ghi CRM trên API thật. Chi tiết, dữ liệu thử và phạm vi webhook:
[LIVE-ACCEPTANCE.md](LIVE-ACCEPTANCE.md). Chưa kiểm tra mọi custom field hoặc tải thật 150+ dòng.
Kịch bản quay video: [DEMO.md](DEMO.md).

## 6. Giới hạn cần trình bày khi bảo vệ bài

- Khóa chỉ trong một process; không chạy đồng thời nhiều instance/CLI cho cùng Sheet.
- Không có transaction giữa Google và Bitrix. Nếu tạo Lead thành công nhưng mất ID và dòng không có
  email/phone, cần đối chiếu thủ công. Recovery journal hiện lưu ID đã nhận và chặn tạo lại khi kết quả chưa rõ;
  xem [hướng dẫn phục hồi Lead](LEAD-OPERATIONS.md). CRM không cung cấp idempotency key trong luồng này.
- Không đồng bộ xóa; reverse chỉ cập nhật Lead ID liên kết; không tự import toàn bộ CRM.
- Không đổi thứ tự dòng khi job đang xử lý snapshot. Hai bên sửa giữa đọc/ghi vẫn có rủi ro xung đột.
- Webhook xử lý đồng bộ trong request; tải lớn cần hàng đợi bền vững. Cron reverse là đường đối chiếu bổ sung.
- Bộ test API dùng mock. Không thể tuyên bố đã nghiệm thu live hoặc đo quota thực tế từ test này.
- Ô optional để trống được bỏ qua trong payload, không mang nghĩa xóa giá trị CRM.
  Nếu cần đồng bộ thao tác xóa trường, phải thiết kế quy tắc clear riêng theo kiểu field.

## MVP acceptance boundary

Luồng bắt buộc và mặc định là `SYNC_DIRECTION=forward`: Google Sheets -> Bitrix24. Reverse sync, webhook realtime và conflict resolution là bonus, được giữ tách biệt và không phải điều kiện để forward sync hoạt động.

MVP được coi là đạt khi TC1-TC4 đều pass, Lead ID/status/time/hash được ghi lại đúng, dedup email/phone không tạo lead trùng, retry/batch không replay ambiguous create, và dataset 100+ records vượt performance test.
