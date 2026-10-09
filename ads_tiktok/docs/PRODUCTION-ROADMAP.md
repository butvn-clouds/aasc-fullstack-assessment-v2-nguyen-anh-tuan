# LỘ TRÌNH NÂNG CẤP VÀ TRIỂN KHAI PRODUCTION

**Dự án:** TikTok Lead Generation → Bitrix24 CRM  
**Nền tảng:** NestJS, PostgreSQL, Redis, BullMQ, Docker  
**Loại tài liệu:** Đề xuất cải tiến và định hướng triển khai production

---

## 1. Tổng quan

Tài liệu này trình bày những cải tiến được đề xuất nhằm đưa hệ thống tích hợp TikTok Lead Generation với Bitrix24 CRM từ môi trường phát triển, kiểm thử và trình diễn lên môi trường production.

Hệ thống hiện tại tập trung vào các yêu cầu cốt lõi:

- Tiếp nhận dữ liệu khách hàng tiềm năng từ TikTok thông qua webhook.
- Kiểm tra, chuẩn hóa và chống xử lý trùng dữ liệu.
- Lưu trữ dữ liệu trong PostgreSQL.
- Xử lý bất đồng bộ bằng Redis và BullMQ.
- Tạo hoặc cập nhật Lead trên Bitrix24 CRM.
- Tự động chuyển đổi Lead thành Deal theo quy tắc.
- Theo dõi trạng thái đồng bộ, phân tích chiến dịch và xuất báo cáo.
- Hỗ trợ dịch vụ mock để kiểm thử khi chưa có quyền truy cập API thực tế.

Mục tiêu của lộ trình là nâng cao tính bảo mật, độ tin cậy, khả năng giám sát, phục hồi và mở rộng hệ thống.

**Phạm vi:** Đây là kế hoạch đề xuất cho production. Các hạng mục chưa được triển khai hoặc kiểm chứng không được xem là chức năng đã hoàn thành.

## 2. Kiến trúc hệ thống hiện tại

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| Backend | NestJS / TypeScript | REST API, webhook, nghiệp vụ |
| Database | PostgreSQL | Lưu Lead, Deal, cấu hình và lịch sử |
| Queue | Redis / BullMQ | Xử lý bất đồng bộ, retry |
| TikTok Integration | Webhook | Tiếp nhận sự kiện Lead Generation |
| Bitrix24 Integration | REST API / Webhook | Đồng bộ Lead, Deal và trạng thái CRM |
| Analytics | API / Reporting | Phân tích hiệu quả chiến dịch |
| Deployment | Docker Compose | Chạy ứng dụng và các dịch vụ phụ thuộc |
| Testing | Jest | Unit, integration và E2E tests |

### 2.1. Những điểm đã được thiết kế

- Kiến trúc module tách biệt trách nhiệm.
- Xử lý webhook bất đồng bộ nhằm giảm thời gian phản hồi.
- Chuẩn hóa email, số điện thoại và dữ liệu khách hàng.
- Chống trùng và đối soát dữ liệu CRM.
- Cơ chế retry khi gặp lỗi tạm thời.
- Phân loại chất lượng Lead và áp dụng quy tắc chuyển đổi Deal.
- Hỗ trợ môi trường mock để phát triển và kiểm thử.

### 2.2. Những giới hạn hiện tại

- Chưa xác minh đầy đủ khả năng tương thích với TikTok API production.
- Kết quả kiểm thử mock chưa thay thế được nghiệm thu Bitrix24 thực tế.
- Chưa có bằng chứng đầy đủ về hiệu năng khi xử lý lưu lượng lớn.
- Cần kiểm chứng khả năng phục hồi trong môi trường nhiều instance.
- Cần hoàn thiện quy trình vận hành, giám sát và triển khai production.

## 3. Phân loại mức độ ưu tiên

