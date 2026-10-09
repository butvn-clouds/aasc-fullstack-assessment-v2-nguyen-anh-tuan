import axios from 'axios';
import { ReportDeliveryProcessor, ReportDeliveryService } from './report-delivery.service';
import { ReportController } from './report.controller';
import { ReportScheduler } from './report.scheduler';
import { Workbook } from 'exceljs';
import FormData from 'form-data';
import { ReportExportService } from './report-export.service';

jest.mock('axios');
describe('Scheduled XLSX delivery', () => {
  const queue = { add: jest.fn(async (_name, _data, options) => ({ id: options.jobId })), getJob: jest.fn() };
  const settings: Record<string, string> = {};
  const config = { get: (key: string) => settings[key] } as any;
  const delivery = new ReportDeliveryService(queue as any, config);
  beforeEach(() => {
    jest.clearAllMocks();
    settings.REPORT_WEBHOOK_URL = 'http://receiver.test/reports';
    settings.REPORT_WEBHOOK_TOKEN = '';
  });
  it('queues unique daily jobs and manual jobs with retry and retention', async () => {
    expect(await delivery.enqueue('2026-10-07')).toEqual({ jobId: 'daily-2026-10-07' });
    expect(queue.add).toHaveBeenCalledWith(
      'xlsx',
      { range: '7d' },
      expect.objectContaining({ attempts: 5, removeOnComplete: { age: 604800 } }),
    );
    const controller = new ReportController(delivery);
    expect((await controller.send()).jobId).not.toBe('daily-2026-10-07');
    queue.getJob.mockResolvedValue({ id: 'one', attemptsMade: 1, getState: async () => 'completed' });
    expect(await controller.status('one')).toEqual({ jobId: 'one', attempts: 1, state: 'completed' });
    queue.getJob.mockResolvedValue(null);
    await expect(controller.status('missing')).rejects.toThrow('Không tìm thấy tác vụ gửi báo cáo');
    settings.REPORT_WEBHOOK_URL = '';
    expect(delivery.enabled()).toBe(false);
    await expect(delivery.enqueue()).rejects.toThrow('Cần cấu hình REPORT_WEBHOOK_URL');
  });
  it('sends a readable XLSX attachment with a stable idempotency key and optional authorization', async () => {
    const dlq = { push: jest.fn() };
    const worker = new ReportDeliveryProcessor(
      new ReportExportService({
        async *streamLeads() {
          yield { name: 'Nguyễn An', deal_amount: '5000000' };
        },
      } as any),
      config,
      dlq as any,
    );
    const job = { id: 'daily-2026-10-07', data: { range: '7d' } } as any;
    settings.REPORT_WEBHOOK_TOKEN = 'receiver-secret';
    let sent: Buffer = Buffer.alloc(0);
    jest.mocked(axios.post).mockImplementationOnce(async (_url, data) => {
      const form = data as FormData;
      sent = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        form.on('data', (chunk: string | Buffer) => chunks.push(Buffer.from(chunk)));
        form.on('end', () => resolve(Buffer.concat(chunks)));
        form.on('error', reject);
        form.resume();
      });
      return { data: {} };
    });
    expect(await worker.process(job)).toEqual({ delivered: true, rows: 1 });
    const [, , options] = jest.mocked(axios.post).mock.calls[0];
    expect(options?.headers).toMatchObject({ 'Idempotency-Key': job.id, Authorization: 'Bearer receiver-secret' });
    const workbook = new Workbook();
    await workbook.xlsx.load(
      sent.subarray(sent.indexOf(Buffer.from('PK\x03\x04')), sent.lastIndexOf(Buffer.from('\r\n--'))) as any,
    );
    expect(workbook.worksheets[0].getCell('B2').value).toBe('Nguyễn An');
    settings.REPORT_WEBHOOK_TOKEN = '';
    jest.mocked(axios.post).mockRejectedValueOnce(new Error('temporary 503'));
    await expect(worker.process(job)).rejects.toThrow('temporary 503');
    const error = new Error('exhausted');
    await worker.failed(job, error);
    expect(dlq.push).toHaveBeenCalledWith('report-delivery', job, error);
    settings.REPORT_WEBHOOK_URL = '';
    await expect(worker.process(job)).rejects.toThrow('Chưa cấu hình');
  });
  it('only catches up enabled daily reports after 08:00 Bangkok', async () => {
    jest.useFakeTimers();
    const enqueue = jest.spyOn(delivery, 'enqueue').mockResolvedValue({ jobId: 'test' });
    const scheduler = new ReportScheduler({} as any, {} as any, config, delivery);
    try {
      jest.setSystemTime(new Date('2026-10-07T00:59:00Z'));
      await scheduler.ensureReport();
      expect(enqueue).not.toHaveBeenCalled();
      jest.setSystemTime(new Date('2026-10-07T01:00:00Z'));
      await scheduler.ensureReport();
      expect(enqueue).toHaveBeenCalledWith('2026-10-07');
      settings.REPORT_WEBHOOK_URL = '';
      enqueue.mockClear();
      await scheduler.ensureReport();
      expect(enqueue).not.toHaveBeenCalled();
    } finally {
      enqueue.mockRestore();
      jest.useRealTimers();
    }
  });
});
