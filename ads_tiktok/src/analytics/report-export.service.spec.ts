import { Workbook } from 'exceljs';
import { readFile, access, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { ReportExportService } from './report-export.service';
import { AnalyticsService } from './analytics.service';
import { Readable } from 'stream';

describe('Xuất Excel theo luồng', () => {
  it('ghi nhiều đợt dữ liệu thành Excel và dọn tệp sau khi sử dụng', async () => {
    const service = new ReportExportService({
      async *streamLeads() {
        for (let i = 0; i < 2500; i++)
          yield { id: String(i), name: '=SUM(1,2)', phone: '+84901234567', deal_amount: '5000000' };
      },
    } as unknown as AnalyticsService);
    const report = await service.createXlsx('7d');
    try {
      expect(report.rows).toBe(2500);
      const workbook = new Workbook();
      await workbook.xlsx.load((await readFile(report.path)) as never);
      const sheet = workbook.worksheets[0];
      expect(sheet.rowCount).toBe(2501);
      expect(sheet.getCell('B2').value).toBe('=SUM(1,2)');
      expect(sheet.getCell('M2').value).toBe(5000000);
    } finally {
      await report.dispose();
    }
    await expect(access(report.path)).rejects.toThrow();
  });
  it('đóng nguồn dữ liệu và dọn thư mục khi xuất bị lỗi hoặc bị hủy', async () => {
    const before = (await readdir(tmpdir())).filter((name) => name.startsWith('tiktok-report-')).sort();
    let closed = 0;
    const service = new ReportExportService({
      async *streamLeads() {
        try {
          yield { id: 'one' };
          throw new Error('Lỗi đọc dữ liệu');
        } finally {
          closed++;
        }
      },
    } as unknown as AnalyticsService);
    await expect(service.createXlsx('7d')).rejects.toThrow('Lỗi đọc dữ liệu');
    const abort = new AbortController();
    const cancelled = new ReportExportService({
      async *streamLeads() {
        try {
          yield { id: 'one' };
          abort.abort();
          yield { id: 'two' };
        } finally {
          closed++;
        }
      },
    } as unknown as AnalyticsService);
    await expect(cancelled.createXlsx('7d', abort.signal)).rejects.toThrow();
    expect(closed).toBe(2);
    expect((await readdir(tmpdir())).filter((name) => name.startsWith('tiktok-report-')).sort()).toEqual(before);
  });
  it('trả kết nối PostgreSQL khi đọc xong, lỗi mở con trỏ hoặc dừng sớm', async () => {
    const runner = { connect: jest.fn(), release: jest.fn(), stream: jest.fn() };
    const analytics = new AnalyticsService(
      { createQueryRunner: () => runner } as never,
      {} as never,
      { get: () => 'true' } as never,
    );
    const source = Readable.from([{ id: 'one' }, { id: 'two' }]);
    runner.stream.mockResolvedValueOnce(source);
    for await (const row of analytics.streamLeads('7d')) {
      expect(row.id).toBe('one');
      break;
    }
    expect(source.destroyed).toBe(true);
    expect(runner.release).toHaveBeenCalledTimes(1);
    runner.stream.mockRejectedValueOnce(new Error('Lỗi con trỏ'));
    await expect(
      (async () => {
        for await (const _row of analytics.streamLeads('7d')) {
          /* Đọc đến hết. */
        }
      })(),
    ).rejects.toThrow('Lỗi con trỏ');
    expect(runner.release).toHaveBeenCalledTimes(2);
  });
});