| Mức | Ý nghĩa | Thời điểm |
|---|---|---|
| P0 – Bắt buộc | Bảo mật, tính đúng đắn và tích hợp thực tế | Trước khi go-live |
| P1 – Quan trọng | Giám sát, phục hồi, tự động triển khai | Trước hoặc trong giai đoạn vận hành có kiểm soát |
| P2 – Mở rộng | Tối ưu hiệu năng và khả năng mở rộng | Khi có nhu cầu thực tế |

---

## 4. Giai đoạn 1 – Sẵn sàng Production (P0)

**Mục tiêu:** Đảm bảo hệ thống xử lý chính xác, an toàn và có khả năng khôi phục khi tích hợp với dịch vụ thực tế.

### 4.1. Bảo mật TikTok Webhook

Các cải tiến đề xuất:

- Xác minh cơ chế chữ ký webhook theo tài liệu chính thức của TikTok.
- Kiểm tra định dạng payload và các loại sự kiện được hỗ trợ.
- Kiểm tra timestamp và bảo vệ trước replay attack.
- Từ chối webhook có chữ ký không hợp lệ.
- Sử dụng event ID để chống xử lý trùng.
- Kiểm tra quyền truy cập và cấu hình ứng dụng TikTok production.

**Tiêu chí nghiệm thu:**

- Webhook hợp lệ được tiếp nhận và xử lý.
- Webhook không hợp lệ bị từ chối.
- Sự kiện gửi lại không tạo dữ liệu CRM trùng ngoài ý muốn.
- Payload thực tế được xử lý đúng mà không phụ thuộc định dạng mock.

### 4.2. Kiểm chứng tích hợp Bitrix24 thực tế

Các cải tiến đề xuất:

- Kiểm thử tạo và cập nhật Lead trên portal thực.
- Kiểm thử tạo Deal theo pipeline và stage.
- Xác minh standard fields và custom fields.
- Kiểm tra xử lý token hết hạn và lỗi xác thực.
- Xác minh rate limit và retry.
- Kiểm tra callback webhook từ Bitrix24.
- Đối soát bản ghi bằng `ORIGINATOR_ID` và `ORIGIN_ID`.

**Tiêu chí nghiệm thu:**

- Lead và Deal được đồng bộ đúng.
- Không tạo trùng trong các trường hợp retry đã hỗ trợ.
- Không liên kết Deal sang Lead không thuộc quyền sở hữu tương ứng.
- Lỗi CRM được ghi nhận và có phương án xử lý.

### 4.3. Tăng cường bảo mật ứng dụng

Các cải tiến đề xuất:

- Vô hiệu hóa hoặc giới hạn mock endpoints trong production.
- Không lưu token, mật khẩu và credentials trong Git.
- Sử dụng HTTPS cho các endpoint công khai.
- Bảo vệ API quản trị bằng xác thực và phân quyền.
- Giới hạn kích thước request và tốc độ gọi API.
- Ẩn dữ liệu nhạy cảm trong log.
- Quét lỗ hổng dependency trước khi phát hành.

**Tiêu chí nghiệm thu:**

- Không có secrets trong repository hoặc Docker image.
- API quản trị từ chối truy cập trái phép.
- Endpoint mock không thể bị sử dụng ngoài ý muốn.
- Không ghi token và thông tin khách hàng nhạy cảm vào log công khai.

### 4.4. Idempotency và khôi phục khi lỗi

Hệ thống đã có thiết kế đối soát origin và sử dụng PostgreSQL advisory lock nhằm hạn chế tạo trùng khi xử lý đồng thời.

Cần kiểm chứng thêm:

- Hai worker cùng xử lý một Lead.
- Timeout sau khi Bitrix24 đã tạo bản ghi thành công.
- Worker dừng giữa thao tác tạo CRM và lưu database.
- PostgreSQL phát sinh unique violation `23505`.
- TikTok gửi cùng một webhook nhiều lần.
- Tích hợp bên ngoài tạo bản ghi CRM mà không sử dụng cơ chế khóa của ứng dụng.

**Giới hạn kỹ thuật:** PostgreSQL advisory lock chỉ phối hợp các instance dùng chung database, không đảm bảo tính duy nhất tuyệt đối ở phía Bitrix24.

