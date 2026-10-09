import { Workbook } from 'exceljs';
import { readFile } from 'fs/promises';
import { LEAD_COLUMNS, XLSX_TYPE } from './xlsx';
import { AnalyticsController } from './analytics.controller';
import { firstValueFrom } from 'rxjs';
import { AnalyticsStreamService } from './analytics-stream.service';
import { ReportExportService } from './report-export.service';
import { Writable } from 'stream';

describe('Excel export and live analytics', () => {
  it('giữ kiểu dữ liệu, không tạo công thức và có tiêu đề khi không có bản ghi', async () => {
    const exporter = new ReportExportService({
      async *streamLeads() {
        yield {
          name: '=HYPERLINK("evil")',
          phone: '+84901234567',
          deal_amount: '2500000.50',
          score: 90,
          city: null,
          created_at: new Date('2026-01-01'),
        };
      },
    } as any);
    const report = await exporter.createXlsx('7d');
    const workbook = new Workbook();
    try {
      await workbook.xlsx.load((await readFile(report.path)) as never);
      const sheet = workbook.worksheets[0];
      expect(sheet.getCell('B2').value).toBe('=HYPERLINK("evil")');
      expect(sheet.getCell('D2').value).toBe('+84901234567');
      expect(sheet.getCell('M2').value).toBe(2500000.5);
      expect(sheet.getCell('N2').value).toEqual(new Date('2026-01-01'));
    } finally {
      await report.dispose();
    }
    const empty = await new ReportExportService({ async *streamLeads() {} } as any).createXlsx('7d');
    try {
      await workbook.xlsx.load((await readFile(empty.path)) as never);
      expect(workbook.worksheets[0].getRow(1).values).toEqual([undefined, ...LEAD_COLUMNS]);
    } finally {
      await empty.dispose();
    }
  });
  it('serves XLSX headers and rejects unsafe filenames/ranges', async () => {
    const exporter = new ReportExportService({ async *streamLeads() {} } as any);
    const controller = new AnalyticsController({} as any, {} as any, {} as any, exporter);
    const chunks: Buffer[] = [];
    const res = new Writable({
      write(chunk, _encoding, next) {
        chunks.push(Buffer.from(chunk));
        next();
      },
    }) as any;
    res.setHeader = jest.fn();
    await controller.export('xlsx', '7d', res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', XLSX_TYPE);
    expect(Buffer.concat(chunks).subarray(0, 2).toString()).toBe('PK');
    await expect(controller.export('csv', 'bad\r\n', res)).rejects.toThrow('date_range');
    expect(() => controller.stream('bad')).toThrow('date_range');
  });
  it('emits an initial snapshot, skips unchanged data, and releases polling on disconnect', async () => {
    jest.useFakeTimers();
    const analytics = {
      snapshot: jest.fn().mockResolvedValue({ conversion: { leads: 1 }, campaigns: [] }),
    };
    const controller = new AnalyticsController(
      analytics as any,
      {} as any,
      new AnalyticsStreamService(analytics as any),
      {} as any,
    );
    const seen: any[] = [];
    const subscription = controller.stream('7d').subscribe((event) => seen.push(event));
    try {
      await jest.advanceTimersByTimeAsync(0);
      expect(seen).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1000);
      expect(seen).toHaveLength(1);
      analytics.snapshot.mockResolvedValue({ conversion: { leads: 2 }, campaigns: [] });
      await jest.advanceTimersByTimeAsync(1000);
      expect(seen[1]).toMatchObject({ type: 'statistics', data: { conversion: { leads: 2 } } });
      subscription.unsubscribe();
      const calls = analytics.snapshot.mock.calls.length;
      await jest.advanceTimersByTimeAsync(2000);
      expect(analytics.snapshot).toHaveBeenCalledTimes(calls);
    } finally {
      subscription.unsubscribe();
      jest.useRealTimers();
    }
  });
  it('closes a stream when its Redis session is revoked', async () => {
    const controller = new AnalyticsController(
      {} as any,
      { validate: async () => null } as any,
      new AnalyticsStreamService({ snapshot: async () => ({}) } as any),
      {} as any,
    );
    await expect(firstValueFrom(controller.stream('7d', { sessionToken: 'revoked' }))).rejects.toThrow(
      'Phiên đăng nhập đã hết hạn',
    );
  });
});
