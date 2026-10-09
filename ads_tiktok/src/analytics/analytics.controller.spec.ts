import { BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { ReportExportService } from './report-export.service';
import { Writable } from 'stream';

describe('AnalyticsController', () => {
  const analytics = { conversionRates: jest.fn(), campaignPerformance: jest.fn(), streamLeads: jest.fn() };
  function response() {
    const chunks: Buffer[] = [];
    const res = new Writable({
      write(chunk, _encoding, next) {
        chunks.push(Buffer.from(chunk));
        next();
      },
    });
    const result = Object.assign(res, { setHeader: jest.fn() });
    return { res: result as unknown as Response, body: () => Buffer.concat(chunks).toString() };
  }
  let controller: AnalyticsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AnalyticsController(
      analytics as unknown as AnalyticsService,
      { validate: jest.fn() } as any,
      {} as any,
      new ReportExportService(analytics as unknown as AnalyticsService),
    );
  });

  it('chuyển tiếp khoảng thời gian cho các endpoint phân tích', async () => {
    analytics.conversionRates.mockResolvedValueOnce({ total: 2 });
    analytics.campaignPerformance.mockResolvedValueOnce([{ campaign_id: 'campaign-1' }]);
    await expect(controller.conversion('7d')).resolves.toEqual({ total: 2 });
    await expect(controller.performance('30d')).resolves.toEqual([{ campaign_id: 'campaign-1' }]);
    expect(analytics.conversionRates).toHaveBeenCalledWith('7d');
    expect(analytics.campaignPerformance).toHaveBeenCalledWith('30d');
  });

  it('xuất dữ liệu dạng JSON', async () => {
    const rows = [{ id: 'lead-1', name: 'Customer' }];
    analytics.streamLeads.mockReturnValueOnce(
      (async function* () {
        yield* rows;
      })(),
    );
    const { res, body } = response();

    await controller.export('json', '7d', res);

    expect(analytics.streamLeads).toHaveBeenCalledWith('7d', expect.any(AbortSignal));
    expect(JSON.parse(body())).toEqual(rows);
  });

  it('xuất CSV kèm header tải về và từ chối định dạng không hỗ trợ', async () => {
    analytics.streamLeads.mockReturnValueOnce(
      (async function* () {
        yield { id: 'lead-1', name: 'Customer' };
      })(),
    );
    const { res, body } = response();

    await controller.export('csv', '14d', res);

    expect(res.setHeader).toHaveBeenNthCalledWith(1, 'Content-Type', 'text/csv; charset=utf-8');
    expect(res.setHeader).toHaveBeenNthCalledWith(2, 'Content-Disposition', 'attachment; filename="leads-14d.csv"');
    expect(body()).toBe('id,name\nlead-1,Customer');
    await expect(controller.export('xml', '30d', res)).rejects.toBeInstanceOf(BadRequestException);
  });
});