**Tiêu chí nghiệm thu:**

- Các trường hợp retry được hỗ trợ không tạo trùng ngoài ý muốn.
- Có thể tái sử dụng bản ghi CRM đã tồn tại khi đối soát thành công.
- Không làm mất dữ liệu khi xử lý lại job.
- Không cập nhật sai quan hệ giữa Lead và Deal.

---

## 5. Giai đoạn 2 – Độ tin cậy và vận hành (P1)

**Mục tiêu:** Giúp hệ thống dễ giám sát, triển khai và khôi phục khi xảy ra sự cố.

### 5.1. Monitoring và Alerting

Các chỉ số nên giám sát:

- Số lượng webhook nhận được.
- Tỷ lệ webhook thất bại.
- Thời gian xử lý mỗi webhook.
- Số lượng job đang chờ trong BullMQ.
- Số job retry và job thất bại.
- Thời gian phản hồi Bitrix24 API.
- Tỷ lệ đồng bộ CRM thành công.
- Tình trạng kết nối PostgreSQL và Redis.
- Tốc độ xử lý Lead và Deal.

Công nghệ có thể cân nhắc:

- Prometheus và Grafana để thu thập, hiển thị metrics.
- OpenTelemetry để theo dõi luồng xử lý.
- Hệ thống log tập trung để tra cứu lỗi.
- Alertmanager hoặc dịch vụ tương đương để cảnh báo.

Chỉ bổ sung những công cụ thực sự cần thiết theo quy mô triển khai.

### 5.2. CI/CD

Đề xuất xây dựng pipeline gồm:

1. Cài đặt dependency.
2. Kiểm tra TypeScript.
3. Kiểm tra ESLint và định dạng.
4. Chạy unit tests.
5. Chạy integration và E2E tests.
6. Quét lỗ hổng dependency.
7. Build Docker image.
8. Kiểm tra migration.
9. Triển khai lên môi trường staging.
10. Kiểm tra health trước khi phát hành production.

Cần có quy trình rollback khi phiên bản mới gây lỗi.

### 5.3. Sao lưu và phục hồi PostgreSQL

- Thiết lập lịch backup tự động.
- Lưu backup tại vị trí có kiểm soát truy cập.
- Mã hóa dữ liệu backup.
- Kiểm thử restore định kỳ.
- Xác định RPO và RTO phù hợp với nghiệp vụ.
- Tài liệu hóa quy trình khôi phục sau sự cố.

### 5.4. Kiểm thử hiệu năng

Các tình huống cần đo:

- Nhiều webhook được gửi đồng thời.
- Queue tích lũy số lượng lớn job.
- Bitrix24 API phản hồi chậm.
- Redis hoặc PostgreSQL tạm thời không khả dụng.
- Worker khởi động lại khi đang xử lý.
- Nhiều worker cùng truy cập một bản ghi.
- Analytics xử lý dữ liệu chiến dịch lớn.

Ngưỡng hiệu năng cần xác định dựa trên lưu lượng dự kiến và kết quả benchmark thực tế.

---

## 6. Giai đoạn 3 – Khả năng mở rộng và tối ưu (P2)

**Mục tiêu:** Nâng cao hiệu suất và đáp ứng nhu cầu tăng trưởng.

### 6.1. Horizontal Scaling

- Triển khai nhiều instance API.
- Tách worker khỏi API để mở rộng độc lập.
- Kiểm chứng advisory lock trong môi trường nhiều instance.
- Áp dụng distributed rate limiting.
- Cân nhắc Redis pub/sub cho các sự kiện real-time.
- Thiết lập giới hạn tài nguyên CPU và RAM.

### 6.2. Tối ưu PostgreSQL và Analytics

- Kiểm tra index cho các trường thường xuyên truy vấn.
- Phân tích truy vấn chậm bằng `EXPLAIN ANALYZE`.
- Cân nhắc cache hoặc bảng tổng hợp dữ liệu.
- Xử lý xuất báo cáo lớn bằng background jobs.
- Thiết lập chính sách lưu trữ và dọn dữ liệu cũ.

