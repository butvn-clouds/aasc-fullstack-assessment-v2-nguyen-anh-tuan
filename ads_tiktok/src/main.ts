import 'dotenv/config'; // nạp .env trước khi kiểm tra cấu hình production (không ghi đè biến môi trường có sẵn)
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { AppModule } from './app.module';
import { assertProductionConfig } from './config/production-guard';
import { createApiDocument } from './swagger';
import { signSwaggerDemoRequest } from './tiktok/swagger-demo';
import { docsCss, docsScript } from './docs/setup';
import { docsPlugin } from './docs/swagger-plugin';

async function bootstrap() {
  assertProductionConfig();
  // rawBody: true để guard xác thực chữ ký trên đúng bytes TikTok đã ký
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.enableShutdownHooks();

  const doc = createApiDocument(app);
  SwaggerModule.setup('docs', app, doc, {
    customSiteTitle: 'TikTok → Bitrix24 | Tài liệu API',
    customCss: docsCss,
    customJsStr: docsScript,
    swaggerOptions: {
      plugins: [docsPlugin],
      docExpansion: 'none',
      filter: true,
      defaultModelsExpandDepth: -1,
      displayRequestDuration: true,
      ...(process.env.BITRIX24_MOCK?.toLowerCase() === 'true' ||
      process.env.MOCK_LEADS_ENABLED?.toLowerCase() === 'true'
        ? { requestInterceptor: signSwaggerDemoRequest }
        : {}),
    },
  });
  if (process.env.EXPORT_SWAGGER === 'true') writeFileSync('swagger.json', JSON.stringify(doc, null, 2));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
