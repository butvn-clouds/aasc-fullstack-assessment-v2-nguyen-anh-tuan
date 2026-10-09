import { InjectQueue, Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { ReportExportService } from './report-export.service';
import { XLSX_TYPE } from './xlsx';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { JOB_OPTIONS, QUEUES } from '../common/constants';
import { DeadLetterService } from '../queues/queues.module';

@Injectable()
export class ReportDeliveryService {
  constructor(
    @InjectQueue(QUEUES.REPORTS) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  enabled() {
    return !!this.config.get<string>('REPORT_WEBHOOK_URL');
  }

  async enqueue(date?: string) {
    if (!this.enabled()) throw new ServiceUnavailableException('Cần cấu hình REPORT_WEBHOOK_URL');
    const job = await this.queue.add(
      'xlsx',
      { range: '7d' },
      {
        ...JOB_OPTIONS,
        jobId: date ? `daily-${date}` : randomUUID(),
        removeOnComplete: { age: 7 * 86400 },
      },
    );
    return { jobId: job.id };
  }

  async status(id: string) {
    const job = await this.queue.getJob(id);
    if (!job) return null;
    return { jobId: job.id, state: await job.getState(), attempts: job.attemptsMade };
  }
}

@Processor(QUEUES.REPORTS, { concurrency: 1 })
export class ReportDeliveryProcessor extends WorkerHost {
  constructor(
    private readonly exports: ReportExportService,
    private readonly config: ConfigService,
    private readonly dlq: DeadLetterService,
  ) {
    super();
  }

  async process(job: Job<{ range: string }>) {
    const url = this.config.get<string>('REPORT_WEBHOOK_URL');
    if (!url) throw new Error('Chưa cấu hình REPORT_WEBHOOK_URL');
    const report = await this.exports.createXlsx(job.data.range);
    const file = createReadStream(report.path);
    try {
      const form = new FormData();
      form.append('report_id', String(job.id));
      form.append('date_range', job.data.range);
      form.append('file', file, { contentType: XLSX_TYPE, filename: `leads-${job.data.range}.xlsx` });
      const token = this.config.get<string>('REPORT_WEBHOOK_TOKEN');
      await axios.post(url, form, {
        timeout: 15000,
        maxRedirects: 0,
        headers: {
          ...form.getHeaders(),
          'Idempotency-Key': String(job.id),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      return { delivered: true, rows: report.rows };
    } finally {
      file.destroy();
      await new Promise<void>((resolve) => {
        if (file.closed) resolve();
        else file.once('close', resolve);
      });
      await report.dispose();
    }
  }

  @OnWorkerEvent('failed')
  async failed(job: Job | undefined, error: Error) {
    await this.dlq.push(QUEUES.REPORTS, job, error);
  }
}
