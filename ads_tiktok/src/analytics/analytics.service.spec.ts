import { AnalyticsService, parseDateRange, rate, toCsv } from './analytics.service';
import { ConfigService } from '@nestjs/config';

describe('analytics helpers', () => {
  it('rate xử lý chia 0', () => {
    expect(rate(1, 0)).toBe(0);
    expect(rate(1, 4)).toBe(0.25);
  });
  it('parseDateRange', () => {
    const d = Date.now() - parseDateRange('7d').getTime();
    expect(Math.round(d / 86400000)).toBe(7);
    expect(() => parseDateRange('bad')).toThrow('date_range');
  });
  it('toCsv escape và chặn formula injection', () => {
    const csv = toCsv([{ name: '=cmd()', note: 'a,"b"' }]);
    expect(csv).toBe(`name,note\n'=cmd(),"a,""b"""`);
    expect(toCsv([])).toBe('');
  });
});

describe('AnalyticsService metrics', () => {
  const rows = [
    { campaign_id: 'campaign-1', leads: 10, deals: 4, won: 2, revenue: 3000000, avg_score: 75.25 },
    { campaign_id: null, leads: 0, deals: 0, won: 0, revenue: 0, avg_score: 0 },
  ];
  const query = jest.fn().mockResolvedValue(rows);
  const service = new AnalyticsService(
    { query } as any,
    { get: async () => ({ 'campaign-1': 1000000 }) } as any,
    new ConfigService({ BITRIX24_MOCK: 'true' }),
  );
  it('calculates conversion rates and protects empty denominators', async () => {
    const result = await service.conversionRates();
    expect(result.overall).toMatchObject({
      leads: 10,
      deals: 4,
      won: 2,
      lead_to_deal: 0.4,
      lead_to_won: 0.2,
      deal_to_won: 0.5,
    });
    expect(result.campaigns[1].lead_to_deal).toBe(0);
  });
  it('calculates CPL and ROI from configured campaign costs', async () => {
    const result = await service.campaignPerformance();
    expect(result[0]).toMatchObject({ cost_per_lead: 100000, roi: 2, avg_lead_score: 75.3 });
    expect(result[1]).toMatchObject({ cost_per_lead: 0, roi: null });
  });

  it('không tính ROI khi doanh thu chứa ngoại tệ chưa quy đổi', async () => {
    query.mockResolvedValueOnce([{ ...rows[0], revenue: null }]);
    const result = await service.campaignPerformance();
    expect(result[0]).toMatchObject({ revenue: null, roi: null, revenue_valid: false, currency: 'VND' });
  });
  it('exports parameterized rows and accepts week/month ranges', async () => {
    await expect(service.exportLeads()).resolves.toBe(rows);
    expect(Math.round((Date.now() - parseDateRange('2w').getTime()) / 86400000)).toBe(14);
    expect(Math.round((Date.now() - parseDateRange('2m').getTime()) / 86400000)).toBe(60);
    expect(toCsv([{ date: new Date('2026-01-01'), missing: null, text: 'plain' }])).toContain(
      '2026-01-01T00:00:00.000Z,,plain',
    );
  });
});
