import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { JOB_OPTIONS, QUEUES } from '../common/constants';
import { errorMessage, isRecord } from '../common/object';
import { WebhookEvent } from '../database/entities';
import { INTERACTION_EVENTS, LEAD_EVENT, TikTokLeadPayloadDto } from '../tiktok/tiktok-payload.dto';

type ImportStatus = 'queued' | 'duplicate' | 'invalid' | 'failed' | 'pending_recovery';
interface ImportItemResult {
  index: number;
  eventId?: string;
  status: ImportStatus;
  message?: string;
}

@Injectable()
export class LeadImportService {
  private readonly logger = new Logger(LeadImportService.name);
  constructor(
    @InjectRepository(WebhookEvent) private readonly events: Repository<WebhookEvent>,
    @InjectQueue(QUEUES.LEAD_PROCESS) private readonly queue: Queue,
  ) {}

  async importBatch(input: unknown) {
    if (!Array.isArray(input) || input.length > 1000)
      throw new BadRequestException('Nội dung phải là mảng tối đa 1000 sự kiện');
    const results: ImportItemResult[] = [];
    for (const [index, value] of input.entries()) results.push(await this.importOne(value, index));
    const count = (status: ImportStatus) => results.filter((item) => item.status === status).length;
    return {
      queued: count('queued'),
      skipped: count('duplicate') + count('invalid'),
      failed: count('failed'),
      pendingRecovery: count('pending_recovery'),
      results,
    };
  }

  private async importOne(value: unknown, index: number): Promise<ImportItemResult> {
    if (!isRecord(value) || typeof value.event_id !== 'string' || !value.event_id.trim())
      return { index, status: 'invalid', message: 'Bắt buộc có event_id dạng chuỗi không rỗng' };
    const payload = { ...value, event: value.event ?? LEAD_EVENT };
    const eventId = value.event_id;
    if (payload.event === LEAD_EVENT) {
      const dto = plainToInstance(TikTokLeadPayloadDto, payload);
      if (validateSync(dto).length)
        return { index, eventId, status: 'invalid', message: 'Dữ liệu khách hàng không hợp lệ' };
    } else {
      const leadData = isRecord(value.lead_data) ? value.lead_data : {};
      const reference = leadData.ttclid ?? value.ttclid;
      if (
        typeof payload.event !== 'string' ||
        !INTERACTION_EVENTS.includes(payload.event) ||
        typeof reference !== 'string' ||
        !reference.trim()
      )
        return { index, eventId, status: 'invalid', message: 'Sự kiện hoặc mã khách hàng tương tác không hợp lệ' };
    }
    let saved: WebhookEvent;
    try {
      saved = await this.events.save(this.events.create({ eventId, eventType: String(payload.event), payload }));
    } catch (error: unknown) {
      if (isRecord(error) && error.code === '23505') return { index, eventId, status: 'duplicate' };
      this.logger.error(`Không lưu được sự kiện ${eventId}: ${errorMessage(error)}`);
      return { index, eventId, status: 'failed', message: 'Không lưu được sự kiện; cần gửi lại' };
    }
    try {
      await this.queue.add('process', { webhookEventId: saved.id }, { ...JOB_OPTIONS, jobId: saved.id });
      return { index, eventId, status: 'queued' };
    } catch (error: unknown) {
      this.logger.warn(`Sự kiện ${eventId} chờ khôi phục hàng đợi: ${errorMessage(error)}`);
      return {
        index,
        eventId,
        status: 'pending_recovery',
        message: 'Đã lưu sự kiện; hệ thống sẽ thử đưa lại vào hàng đợi',
      };
    }
  }
}
