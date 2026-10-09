# Tích hợp TikTok Lead Generation với Bitrix24 CRM

Ứng dụng backend xây dựng bằng **NestJS (TypeScript)**, tự động tiếp nhận khách hàng tiềm năng (Lead) từ TikTok Lead Generation, xử lý và đồng bộ dữ liệu sang Bitrix24 CRM.

Hệ thống hỗ trợ quản lý Lead/Deal, tự động hóa quy trình chuyển đổi, phân tích hiệu quả chiến dịch và xuất báo cáo.

Ứng dụng cung cấp REST API và giao diện Swagger tại `/docs`, không bao gồm frontend riêng.

## 1. Công nghệ sử dụng

| Thành phần | Công nghệ |
|---|---|
| Backend | NestJS, TypeScript |
| Database | PostgreSQL |
| Queue / Cache | Redis, BullMQ |
| CRM | Bitrix24 REST API |
| Lead Generation | TikTok Webhook |
| API Documentation | Swagger / OpenAPI |
| Testing | Jest, Integration, E2E |
| Deployment | Docker, Docker Compose |

## 2. Chức năng chính

### Tiếp nhận và xử lý Lead

- Tiếp nhận webhook TikTok và xác thực chữ ký.
- Lưu payload gốc, chống xử lý trùng sự kiện.
- Chuẩn hóa email, số điện thoại và thông tin khách hàng.
- Gộp dữ liệu liên hệ và chấm điểm chất lượng Lead.
- Xử lý bất đồng bộ qua BullMQ, hỗ trợ retry và phục hồi sự kiện.

### Tích hợp Bitrix24 CRM

- Tạo hoặc cập nhật Lead trên Bitrix24.
- Mapping linh hoạt giữa dữ liệu TikTok và trường CRM.
- Tự động tạo Deal theo quy tắc cấu hình.
- Phân công nhân viên và quản lý trạng thái Deal.
- Đồng bộ hai chiều trạng thái Deal qua webhook.
- Hỗ trợ đối soát bản ghi nhằm hạn chế tạo trùng khi retry.

### Quản trị và báo cáo

- REST API quản lý Lead, Deal và cấu hình.
- Quản lý phiên đăng nhập bằng Redis.
- Nhập dữ liệu theo lô.
- Thống kê tỷ lệ chuyển đổi, CPL và ROI.
- Cập nhật thống kê qua Server-Sent Events (SSE).
- Xuất báo cáo CSV, JSON và XLSX.
- Hỗ trợ gửi báo cáo định kỳ và đồng bộ sự kiện chuyển đổi qua outbox.

## 3. Hướng dẫn chạy nhanh

### 3.1. Yêu cầu môi trường

- Docker Desktop hoặc Docker Engine.
- Docker Compose.
- Git để tải source code.

### 3.2. Cấu hình môi trường

Sao chép file `.env.example` thành `.env`.

**Windows PowerShell:**

```powershell
Copy-Item .env.example .env
```

**Linux / macOS:**

```bash
cp .env.example .env
```

Để chạy demo mà không cần kết nối Bitrix24 thực tế, cấu hình trong `.env`:

```dotenv
BITRIX24_MOCK=true
TIKTOK_EVENTS_MOCK=true
MOCK_LEADS_ENABLED=false
```

**Lưu ý:** `.env.example` mặc định có `BITRIX24_MOCK=false`. Cần chỉnh lại trước khi chạy demo offline.

Chế độ này sử dụng Bitrix24 mock tích hợp trong ứng dụng, không yêu cầu container mock riêng.

### 3.3. Khởi động hệ thống

```bash
docker compose up -d --build
```

Docker Compose khởi động ứng dụng cùng PostgreSQL và Redis, đồng thời thực hiện migration theo cấu hình hiện tại.

Các cổng phát triển được bind vào `127.0.0.1`.

### 3.4. Truy cập hệ thống

| Dịch vụ | Đường dẫn |
|---|---|
| Swagger UI | http://localhost:3000/docs |
| Health Check | http://localhost:3000/health |
| OpenAPI JSON | http://localhost:3000/docs-json |

### 3.5. Demo TikTok Webhook

Trong Swagger:

1. Mở endpoint `POST /webhooks/tiktok/leads`.
2. Sử dụng body `{}` và chữ ký trống trong chế độ demo được cấu hình ở trên.
3. Gửi request.
4. Kiểm tra HTTP response `202 Accepted`.
5. Đợi BullMQ xử lý dữ liệu.
6. Kiểm tra danh sách Lead và Deal qua API.

Nếu hệ thống cấu hình `ADMIN_API_KEY`, cần nhập API key trong mục **Authorize** của Swagger trước khi gọi các endpoint được bảo vệ.

**Lưu ý bảo mật:** Cơ chế sinh webhook demo chỉ dành cho môi trường thử nghiệm. Không sử dụng yêu cầu chữ ký trống với cấu hình production.

## 4. Kiểm thử

