import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Job, Queue, UnrecoverableError } from 'bullmq';
import { Repository } from 'typeorm';
import { JOB_OPTIONS, QUEUES } from '../common/constants';
import { normalizeEmail, normalizePhone, sanitizeText } from '../common/normalize';
import { WebhookEvent } from '../database/entities';
import { DeadLetterService } from '../queues/queues.module';
import { INTERACTION_EVENTS, LEAD_EVENT, TikTokLeadPayloadDto } from '../tiktok/tiktok-payload.dto';
import { LeadsService } from './leads.service';
import { scoreLead } from './scoring';

@Processor(QUEUES.LEAD_PROCESS, { concurrency: 5 })
export class LeadProcessor extends WorkerHost {
  private readonly logger = new Logger(LeadProcessor.name);

  constructor(
    @InjectRepository(WebhookEvent) private readonly events: Repository<WebhookEvent>,
    @InjectQueue(QUEUES.BITRIX_SYNC) private readonly syncQueue: Queue,
    private readonly leads: LeadsService,
    private readonly dlq: DeadLetterService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<{ webhookEventId: string }>) {
    const ev = await this.events.findOne({ where: { id: job.data.webhookEventId } });
    if (!ev) throw new UnrecoverableError('Không tìm thấy sự kiện webhook');
    if (ev.status === 'processed') return;

    if (ev.eventType === LEAD_EVENT) {
      await this.handleLead(ev);
    } else if (INTERACTION_EVENTS.includes(ev.eventType)) {
      await this.handleInteraction(ev);
    } else {
      this.logger.warn(`Bỏ qua loại sự kiện ${ev.eventType}`);
    }
    await this.events.update(ev.id, { status: 'processed', error: null });
  }

  private async handleLead(ev: WebhookEvent) {
    const dto = plainToInstance(TikTokLeadPayloadDto, ev.payload);
    const errors = await validate(dto, { whitelist: false });
    if (errors.length) {
      throw new UnrecoverableError(`Dữ liệu đầu vào không hợp lệ: ${errors.map((e) => e.property).join(', ')}`);
    }
    const region = this.config.get('DEFAULT_PHONE_REGION', 'VN');
    const email = normalizeEmail(dto.lead_data.email);
    const phone = normalizePhone(dto.lead_data.phone, region);
    if (!email && !phone) throw new UnrecoverableError('Khách hàng tiềm năng không có email hoặc số điện thoại hợp lệ');

    const city = sanitizeText(dto.lead_data.city) || null;
    const { lead, created } = await this.leads.upsert({
      bitrixMode: String(this.config.get('BITRIX24_MOCK', 'false')).toLowerCase() === 'true' ? 'mock' : 'real',
      externalId: dto.lead_data.ttclid ?? dto.event_id,
      name: sanitizeText(dto.lead_data.full_name) || 'Unknown',
      email,
      phone,
      city,
      campaignId: dto.campaign.campaign_id,
      adId: dto.campaign.ad_id ?? null,
      formId: dto.form.form_id,
      score: scoreLead({ email, phone, city, answers: dto.custom_questions?.length ?? 0 }),
      rawData: ev.payload,
    });
    this.logger.log(`Khách hàng tiềm năng ${created ? 'đã tạo' : 'đã gộp'}: ${lead.id}`);
    await this.syncQueue.add('sync', { leadId: lead.id }, { ...JOB_OPTIONS, jobId: `sync-${lead.id}-${ev.id}` });
  }

  private async handleInteraction(ev: WebhookEvent) {
    const ttclid = ev.payload?.lead_data?.ttclid ?? ev.payload?.ttclid;
    const lead = ttclid ? await this.leads.findByExternalId(ttclid) : null;
    if (lead) await this.leads.recordInteraction(lead.id, ev.eventType, ev.eventId);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, err: Error) {
    this.logger.error(`Tác vụ ${job?.id} thất bại (lần ${job?.attemptsMade}): ${err.message}`);
    if (job) await this.events.update({ id: job.data.webhookEventId }, { status: 'failed', error: err.message });
    await this.dlq.push(QUEUES.LEAD_PROCESS, job, err, err instanceof UnrecoverableError);
  }
}
