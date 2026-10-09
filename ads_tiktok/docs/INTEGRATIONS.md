# Tích hợp TikTok và Bitrix24

[Về README](../README.md) · [Hướng dẫn](GUIDE.md) · [Kiến trúc](ARCHITECTURE.md)

## Phân biệt các bên

| Bên                       | Vai trò                     | Đường dẫn                                                  |
| ------------------------- | --------------------------- | ---------------------------------------------------------- |
| TikTok → ứng dụng         | Gửi lead và tương tác       | `POST /webhooks/tiktok/leads`                              |
| Ứng dụng → Bitrix24       | Tạo/cập nhật CRM            | REST `crm.lead.*`, `crm.deal.*` qua webhook URL của portal |
| Bitrix24 → ứng dụng       | Báo deal thay đổi           | `POST /webhooks/bitrix24/deals`                            |
| Ứng dụng → TikTok         | Gửi chuyển đổi khi deal won | `TIKTOK_EVENTS_API_URL`                                    |
| Người quản trị → ứng dụng | Quản lý dữ liệu và báo cáo  | `/api/v1/*`                                                |
| Người thử → ứng dụng      | Công cụ giả lập             | `/mock/*`, không phải API chính thức của hai nền tảng      |

## TikTok

`TIKTOK_WEBHOOK_SECRET` dùng xác thực header `TikTok-Signature: t=<unix>,s=<hex>`. Chữ ký HMAC-SHA256 trên chuỗi `t.rawBody`, dung sai `TIKTOK_SIGNATURE_TOLERANCE_SEC` mặc định 300 giây. Đây là giao thức của dự án, chưa xác nhận tương thích chữ ký TikTok production.

Payload ví dụ:

```json
{
  "event": "lead.generate",
  "event_id": "evt_demo_unique_001",
  "timestamp": 1791446400,
  "advertiser_id": "7123456789",
  "campaign": {
    "campaign_id": "campaign_demo",
    "campaign_name": "[DEMO] Laptop Sale",
    "ad_id": "ad_demo",
    "ad_name": "Quảng cáo laptop"
  },
  "form": { "form_id": "form_demo", "form_name": "Đăng ký tư vấn" },
  "lead_data": {
    "full_name": "Nguyễn Văn An",
    "email": "demo@example.com",
    "phone": "+84901234567",
    "city": "Hà Nội",
    "utm_source": "tiktok",
    "utm_campaign": "laptop_sale",
    "ttclid": "TT-demo-unique-001"
  },
  "custom_questions": [{ "question": "Budget range", "answer": "15-25 triệu VND" }]
}
```

Khi gửi thật, thay ID sự kiện, ttclid, timestamp và ký lại bằng timestamp hiện tại; ví dụ trên chỉ mô tả cấu trúc, không phải yêu cầu đã ký. Sự kiện hỗ trợ: `lead.generate`, `form.complete`, `user.interact`. Payload do generator tạo có thêm `mock: true` để cho phép ước lượng ngân sách demo.

Khi thử sự kiện tương tác, dùng `event_id` mới và giữ `lead_data.ttclid` trùng `externalId` của lead đã lưu. Có thể dùng cùng cấu trúc payload trên và đổi `event` thành `form.complete` hoặc `user.interact`, rồi ký lại toàn bộ body. Gửi lại cùng event ID không được cộng điểm lần hai. Sự kiện đến trước khi có lead phù hợp không được giữ chờ ghép; hiện worker bỏ qua phần cộng điểm. Tương tác chưa tự kích hoạt đồng bộ CRM/xét lại rule.

Swagger tự ký thông qua endpoint nội bộ `/mock/tiktok/signed-request` khi bật `BITRIX24_MOCK` hoặc `MOCK_LEADS_ENABLED`. Endpoint này chuẩn bị body/chữ ký, chưa tạo lead; request tiếp theo mới gửi webhook. Ngoài chế độ demo, tự gọi webhook phải có chữ ký HMAC hợp lệ trên đúng byte body.