Theo kết quả kiểm thử được ghi nhận ngày **09/10/2026**:

| Loại kiểm thử | Kết quả |
|---|---:|
| Unit Tests | 308 PASS |
| E2E Tests | 4 PASS |
| Integration Tests | 27 PASS |
| **Tổng cộng** | **339 PASS** |

Để chạy môi trường integration test độc lập:

```powershell
docker compose -p ads_tiktok_test -f docker-compose.test.yml up -d --wait
npm.cmd run test:integration -- --no-cache
```

Môi trường test sử dụng:

| Dịch vụ | Cổng test | Cổng app |
|---|---:|---:|
| PostgreSQL | 55432 | 5432 |
| Redis | 56379 | 6379 |

Môi trường test được tách riêng nhằm tránh ảnh hưởng đến database và Redis của ứng dụng.

Nếu gặp lỗi cổng đã sử dụng, mật khẩu hoặc kết nối database, tham khảo tài liệu hướng dẫn.

Kết quả kiểm thử chi tiết, coverage và giới hạn xác minh được trình bày trong `docs/RESULTS.md`.

**Phạm vi xác minh:** Kết quả kiểm thử tự động không đồng nghĩa hệ thống đã được nghiệm thu với TikTok production hoặc đạt yêu cầu hiệu năng production.

## 5. Tài liệu dự án

| Tài liệu | Nội dung |
|---|---|
| [Hướng dẫn sử dụng](docs/GUIDE.md) | Cài đặt, demo, API, triển khai và xử lý lỗi |
| [Kiến trúc hệ thống](docs/ARCHITECTURE.md) | Luồng xử lý, module, database và quyết định kỹ thuật |
| [Tài liệu tích hợp](docs/INTEGRATIONS.md) | TikTok, Bitrix24, xác thực, mapping và webhook |
| [Kết quả kiểm thử](docs/RESULTS.md) | Test, coverage, Docker và giới hạn kiểm chứng |
| [Lộ trình Production](docs/PRODUCTION-ROADMAP.md) | Bảo mật, monitoring, CI/CD, scalability và kế hoạch cải tiến |

Tài liệu API được cung cấp qua Swagger UI tại `/docs`.

OpenAPI JSON có thể lấy từ `/docs-json`. File `swagger.json` trong repository là bản xuất phục vụ bàn giao và cần được cập nhật khi API thay đổi.

## 6. Các quyết định kỹ thuật

| Quyết định | Mục đích |
|---|---|
| NestJS Modular Architecture | Phân tách trách nhiệm, tăng khả năng bảo trì và kiểm thử |
| PostgreSQL | Đảm bảo tính toàn vẹn dữ liệu và hỗ trợ transaction |
| Redis / BullMQ | Xử lý webhook bất đồng bộ, retry và giảm phụ thuộc thời gian phản hồi CRM |
| Inbox / Outbox | Hỗ trợ lưu và xử lý sự kiện đáng tin cậy hơn |
| Idempotency / Advisory Lock | Hạn chế tạo bản ghi CRM trùng khi xử lý đồng thời |
| Mock Services | Cho phép kiểm thử khi chưa có quyền truy cập API thực tế |
| Docker Compose | Chuẩn hóa môi trường chạy và kiểm thử |

Chi tiết về kiến trúc, giới hạn và các đánh đổi kỹ thuật được mô tả trong [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 7. Định hướng triển khai Production

Hệ thống hiện ưu tiên các chức năng cốt lõi, chất lượng source code, kiểm thử và tài liệu.

Trước khi triển khai production, cần tiếp tục:

- Xác minh webhook và chữ ký theo đặc tả TikTok chính thức.
- Kiểm thử tích hợp với Bitrix24 portal thực tế.
- Bảo vệ secrets, API quản trị và vô hiệu hóa các endpoint mock.
- Bổ sung giám sát, cảnh báo và quy trình khôi phục.
- Hoàn thiện CI/CD, backup, rollback và kiểm thử tải.
- Đánh giá khả năng mở rộng khi chạy nhiều instance.

Các cải tiến được phân loại theo mức ưu tiên **P0, P1 và P2** trong [Production Deployment Roadmap](docs/PRODUCTION-ROADMAP.md).

## 8. Phạm vi dự án

Dự án được xây dựng nhằm đáp ứng bài kiểm tra kỹ thuật tích hợp TikTok Lead Generation với Bitrix24 CRM.

Phạm vi ưu tiên bao gồm:

- Hoàn thiện các chức năng cốt lõi.
- Đảm bảo kiến trúc dễ bảo trì và mở rộng.
- Cung cấp kiểm thử tự động.
- Hỗ trợ mock services để trình diễn và xác minh logic.
- Tài liệu hóa các quyết định kỹ thuật và giới hạn hiện tại.
- Đề xuất lộ trình nâng cấp trước khi vận hành production.

Hệ thống chưa được tuyên bố là đã hoàn tất nghiệm thu production.