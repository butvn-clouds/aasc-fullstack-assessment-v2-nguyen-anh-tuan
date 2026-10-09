# Kịch bản video nghiệm thu dưới 5 phút

Trước demo, kiểm tra portal dùng Classic CRM và đọc [hướng dẫn vận hành Lead](LEAD-OPERATIONS.md).
Thao tác trên bản ghi Lead; `CONVERTED` có nghĩa đã chuyển đổi Lead.

Dùng Sheet và portal thử nghiệm; che URL webhook, token, thông tin khách thật.

1. **0:00–0:40**: Giới thiệu Sheet, mapping JSON, kiến trúc NestJS và Admin.
   Hiển thị `.env.example`, không hiển thị `.env` hoặc file credentials.
2. **0:40–1:30 — TC1/TC2**: Thêm lead, trigger ở Admin, mở CRM kiểm tra;
   hiển thị ID (tạm bỏ ẩn), trạng thái và thời gian. Sửa ghi chú, chạy lại để cập nhật.
3. **1:30–2:10 — TC3/idempotency**: Chạy lại không đổi → skipped.
   Thêm dòng cùng email → cập nhật Lead ID cũ, không tạo thêm lead.
4. **2:10–2:50 — TC4**: Nhập email sai ở một dòng, giữ dòng khác hợp lệ.
   Chạy và hiển thị lỗi từng dòng cùng số thành công/lỗi trên Admin.
   Retry mạng/quota được minh họa bằng `npm run test:cov -- --runInBand`, không cố làm quá tải API thật.
5. **2:50–3:50 — Nâng cao**: Bật `SYNC_DIRECTION=both` trước khi quay.
   Đổi status/assigned user trên CRM, nhận webhook hoặc chạy reverse để Sheet cập nhật.
   Minh họa enum nhãn và nhiều email. Webhook phải có bằng chứng sự kiện thật nếu tuyên bố realtime.
6. **3:50–4:40**: Hiển thị lịch sử, cấu hình cron, kết quả test coverage ≥70%,
   test 150 dòng, Docker và tài liệu đối chiếu đề.

Video thực tế, URL repository và kiểm thử live phải bổ sung khi bàn giao.
Test mock không chứng minh credentials, quota/gói Bitrix hoặc URL webhook công khai hoạt động.
