import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Deal, Lead, LeadEvent } from '../database/entities';
import { TikTokEventsService } from '../tiktok/tiktok-events.service';
import { Bitrix24Client } from './bitrix24.client';
import { NotificationService } from './notification.service';
import { LeadsService } from '../leads/leads.service';

export const stageToStatus = (stage?: string | null): 'open' | 'won' | 'lost' =>
  stage?.endsWith('WON') ? 'won' : stage && /LOSE|LOST/.test(stage) ? 'lost' : 'open';

@Injectable()
export class Bitrix24WebhookService {
  constructor(
    private readonly ds: DataSource,
    private readonly bitrix: Bitrix24Client,
    private readonly tiktok: TikTokEventsService,
    private readonly notifier: NotificationService,
    private readonly leads: LeadsService,
  ) {}

  async updateDeal(bitrixId: number) {
    const candidate = await this.ds.getRepository(Deal).findOne({
      where: [
        { bitrix24Id: bitrixId, bitrixMode: this.bitrix.mode },
        { bitrix24Id: bitrixId, bitrixMode: 'legacy' },
      ],
    });
    if (!candidate) return { ignored: true, reason: 'Không xác định được giao dịch' };
    return this.leads.withSyncLock(candidate.leadId ?? candidate.id, async () => {
      const remote = await this.bitrix.getDeal(bitrixId);
      const result = await this.ds.transaction(async (manager) => {
        const deal = await manager.findOne(Deal, {
          where: { bitrix24Id: bitrixId, bitrixMode: this.bitrix.mode },
          lock: { mode: 'pessimistic_write' },
        });
        let resolvedDeal = deal;
        if (!resolvedDeal) {
          const legacy = await manager.findOne(Deal, {
            where: { bitrix24Id: bitrixId, bitrixMode: 'legacy' },
            lock: { mode: 'pessimistic_write' },
          });
          if (!legacy) return null;
          if (String(remote.ORIGIN_ID ?? '') !== legacy.leadId) return null;
          legacy.bitrixMode = this.bitrix.mode;
          resolvedDeal = legacy;
        }
        const previous = resolvedDeal.status;
        resolvedDeal.stage = remote.STAGE_ID ?? resolvedDeal.stage;
        resolvedDeal.probability = Number(remote.PROBABILITY ?? resolvedDeal.probability);
        resolvedDeal.amount = remote.OPPORTUNITY != null ? Number(remote.OPPORTUNITY) : resolvedDeal.amount;
        if (typeof remote.CURRENCY_ID === 'string') resolvedDeal.currency = remote.CURRENCY_ID;
        resolvedDeal.status = stageToStatus(resolvedDeal.stage);
        await manager.save(Deal, resolvedDeal);
        if (resolvedDeal.leadId && resolvedDeal.status === 'won') {
          const lead = await manager.findOneByOrFail(Lead, { id: resolvedDeal.leadId });
          await this.tiktok.queueConversion(
            `deal-${resolvedDeal.id}-won`,
            {
              ttclid: lead.rawData?.lead_data?.ttclid,
              event: 'CompletePayment',
              value: resolvedDeal.amount,
              currency: resolvedDeal.currency,
              email: lead.email,
              phone: lead.phone,
            },
            manager,
          );
        }
        const changed = Boolean(resolvedDeal.leadId && resolvedDeal.status !== previous);
        if (changed) {
          await manager.save(
            LeadEvent,
            manager.create(LeadEvent, {
              leadId: resolvedDeal.leadId!,
              type: 'deal_status',
              message: `Trạng thái giao dịch ${previous} -> ${resolvedDeal.status}`,
              meta: { stage: resolvedDeal.stage },
            }),
          );
        }
        if (changed) await this.notifier.notify(`deal.${resolvedDeal.status}`, { dealId: resolvedDeal.id }, manager);
        return { deal: resolvedDeal, changed };
      });
      if (!result) return { ignored: true, reason: 'Không xác định được giao dịch' };
      return { updated: true };
    });
  }
}
