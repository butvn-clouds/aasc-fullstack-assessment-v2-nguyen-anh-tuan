# Nghiệm thu API thật — 29/09/2026

Build thành công image `gg_shets-sync-service:latest` từ source mới. Chạy các service
đã biên dịch bên trong container dùng image này, với Google Sheets và Bitrix thật.
Không chạy cron trong container nghiệm thu; app chính vẫn giữ cấu hình riêng.

## Dữ liệu và kết quả

Tab thử: `ACCEPTANCE_20260929141040695`. Lead thử: **11**.
Kết quả máy đọc: `data/acceptance/20260929141040695/result.json` (không commit thư mục data).

| Tình huống                    | Kết quả thực tế                                          |
| ----------------------------- | -------------------------------------------------------- |
| Tạo dữ liệu thử               | Tạo 1 Lead, ID 11                                        |
| Dòng mới trùng email          | Tạo 0, cập nhật 1, giữ ID 11                             |
| Dòng mới trùng điện thoại     | Tạo 0, cập nhật 1, giữ ID 11                             |
| 3 dòng cùng Lead ID           | Cập nhật 3, tách 3 batch; tiêu đề CRM bằng dòng ghi cuối |
| Chạy lại không sửa dữ liệu    | Bỏ qua 3; không gọi batch ghi CRM                        |
| Đồng bộ ngược nhiều dòng      | Cập nhật cả 3 dòng liên kết cùng Lead                    |
| Hai bên cùng sửa, bitrix_wins | Phát hiện 1 xung đột; Sheet và CRM giữ tiêu đề từ CRM    |
| Chạy lại sau bitrix_wins      | Bỏ qua 1; không gọi batch ghi CRM                        |
| Hai bên cùng sửa, sheet_wins  | Phát hiện 1 xung đột; Sheet và CRM giữ tiêu đề từ Sheet  |
| Chạy lại sau sheet_wins       | Bỏ qua 1; không gọi batch ghi CRM                        |

Các assertion đọc lại dữ liệu từ cả Sheet và CRM. Bộ nghiệm thu này dùng mapping
riêng với TITLE, EMAIL, PHONE, STATUS_ID; không xác nhận mọi custom field của portal.

Lần chạy đầu bị cấu hình môi trường `both` ghi đè ý định `forward` trong script,
nên dừng ở assertion; đã sửa script để đặt biến trong process của container thử rồi
chạy lại toàn bộ thành công. Dữ liệu lần đầu còn ở tab `ACCEPTANCE_20260929140921109`,
Lead **9**. Giữ cả hai bộ thử để đối chiếu; không tự xóa Lead hoặc tab.

## Webhook và hai chiều

Trong phiên kiểm tra trước, request thật `ONCRMLEADUPDATE` lúc **03:11:37 UTC**
(10:11:37 Việt Nam) trả **202 Accepted**, `totalChecked=1`, `pulledDown=1`,
`errors=0`, `conflicts=1`. Trước đó webhook trả 401 vì token không khớp; sau khi
đồng bộ token và tạo lại container đã nhận và xử lý thành công.

Đây là bằng chứng webhook end-to-end đã ghi nhận trước đợt build này; các ca ưu tiên
ở bảng trên gọi service trực tiếp để kiểm soát xung đột, không giả nhận là sự kiện
webhook mới. Real-time yêu cầu ngrok/public HTTPS hoạt động và token portal khớp app.
Chiều Sheet sang CRM dùng cron/thủ công theo yêu cầu; không có trigger sửa ô real-time.

## Tái lập

Chỉ chạy có chủ đích: script tạo tab mới và Lead thử mới, giữ lại sau khi chạy.

```powershell
docker compose build sync-service
docker compose run --rm --no-deps -v "${PWD}/scripts/live-acceptance.js:/app/live-acceptance.js:ro" sync-service node /app/live-acceptance.js
```

Giới hạn: chưa đo tải API thật 150+ dòng, chưa thử sự cố mạng kéo dài hoặc nhiều
instance ghi cùng Sheet. Test tự động gần nhất: 25 suites, 231 tests passed.
