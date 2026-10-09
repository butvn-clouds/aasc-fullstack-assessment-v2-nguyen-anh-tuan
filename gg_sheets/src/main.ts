import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { applySecurity, swaggerEnabled } from './common/security';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  applySecurity(app);
  const configService = app.get(ConfigService<AppConfig, true>);
  const { port } = configService.get('server', { infer: true });
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Sheets ↔ Bitrix24')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'api-key')
    .build();
  const docsOn = swaggerEnabled();
  if (docsOn) SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(port);
  Logger.log(`API đồng bộ Bitrix24 và Google Sheets đang chạy tại http://localhost:${port}`, 'Bootstrap');
  Logger.log(`Trang quản trị: http://localhost:${port}/admin`, 'Bootstrap');
  if (docsOn) Logger.log(`Tài liệu API: http://localhost:${port}/docs`, 'Bootstrap');
  else Logger.log('Tài liệu Swagger đang tắt ở chế độ production. Đặt ENABLE_SWAGGER=true để bật.', 'Bootstrap');
}

bootstrap();
