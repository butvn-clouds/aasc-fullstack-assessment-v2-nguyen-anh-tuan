import { Writable } from 'stream';
import { Response } from 'express';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService, ExportRow, toCsv } from './analytics.service';
import { AnalyticsStreamService } from './analytics-stream.service';
import { SessionService } from '../auth/session.service';
import { ReportExportService } from './report-export.service';

function setup(streamLeads: AnalyticsService['streamLeads']) {
  const analytics = { streamLeads } as AnalyticsService;
  const exporter = new ReportExportService(analytics);
  const controller = new AnalyticsController(analytics, {} as SessionService, {} as AnalyticsStreamService, exporter);
  return { exporter, controller };
}

describe('Xuất CSV/JSON theo luồng', () => {
  it.each(['csv', 'json'] as const)('giữ định dạng %s, Unicode, ngày, null và ký tự đặc biệt', async (format) => {
    const rows: ExportRow[] = [
      { name: '=SUM(1,2)', note: 'Hà Nội\r\n"ghi chú"', amount: null, date: new Date('2026-01-01') },
      { name: 'Nguyễn Văn A', note: 'bình thường', amount: '15000000', date: null },
    ];
    const { exporter } = setup(async function* () {
      yield* rows;
    });
    let body = '';
    for await (const chunk of exporter.streamText('7d', format)) body += chunk;
    expect(body).toBe(format === 'json' ? JSON.stringify(rows) : toCsv(rows));
    if (format === 'csv') expect(body).toContain('"\'=SUM(1,2)"');
  });

  it.each(['csv', 'json'] as const)('trả dữ liệu rỗng đúng định dạng %s', async (format) => {
    const { exporter } = setup(async function* () {});
    let body = '';
    for await (const chunk of exporter.streamText('7d', format)) body += chunk;
    expect(body).toBe(format === 'json' ? '[]' : '');
  });

  it('chỉ đọc khi cần, đóng nguồn dữ liệu khi người đọc dừng', async () => {
    let read = 0,
      closed = false;
    const { exporter } = setup(async function* () {
      try {
        for (let i = 0; i < 100000; i++) {
          read++;
          yield { id: i };
        }
      } finally {
        closed = true;
      }
    });
    const stream = exporter.streamText('7d', 'json');
    expect(read).toBe(0);
    await stream.next();
    expect(read).toBe(1);
    await stream.return(undefined);
    expect(closed).toBe(true);
  });

  it('không gửi header thành công khi truy vấn đầu tiên lỗi', async () => {
    const { controller } = setup(async function* () {
      throw new Error('DB unavailable');
    });
    const res = Object.assign(
      new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }),
      { setHeader: jest.fn() },
    );
    await expect(controller.export('json', '7d', res as unknown as Response)).rejects.toThrow('DB unavailable');
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.listenerCount('close')).toBe(0);
  });

  it('khách tải chậm không kéo toàn bộ dữ liệu; ngắt tải hủy nguồn và dọn listener', async () => {
    let read = 0,
      closed = false;
    let signal: AbortSignal | undefined;
    const { controller } = setup(async function* (_range, abort) {
      signal = abort;
      try {
        for (let i = 0; i < 100000; i++) {
          abort?.throwIfAborted();
          read++;
          yield { id: i, note: 'x'.repeat(4096) };
        }
      } finally {
        closed = true;
      }
    });
    let began!: () => void;
    const writing = new Promise<void>((resolve) => {
      began = resolve;
    });
    const res = Object.assign(
      new Writable({
        highWaterMark: 1024,
        write() {
          began();
        },
      }),
      { setHeader: jest.fn() },
    );
    const work = controller.export('json', '7d', res as unknown as Response);
    await writing;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(read).toBeLessThan(100);
    res.destroy();
    await work;
    expect(signal?.aborted).toBe(true);
    expect(closed).toBe(true);
  });

  it('từ chối yêu cầu đã hủy trước khi mở truy vấn', async () => {
    const source = jest.fn(async function* () {
      yield { id: 1 };
    });
    const { exporter } = setup(source);
    const abort = new AbortController();
    abort.abort();
    await expect(exporter.streamText('7d', 'json', abort.signal).next()).rejects.toThrow();
    expect(source).not.toHaveBeenCalled();
  });
});
