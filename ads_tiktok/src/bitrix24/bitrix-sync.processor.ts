import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, NotFoundException } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { appendExtraContacts, buildBitrixFields } from '../common/bitrix-mapper';
import { CONFIG_KEYS, QUEUES } from '../common/constants';
import { ConfigStoreService } from '../config/config-store.service';
import { Deal, Lead } from '../database/entities';
import { DealRule, RuleEngineService } from '../deals/rule-engine.service';
import { DealsService } from '../deals/deals.service';
import { mockDealAmount } from '../deals/mock-deal-amount';
import { LeadsService } from '../leads/leads.service';
import { DeadLetterService } from '../queues/queues.module';
import { AssignmentService } from './assignment.service';
import { Bitrix24Client, BitrixHttpError } from './bitrix24.client';
import { NotificationService } from './notification.service';

@Processor(QUEUES.BITRIX_SYNC, { concurrency: 3, limiter: { max: 3, duration: 1000 } })
export class BitrixSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(BitrixSyncProcessor.name);

  constructor(
    private readonly leads: LeadsService,
    private readonly deals: DealsService,
    private readonly bitrix: Bitrix24Client,
    private readonly store: ConfigStoreService,
    private readonly rules: RuleEngineService,
    private readonly assignment: AssignmentService,
    private readonly notifier: NotificationService,
    private readonly dlq: DeadLetterService,
  ) {
    super();
  }

  async process(job: Job<{ leadId: string; forceDeal?: boolean }>) {
    return this.leads.withSyncLock(job.data.leadId, async () => {
      try {
        return await this.processLocked(job);
      } catch (error: unknown) {
        if (error instanceof BitrixHttpError && error.status === 429 && error.retryAfterMs) {
          await this.worker.rateLimit(error.retryAfterMs);
        }
        if (
          error instanceof BitrixHttpError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 429 &&
          error.status !== 408
        ) {
          throw new UnrecoverableError(error.message);
        }
        throw error;
      }
    });
  }

  private async processLocked(job: Job<{ leadId: string; forceDeal?: boolean }>) {
    const lead = await this.leads.getOrFail(job.data.leadId).catch((error: unknown) => {
      if (error instanceof NotFoundException) throw new UnrecoverableError('Không tìm thấy khách hàng tiềm năng');
      throw error;
    });
    const currentDeal = await this.deals.findByLead(lead.id, this.bitrix.mode);
    const legacyDeal = currentDeal ? null : await this.deals.findByLead(lead.id, 'legacy');
    const existingDeal = currentDeal ?? legacyDeal;
    const rule = await this.findDealRule(lead, !!job.data.forceDeal);
    const amount = existingDeal?.amount ?? rule?.amount ?? mockDealAmount(lead.rawData);

    await this.syncLead(lead, amount);
    if (existingDeal) {
      if (legacyDeal) await this.relinkLegacyDeal(lead, legacyDeal, amount);
      await this.updateExistingDeal(lead, existingDeal, amount);
      if (lead.status !== 'converted') {
        lead.status = 'converted';
        await this.leads.save(lead);
      }
      return;
    }
    await this.maybeCreateDeal(lead, rule, amount);
  }

  private async relinkLegacyDeal(lead: Lead, deal: Deal, amount: number | null) {
    deal.bitrix24Id = await this.bitrix.addDeal({
      TITLE: deal.title,
      ORIGINATOR_ID: 'tiktok-integration',
      ORIGIN_ID: lead.id,
      CATEGORY_ID: deal.pipelineId ?? '0',
      STAGE_ID: deal.stage ?? 'NEW',
      PROBABILITY: deal.probability,
      CURRENCY_ID: deal.currency,
      OPPORTUNITY: amount ?? 0,
      LEAD_ID: lead.bitrix24Id,
      SOURCE_ID: 'TIKTOK',
      ...(deal.assignedTo ? { ASSIGNED_BY_ID: deal.assignedTo } : {}),
    });
    deal.bitrixMode = this.bitrix.mode;
    deal.amount = amount ?? deal.amount;
    await this.deals.save(deal);
    await this.leads.addEvent(lead.id, 'deal_relinked', 'Đã nối lại giao dịch với chế độ CRM hiện tại', {
      dealId: deal.id,
      bitrix24Id: deal.bitrix24Id,
      bitrixMode: deal.bitrixMode,
    });
  }

  private async updateExistingDeal(lead: Lead, deal: Deal, amount: number | null) {
    const title = `${lead.name} - ${lead.rawData?.campaign?.campaign_name ?? 'TikTok'}`;
    const fields: Record<string, unknown> = {
      TITLE: title,
      SOURCE_ID: 'TIKTOK',
      ...(lead.bitrix24Id != null ? { LEAD_ID: lead.bitrix24Id } : {}),
      ...(amount != null ? { OPPORTUNITY: amount, CURRENCY_ID: deal.currency || 'VND' } : {}),
    };
    if (deal.bitrix24Id != null) await this.bitrix.updateDeal(deal.bitrix24Id, fields);
    deal.title = title;
    if (amount != null) deal.amount = amount;
    await this.deals.save(deal);
    await this.leads.addEvent(lead.id, 'deal_updated', 'Đã cập nhật giao dịch hiện có trong Bitrix24', {
      dealId: deal.id,
      bitrix24Id: deal.bitrix24Id,
    });
  }

  private async syncLead(lead: Lead, amount: number | null) {
    const mapping = await this.store.get<Record<string, string>>(CONFIG_KEYS.MAPPING);
    const raw = lead.rawData ?? {};
    const fields = buildBitrixFields(mapping, {
      ...raw,
      lead_data: { ...raw.lead_data, full_name: lead.name, email: lead.email, phone: lead.phone, city: lead.city },
    });
    appendExtraContacts(fields, lead.extraContacts);
    fields.ORIGINATOR_ID = 'tiktok-integration';
    fields.ORIGIN_ID = lead.id;
    fields.SOURCE_ID = 'TIKTOK';
    fields.SOURCE_DESCRIPTION = `Khách hàng tiềm năng TikTok | chiến dịch ${lead.campaignId} | quảng cáo ${lead.adId}`;
    if (!fields.TITLE) fields.TITLE = `Khách hàng TikTok - ${lead.name}`;
    if (amount != null) {
      fields.OPPORTUNITY = amount;
      fields.CURRENCY_ID = 'VND';
    }

    if (lead.bitrix24Id && lead.bitrixMode === this.bitrix.mode) {
      await this.bitrix.updateLead(lead.bitrix24Id, fields);
      await this.leads.addEvent(lead.id, 'synced', 'Đã cập nhật trong Bitrix24', { bitrix24Id: lead.bitrix24Id });
    } else {
      lead.bitrix24Id = await this.bitrix.addLead(fields);
      lead.bitrixMode = this.bitrix.mode;
      lead.status = 'synced';
      await this.leads.save(lead);
      await this.leads.addEvent(lead.id, 'synced', 'Đã tạo trong Bitrix24', { bitrix24Id: lead.bitrix24Id });
    }
  }

  private async findDealRule(lead: Lead, force: boolean): Promise<DealRule | null> {
    const rules = await this.store.get<DealRule[]>(CONFIG_KEYS.RULES);
    const ctx = {
      ...(lead.rawData ?? {}),
      lead: {
        score: lead.score,
        city: lead.city,
        email: lead.email,
        phone: lead.phone,
        contactable: Boolean(lead.email || lead.phone),
      },
    };
    const rule =
      this.rules.findMatch(rules, ctx) ??
      (force
        ? (rules?.[0] ?? {
            condition: '',
            action: 'create_deal' as const,
            pipeline_id: '0',
            stage_id: 'NEW',
            probability: 0,
          })
        : null);
    return rule;
  }

  private async maybeCreateDeal(lead: Lead, rule: DealRule | null, amount: number | null) {
    if (!rule) return;

    const assignee = await this.assignment.pick(rule);
    const probability =
      rule.probability_mode === 'lead_score' ? Math.min(100, Math.max(0, Math.round(lead.score))) : rule.probability;
    const title = `${lead.name} - ${lead.rawData?.campaign?.campaign_name ?? 'TikTok'}`;
    const bitrixId = await this.bitrix.addDeal({
      TITLE: title,
      ORIGINATOR_ID: 'tiktok-integration',
      ORIGIN_ID: lead.id,
      CATEGORY_ID: rule.pipeline_id,
      STAGE_ID: rule.stage_id,
      PROBABILITY: probability,
      CURRENCY_ID: 'VND',
      OPPORTUNITY: amount ?? 0,
      LEAD_ID: lead.bitrix24Id,
      SOURCE_ID: 'TIKTOK',
      ...(assignee ? { ASSIGNED_BY_ID: assignee } : {}),
    });
    const event = rule.priority === 'high' ? 'deal.created.high_priority' : 'deal.created';
    const deal = await this.deals.create(
      {
        leadId: lead.id,
        bitrix24Id: bitrixId,
        bitrixMode: this.bitrix.mode,
        title,
        amount,
        stage: rule.stage_id,
        pipelineId: rule.pipeline_id,
        probability,
        assignedTo: assignee,
        status: 'open',
      },
      (created, manager) =>
        this.notifier.notify(
          event,
          {
            dealId: created.id,
            leadId: lead.id,
            assignee,
            priority: rule.priority ?? 'normal',
          },
          manager,
          `deal-created:${created.id}`,
        ),
    );
    lead.status = 'converted';
    await this.leads.save(lead);
    await this.leads.addEvent(lead.id, 'deal_created', `Đã tạo giao dịch (${rule.name ?? rule.condition})`, {
      dealId: deal.id,
      bitrixId,
      assignee,
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, err: Error) {
    this.logger.error(`Tác vụ đồng bộ ${job?.id} thất bại (lần ${job?.attemptsMade}): ${err.message}`);
    await this.dlq.push(QUEUES.BITRIX_SYNC, job, err, err instanceof UnrecoverableError);
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await this.notifier.notify('sync.failed', { jobId: job.id, error: err.message });
    }
  }
}
