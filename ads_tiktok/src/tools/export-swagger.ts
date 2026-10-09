import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'fs';
import { AppModule } from '../app.module';
import { createApiDocument } from '../swagger';
import { signSwaggerDemoRequest } from '../tiktok/swagger-demo';

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
  try {
    // Kiểm tra hàm đã biên dịch có thể chuyển thành chuỗi mà không phụ thuộc mô-đun.
    new Function(`return (${signSwaggerDemoRequest.toString()})`)();
    writeFileSync('swagger.json', JSON.stringify(createApiDocument(app), null, 2));
    console.log('Đã xuất swagger.json');
  } finally {
    await app.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
