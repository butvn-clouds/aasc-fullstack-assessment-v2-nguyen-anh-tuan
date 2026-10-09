import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { createApiDocument } from './swagger';

@Controller('ping')
class PingController {
  @Get() ping() {
    return 'pong';
  }
}

@ApiTags('Chạy thử')
@Controller('mock/bitrix24')
class MockCrmController {
  @Get('conversions') conversions() {
    return [];
  }
}

describe('createApiDocument', () => {
  it('tạo tài liệu OpenAPI có thông tin dự án, API key và Bearer session', async () => {
    const module = await Test.createTestingModule({ controllers: [PingController, MockCrmController] }).compile();
    const app = module.createNestApplication();
    await app.init();

    const doc = createApiDocument(app, false);

    expect(doc.info.title).toContain('TikTok');
    expect(doc.info.version).toBe('1.0');
    expect(doc.paths['/ping']).toBeDefined();
    expect(doc.paths['/mock/bitrix24/conversions']).toBeUndefined();
    expect(doc.components?.securitySchemes).toMatchObject({ admin: { type: 'apiKey' }, session: { type: 'http' } });
    expect(doc.tags?.map((t) => t.name)).toContain('Khách hàng & giao dịch');
    expect(doc.tags?.map((t) => t.name)).not.toContain('Chạy thử');
    const mockDoc = createApiDocument(app, true);
    expect(mockDoc.paths['/mock/bitrix24/conversions']).toBeDefined();
    expect(mockDoc.tags?.map((t) => t.name)).toContain('Chạy thử');
    await app.close();
  });
});
