import { assertProductionConfig, productionConfigErrors } from './production-guard';

const good = {
  NODE_ENV: 'production',
  ADMIN_API_KEY: 'a'.repeat(32),
  TIKTOK_WEBHOOK_SECRET: 'b'.repeat(32),
  BITRIX24_MOCK: 'false',
  TIKTOK_EVENTS_API_URL: 'https://business-api.tiktok.com/events',
  TIKTOK_ACCESS_TOKEN: 'd'.repeat(32),
  BITRIX24_WEBHOOK_URL: 'https://acme.bitrix24.com/rest/1/abcdef123456/',
  BITRIX24_APP_TOKEN: 'c'.repeat(24),
} as NodeJS.ProcessEnv;

describe('production config guard', () => {
  it('thiếu cấu hình conversion thật không được tự chuyển sang mock dù Bitrix24 đang mock', () => {
    const env = { ...good, BITRIX24_MOCK: 'true', TIKTOK_EVENTS_API_URL: '', TIKTOK_ACCESS_TOKEN: '' };
    expect(productionConfigErrors(env)).toHaveLength(2);
    expect(productionConfigErrors({ ...env, TIKTOK_EVENTS_MOCK: 'true' })).toEqual([]);
  });
  it.each(['invalid', 'http://example.com/events', 'https://user:pass@example.com/events'])(
    'chặn URL conversion không an toàn %s',
    (url) => {
      expect(productionConfigErrors({ ...good, TIKTOK_EVENTS_API_URL: url })).toHaveLength(1);
    },
  );
  it('không chặn development/test', () => {
    expect(productionConfigErrors({ NODE_ENV: 'development' })).toEqual([]);
    expect(productionConfigErrors({})).toEqual([]);
    expect(() => assertProductionConfig({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('chấp nhận cấu hình production đầy đủ', () => {
    expect(productionConfigErrors(good)).toEqual([]);
    expect(() => assertProductionConfig(good)).not.toThrow();
  });

  it('từ chối thiếu ADMIN_API_KEY và secret mặc định/yếu', () => {
    const errors = productionConfigErrors({ ...good, ADMIN_API_KEY: '', TIKTOK_WEBHOOK_SECRET: 'change-me' });
    expect(errors).toHaveLength(2);
    expect(errors.join(' ')).toContain('ADMIN_API_KEY');
    expect(errors.join(' ')).toContain('TIKTOK_WEBHOOK_SECRET');
    expect(productionConfigErrors({ ...good, ADMIN_API_KEY: 'short' })).toHaveLength(1);
  });

  it('khi dùng Bitrix24 thật yêu cầu URL HTTPS hợp lệ và app token', () => {
    expect(productionConfigErrors({ ...good, BITRIX24_WEBHOOK_URL: 'http://x.com/rest/1/a/' })).toHaveLength(1);
    expect(productionConfigErrors({ ...good, BITRIX24_WEBHOOK_URL: 'https://x.com/rest/1/a' })).toHaveLength(1);
    expect(
      productionConfigErrors({
        ...good,
        BITRIX24_WEBHOOK_URL: 'https://your-portal.bitrix24.com/rest/1/your-inbound-webhook/',
      }),
    ).toHaveLength(1);
    expect(productionConfigErrors({ ...good, BITRIX24_APP_TOKEN: 'change-me' })).toHaveLength(1);
  });

  it('bỏ qua kiểm tra Bitrix24 khi chạy mock', () => {
    expect(
      productionConfigErrors({ ...good, BITRIX24_MOCK: 'TRUE', BITRIX24_WEBHOOK_URL: '', BITRIX24_APP_TOKEN: '' }),
    ).toEqual([]);
  });

  it('assert ném lỗi liệt kê từng vấn đề', () => {
    expect(() => assertProductionConfig({ NODE_ENV: 'production' })).toThrow(
      /Cấu hình production không an toàn[\s\S]*ADMIN_API_KEY/,
    );
  });
});