| Phản hồi        | Ý nghĩa                                                     |
| --------------- | ----------------------------------------------------------- |
| 401             | Chữ ký thiếu/sai/quá hạn                                    |
| 400             | Cấu trúc bắt buộc không hợp lệ                              |
| 202 + duplicate | Event đã nhận trước đó                                      |
| 202             | Đã nhận; xem worker và webhook events để biết kết quả xử lý |

Chuyển đổi thật cần `TIKTOK_EVENTS_MOCK=false`, URL HTTPS và `TIKTOK_ACCESS_TOKEN`. Thiếu cấu hình không được xem là gửi thành công. Với `TIKTOK_EVENTS_MOCK=true`, kết quả là `mocked`, không có `sent_at`; đây là chế độ riêng với `BITRIX24_MOCK`.

## Bitrix24

Chế độ thật: `BITRIX24_MOCK=false`, `BITRIX24_WEBHOOK_URL=https://<portal>/rest/<user>/<secret>/`. URL này chứa thông tin xác thực, không đưa vào tài liệu/log công khai.

Chuẩn bị portal:

1. Dùng CRM có lead nếu cần theo dõi lead riêng.
2. Tạo nguồn tên TikTok, mã `TIKTOK` trong danh mục `SOURCE`.
3. Tạo các trường tùy chỉnh lead kiểu chuỗi theo bảng dưới và xác nhận bằng `crm.lead.fields`.
4. Bổ sung tiền tệ VND; chọn tỷ giá đúng theo đồng tiền cơ sở. Công cụ `src/tools/configure-vnd.ts` hỗ trợ portal cơ sở USD, chạy xem trước trước khi dùng `--apply`; không tự cập nhật tỷ giá hằng ngày.
5. Kiểm tra pipeline, stage, nhân viên trong rules khớp portal. Mặc định source dùng pipeline `0`, stage `NEW`, xác suất theo điểm lead; yêu cầu có liên hệ và điểm từ 70, từ 85 ưu tiên cao; cấu hình DB cũ có thể khác.
6. Cấu hình outbound webhook về URL HTTPS công khai `/webhooks/bitrix24/deals`, đặt `BITRIX24_APP_TOKEN` trùng application token.

| Trường TikTok            | Trường CRM mặc định   |
| ------------------------ | --------------------- |
| `lead_data.full_name`    | `NAME`                |
| `lead_data.email`        | `EMAIL[0][VALUE]`     |
| `lead_data.phone`        | `PHONE[0][VALUE]`     |
| `lead_data.city`         | `UF_CRM_CITY`         |
| `campaign.campaign_name` | `UF_CRM_UTM_CAMPAIGN` |
| `campaign.ad_name`       | `UF_CRM_AD_NAME`      |
| `lead_data.ttclid`       | `UF_CRM_TTCLID`       |

Đổi mapping qua `PUT /api/v1/config/mappings`, nhận đối tượng mapping hoặc `{"field_mapping":{...}}`. Trường tồn tại nhưng không hiện trên giao diện cần được thêm vào bố cục biểu mẫu lead. Đổi mapping không tự cập nhật bản ghi cũ.

Nguồn lead/deal là `SOURCE_ID=TIKTOK`; định danh tích hợp `ORIGINATOR_ID=tiktok-integration`, `ORIGIN_ID` là UUID lead nội bộ. Lead lưu ID CRM của mode hiện tại, deal phân biệt mode `mock`/`real`/`legacy`.

Số tiền khi đồng bộ ưu tiên deal đã liên kết, rồi `rule.amount`, rồi ngân sách payload demo. Lead chỉ gửi `OPPORTUNITY` và VND khi xác định được amount; tạo deal gửi `amount ?? 0`. Lead thật không có rule amount sẽ không bị ước lượng ngân sách tự động. Tiền của bản ghi cũ chỉ thay đổi khi được đồng bộ/cập nhật; sửa code không tự backfill.

Webhook cập nhật deal:

```json
{
  "event": "ONCRMDEALUPDATE",
  "auth": { "application_token": "<BITRIX24_APP_TOKEN>" },
  "data": { "FIELDS": { "ID": "27" } }
}
```