### 6.3. Cải tiến nghiệp vụ

- Tính lại lead score khi dữ liệu được bổ sung hoặc hợp nhất.
- Đánh giá lại quy tắc chuyển đổi Deal khi Lead thay đổi.
- Cho phép cấu hình scoring linh hoạt.
- Cải thiện thuật toán phân công nhân viên.
- Bổ sung audit trail cho các thao tác quan trọng.
- Tăng khả năng đối soát dữ liệu giữa hệ thống nội bộ và CRM.

---

## 7. Các quyết định kỹ thuật và đánh đổi

| Quyết định | Lý do lựa chọn | Đánh đổi |
|---|---|---|
| NestJS | Module hóa, dễ bảo trì và kiểm thử | Cần quản lý dependency giữa module |
| PostgreSQL | Transaction và ràng buộc dữ liệu | Cần backup, migration và giám sát |
| Redis / BullMQ | Xử lý bất đồng bộ và retry | Tăng số dịch vụ cần vận hành |
| Inbox/Outbox | Hỗ trợ xử lý sự kiện tin cậy hơn | Tăng độ phức tạp lưu trữ và xử lý |
| Advisory Lock | Hạn chế race condition giữa worker | Không kiểm soát tích hợp bên ngoài |
| Mock Services | Kiểm thử không phụ thuộc API thực | Không thay thế nghiệm thu production |
| Docker Compose | Dễ dựng môi trường đồng nhất | Không tự cung cấp khả năng orchestration production |

## 8. Checklist trước khi triển khai Production

### Tích hợp và nghiệp vụ

- [ ] Xác minh webhook TikTok với API chính thức.
- [ ] Kiểm thử Bitrix24 portal thực tế.
- [ ] Xác minh mapping và pipeline.
- [ ] Kiểm chứng chống trùng và retry.
- [ ] Kiểm tra toàn bộ business rules.

### Bảo mật

- [ ] Không có credentials trong Git.
- [ ] Mock endpoints được vô hiệu hóa hoặc bảo vệ.
- [ ] HTTPS được cấu hình.
- [ ] API quản trị được phân quyền.
- [ ] Dependency được quét bảo mật.

### Kiểm thử và vận hành

- [ ] Unit, integration và E2E tests PASS.
- [ ] Load test đạt ngưỡng đã xác định.
- [ ] Monitoring và alerting hoạt động.
- [ ] Backup và restore được kiểm chứng.
- [ ] Có hướng dẫn triển khai và rollback.
- [ ] Có quy trình xử lý sự cố.

## 9. Thứ tự triển khai đề xuất

**Trước khi Go-live:** Hoàn thành P0 và những yêu cầu vận hành P1 thiết yếu như backup, monitoring, kiểm soát triển khai và rollback.

**Sau khi vận hành ổn định:** Dựa trên số liệu thực tế để hoàn thiện các cải tiến P1 còn lại.

**Khi cần mở rộng:** Thực hiện P2 theo các điểm nghẽn được đo đạc, tránh bổ sung công nghệ không cần thiết.

## 10. Kết luận

Dự án TikTok Lead Generation → Bitrix24 CRM hiện tập trung vào chức năng cốt lõi, kiến trúc rõ ràng, khả năng kiểm thử và xử lý tích hợp bất đồng bộ.

Các cải tiến production được phân thành ba nhóm:

- **P0:** Bảo mật, tích hợp API thực và tính đúng đắn dữ liệu.
- **P1:** Giám sát, triển khai, sao lưu và phục hồi.
- **P2:** Mở rộng hiệu năng, tối ưu dữ liệu và cải tiến nghiệp vụ.

Lộ trình này giúp xác định rõ các bước cần thực hiện trước khi triển khai thực tế mà không làm tăng phạm vi không cần thiết của bài kiểm tra tuyển dụng.

**Lưu ý:** Những hạng mục trong roadmap là đề xuất phát triển tiếp theo, không phải cam kết rằng hệ thống hiện đã đạt đầy đủ tiêu chuẩn production.