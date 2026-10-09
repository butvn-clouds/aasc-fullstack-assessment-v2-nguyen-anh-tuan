# Vận hành đồng bộ Lead

Ứng dụng xử lý Lead (`crm.lead.*`). Portal phải dùng Classic CRM: mỗi job kiểm tra
`crm.settings.mode.get` trước khi đọc/ghi Sheet. Simple CRM tự chuyển Lead thành
đối tượng khác nên ứng dụng dừng với `CRM_SIMPLE_MODE`. `CONVERTED` nghĩa là Lead
đã chuyển đổi, không phải giai đoạn thắng của giao dịch.
Xem [tài liệu chế độ CRM của Bitrix24](https://apidocs.bitrix24.com/tutorials/crm/how-to-add-crm-objects/how-to-add-objects-with-crm-mode.html).

## Phục hồi khi tạo Lead bị gián đoạn

`data/create-journal.json` lưu hash, số dòng và ID đã nhận, không lưu nội dung khách
hàng hoặc token. Thư mục theo `SYNC_HISTORY_DIR`; phải giữ volume `data` khi chạy Docker.
Chạy một instance cho cùng Sheet, không chạy CLI song song với server.

- Nếu nhận được ID nhưng ghi Sheet thất bại, lần chạy sau dùng lại ID để cập nhật.
- Nếu mất phản hồi khi tạo, ứng dụng tra cứu email/điện thoại. Không tìm được kết quả
  xác định thì báo `RECOVERY_UNCERTAIN`, không tự gửi lại lệnh tạo.
- Đối chiếu Lead trên portal, nhập ID đúng vào cột `Lead ID Bitrix24`, rồi chạy lại.
  Không xóa journal để bỏ qua cảnh báo. Nếu xác nhận Lead chưa được tạo, cần người
  vận hành đối chiếu bản ghi journal trước khi xử lý thủ công.
- Không sắp xếp, xóa hoặc chèn dòng khi job chạy hoặc khi còn bản ghi chờ phục hồi.
  `RECOVERY_ROW_CHANGED` yêu cầu đối chiếu dòng/ID. Journal không thay thế transaction
  giữa hai hệ thống và không bảo đảm chống trùng khi chạy nhiều process.
- `RECOVERY_STORAGE_ERROR`: kiểm tra quyền ghi, dung lượng và tính hợp lệ của journal;
  giữ bản sao để đối chiếu, không tự đặt lại file rỗng.

## Kiểm tra trước khi nộp bài

```sh
npm ci
npm run format:check
npm run verify
```

`verify` chạy lint, build và test coverage. API trong test được mock; cần chạy kịch
bản [DEMO.md](DEMO.md) trên portal/Sheet thử nghiệm để xác nhận quyền ghi và webhook.
CLI trả exit code 1 nếu job có lỗi. `lint:fix` và `format` là lệnh sửa source.

Đặt `MANAGEMENT_API_KEY` thành khóa riêng; giá trị mẫu `replace_with_random_api_key`
bị từ chối. Khi đổi biến môi trường của Docker, tạo lại container để áp dụng.
File example không tự thay thế `config/mapping.json`; kiểm tra mapping đang dùng trước demo.

## Giới hạn và hiệu năng

Ở chế độ hai chiều, forward lấy các Lead liên kết theo nhóm thay vì gọi từng dòng.
Lệnh ghi Bitrix tối đa 50 phần tử/batch; Google chia ghi thành nhóm 500 vùng ô và có
timeout 30 giây. Giới hạn này không phải cam kết throughput trên portal thực.
Giữ nguyên email/điện thoại dạng văn bản; ô optional trống không xóa trường CRM.
Reverse chỉ cập nhật Lead đã liên kết; không nhập toàn bộ CRM hoặc đồng bộ xóa.
