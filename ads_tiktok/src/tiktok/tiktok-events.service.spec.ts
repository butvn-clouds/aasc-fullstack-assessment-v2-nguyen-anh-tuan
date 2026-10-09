import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DataSource } from 'typeorm';
import { TikTokEventsService } from './tiktok-events.service';

jest.mock('axios', () => ({ post: jest.fn() }));

describe('TikTokEventsService', () => {
  const configValues: Record<string, string | undefined> = {};
  let service: TikTokEventsService;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(configValues)) delete configValues[key];
    service = new TikTokEventsService(
      { get: (key: string) => configValues[key] } as unknown as ConfigService,
      {} as DataSource,
    );
  });

  it.each([
    ['', ''],
    ['https://business-api.tiktok.com/events', ''],
    ['', 'token'],
    ['   ', 'token'],
  ])('thiếu URL/token thật phải báo lỗi, không gửi HTTP (%s)', async (url, token) => {
    configValues.TIKTOK_EVENTS_API_URL = url;
    configValues.TIKTOK_ACCESS_TOKEN = token;
    await expect(service.sendConversion({ event: 'CompletePayment' })).rejects.toThrow('chưa gửi conversion');
    expect(axios.post).not.toHaveBeenCalled();
  });
  it.each(['invalid', 'http://example.com/events', 'https://user:pass@example.com/events'])(
    'chặn URL thật không hợp lệ %s',
    async (url) => {
      configValues.TIKTOK_EVENTS_API_URL = url;
      configValues.TIKTOK_ACCESS_TOKEN = 'test-token';
      await expect(service.sendConversion({ event: 'CompletePayment' })).rejects.toThrow();
      expect(axios.post).not.toHaveBeenCalled();
    },
  );

  it('chỉ giả lập khi TIKTOK_EVENTS_MOCK được bật rõ ràng', async () => {
    configValues.TIKTOK_EVENTS_MOCK = 'true';
    await expect(service.sendConversion({ event: 'CompletePayment', ttclid: 'click-id', value: 25 })).resolves.toEqual({
      mock: true,
    });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('sends a conversion with access token and normalized default currency when configured', async () => {
    configValues.TIKTOK_EVENTS_API_URL = 'https://business-api.tiktok.com/events';
    configValues.TIKTOK_ACCESS_TOKEN = 'test-token';
    (axios.post as jest.Mock).mockResolvedValueOnce({ data: { code: 0 } });

    await expect(service.sendConversion({ event: 'CompletePayment', ttclid: 'click-id', value: 25 })).resolves.toEqual({
      code: 0,
      mock: false,
    });

    expect(axios.post).toHaveBeenCalledWith(
      'https://business-api.tiktok.com/events',
      expect.objectContaining({
        event: 'CompletePayment',
        context: { ad: { callback: 'click-id' } },
        properties: { value: 25, currency: 'VND' },
      }),
      { headers: { 'Access-Token': 'test-token' }, timeout: 10000 },
    );
  });

  it('preserves the supplied currency and propagates API failures', async () => {
    configValues.TIKTOK_EVENTS_API_URL = 'https://business-api.tiktok.com/events';
    configValues.TIKTOK_ACCESS_TOKEN = 'test-token';
    const failure = new Error('TikTok API unavailable');
    (axios.post as jest.Mock).mockRejectedValueOnce(failure);

    await expect(service.sendConversion({ event: 'Lead', currency: 'USD' })).rejects.toBe(failure);
    expect(axios.post).toHaveBeenCalledWith(
      'https://business-api.tiktok.com/events',
      expect.objectContaining({ properties: { value: undefined, currency: 'USD' } }),
      expect.any(Object),
    );
  });
});
