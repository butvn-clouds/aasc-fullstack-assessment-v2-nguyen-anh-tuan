# Bản sửa v2 — danh sách thay đổi

| #   | Vấn đề ở bản `fixed_95`                                                                      | Cách sửa                                                                                        | Kiểm chứng                                                              |
| --- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | `npm run build` lỗi TS2345 (`sync.service.ts:125`), 9/25 suite không chạy, Docker build hỏng | Type guard `PendingPlan`                                                                        | tsc/eslint/prettier/build sạch; 28/28 suite, 254 test                   |
| 2   | Journal bị giải phóng với `MISSING_RESULT`/`UNCERTAIN_WRITE` (nguy cơ tạo lead trùng)        | Chỉ giải phóng khi CRM từ chối rõ ràng (`UNCERTAIN_ERROR_CODES`)                                | 2 test `it.each` + chạy lại không gọi `crm.lead.add` lần 2              |
| 3   | Revalidate xảy ra sau khi ghi "Chờ xử lý" → dòng mồ côi                                      | Revalidate trước mọi thao tác ghi                                                               | Test: không ghi gì khi snapshot đổi                                     |
| 4   | Khóa chỉ trong 1 process                                                                     | Thêm khóa tệp `data/sync.lock` (O_EXCL, heartbeat, thu hồi khóa quá hạn, chỉ xóa khóa của mình) | 5 unit test + chạy thật: CLI exit 1, HTTP 409 khi process khác giữ khóa |
| 5   | Webhook chờ sync xong mới trả lời                                                            | ACK 202 ngay, hàng đợi nền có gộp sự kiện + retry ≤3 lần                                        | 6 test hàng đợi; đo thật 202 trong ~30 ms                               |
| 6   | Không chống dò API key                                                                       | `FailureLimiter`: 10 lần sai/5 phút/IP → 429 + `retryAfterSeconds` (webhook: 20 lần)            | Test + chạy thật: lần sai thứ 11 → 429, kể cả gửi đúng key              |
| 7   | Không có header bảo mật; Swagger mở                                                          | helmet + CSP chặt cho Admin; Swagger tắt mặc định ở production (`ENABLE_SWAGGER`)               | Test header + chạy thật `/docs` → 404                                   |
| 8   | 4 lỗ hổng mức cao trong dependency                                                           | `overrides` (lodash, multer, js-yaml, qs, file-type, body-parser)                               | `npm audit --omit=dev`: high 4 → 0                                      |
| 9   | Thông báo `UPSTREAM_TIMEOUT` gây hiểu nhầm; CLI không nói rõ khi bị khóa                     | Viết lại thông báo; thêm mã `SYNC_LOCKED`                                                       | Test `publicError`                                                      |
| 10  | Thư mục rác, `ngrok:latest`, tài liệu mâu thuẫn                                              | Xóa thư mục rác, ghim `ngrok/ngrok:3`, cập nhật README/ARCHITECTURE/.env.example                | —                                                                       |

| 11 | Chạy test nặng RAM (4 worker ≈ 3,9 GB, ~260 s, sập trên máy 4 GB) | ts-jest `isolatedModules`, `maxWorkers` 50%, `workerIdleMemoryLimit`, coverage V8, tách test hiệu năng, thêm `typecheck` và `verify` | Cùng 254 test: ~1,9 GB, ~19 s; typecheck vẫn bắt lỗi build cũ (TS2345) |

## Chưa xử lý (cần người nộp bài làm)

- Video demo < 5 phút.
- Chạy nghiệm thu **live** với Google Sheets + Bitrix24 thật cho các thay đổi ở #2–#5 (môi trường kiểm tra không có credentials).
- 8 cảnh báo mức trung bình còn lại cần nâng major NestJS 12 / googleapis 182.
- Khóa tệp không bảo vệ các bản sao chạy trên máy khác nhau không chung ổ đĩa (cần Redis/PostgreSQL lock).
- Hàng đợi webhook ở bộ nhớ (được bù bởi lịch đồng bộ ngược nếu process chết).
- Cửa sổ race còn lại rất nhỏ giữa lúc revalidate và lúc ghi Lead ID về Sheet.