ID là `bitrix24Id`, không phải UUID. Server đọc `crm.deal.get` để lấy trạng thái/số tiền; nội dung webhook không quyết định trực tiếp trạng thái. Khi won, outbox tạo chuyển đổi với event key ổn định để tránh ghi trùng.

## Mock và dữ liệu thật

| Cấu hình                  | Kết quả                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `BITRIX24_MOCK=true`      | CRM giả lập lưu PostgreSQL trong cùng app                                 |
| `MOCK_LEADS_ENABLED=true` | Tự sinh webhook TikTok, vẫn đi qua chữ ký và queue                        |
| Generator + CRM thật      | Cần `MOCK_LEADS_ALLOW_REAL_CRM=true`; tạo lead/deal demo thật trên portal |
| `TIKTOK_EVENTS_MOCK=true` | Không gọi API conversion thật; đánh dấu mocked                            |

Nguồn TikTok giả lập không bắt buộc CRM giả lập và ngược lại. Dữ liệu demo được tính vào báo cáo; nên dùng database/portal thử riêng khi đánh giá số liệu.

## Quy tắc và phân công

`GET/PUT /api/v1/config/rules` đọc/ghi mảng hoặc `{"deal_rules":[...]}`. Rule hỗ trợ điều kiện, pipeline/stage, amount, xác suất cố định hoặc `probability_mode=lead_score`, phân công theo cấu hình. API convert-to-deal xếp job, không trả kết quả tạo CRM đồng bộ ngay.

Rule được xét theo thứ tự, chọn **rule đầu tiên khớp**. Muốn giữ phân loại hiện tại, đặt mức 85 trước mức 70. Ví dụ đầy đủ để đưa vào `PUT /api/v1/config/rules` (thay user ID/pipeline/stage bằng giá trị có trong portal):

```json
{
  "deal_rules": [
    {
      "name": "Lead ưu tiên cao",
      "condition": "lead.contactable == true AND lead.score >= 85",
      "action": "create_deal",
      "pipeline_id": "0",
      "stage_id": "NEW",
      "probability": 85,
      "probability_mode": "lead_score",
      "priority": "high",
      "assign_to": { "strategy": "fixed", "users": [1] }
    },
    {
      "name": "Lead đủ điều kiện",
      "condition": "lead.contactable == true AND lead.score >= 70",
      "action": "create_deal",
      "pipeline_id": "0",
      "stage_id": "NEW",
      "probability": 70,
      "probability_mode": "lead_score",
      "priority": "normal",
      "assign_to": { "strategy": "round_robin", "users": [1] }
    }
  ]
}
```

Rule engine hỗ trợ các mệnh đề nối bằng `AND`; toán tử `CONTAINS`, `NOT_CONTAINS`, `EQUALS`, `==`, `!=`, `>=`, `<=`, `>`, `<`. Đây không phải trình chạy JavaScript/SQL tùy ý. Round-robin dùng bộ đếm Redis theo pipeline/stage; mảng một user luôn chọn user đó. Probability theo điểm là quy tắc demo, không phải xác suất thống kê đã hiệu chỉnh.

`PUT` thay thế cấu hình tương ứng, không tự ghép thêm vào cấu hình cũ. Trước khi sửa nên đọc và lưu JSON từ `GET`; đổi rule không tự quét lại mọi lead cũ, đổi mapping không tự backfill CRM.

Mapping/rules/costs lưu PostgreSQL và cache Redis 60 giây; API cập nhật xóa khóa cache liên quan. Không thay rule trực tiếp trong source rồi kỳ vọng ghi đè cấu hình DB.

Tham chiếu API portal: [nguồn CRM](https://apidocs.bitrix24.com/api-reference/crm/status/crm-status-add.html), [trường tùy chỉnh lead](https://apidocs.bitrix24.com/api-reference/crm/leads/userfield/index.html). Các quy ước và giới hạn nêu trên được đối chiếu từ source của dự án.
