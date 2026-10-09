import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function createApiDocument(
  app: INestApplication,
  bitrixMock = process.env.BITRIX24_MOCK?.toLowerCase() === 'true',
) {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Khách hàng tiềm năng TikTok → Bitrix24')
      .setDescription(
        'API tích hợp TikTok → Bitrix24. API quản trị dùng X-API-Key hoặc phiên Bearer; webhook có xác thực riêng.',
      )
      .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'admin')
      .addSecurityRequirements('admin')
      .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'session')
      .addSecurityRequirements('session')
      .addTag('Khách hàng & giao dịch', 'Danh sách, chi tiết, nhập khách hàng và chuyển thành giao dịch.')
      .addTag('Thống kê & báo cáo', 'Chuyển đổi, hiệu quả chiến dịch, số liệu trực tiếp và xuất báo cáo.')
      .addTag('Cấu hình', 'Ánh xạ trường, quy tắc tạo giao dịch và chi phí chiến dịch.')
      .addTag('Webhook', 'TikTok gửi khách hàng; Bitrix24 gửi cập nhật giao dịch. Tra cứu trạng thái tiếp nhận.')
      .addTag('Chạy thử', 'Giả lập Bitrix24 và kiểm tra chuyển đổi; yêu cầu BITRIX24_MOCK=true.')
      .addTag('Hệ thống', 'Phiên đăng nhập quản trị và kiểm tra kết nối.')
      .setVersion('1.0')
      .build(),
  );
  if (!bitrixMock) {
    for (const path of Object.keys(document.paths)) {
      if (path.startsWith('/mock/bitrix24/')) delete document.paths[path];
    }
    document.tags = document.tags?.filter((tag) => tag.name !== 'Chạy thử');
  }
  return document;
}
