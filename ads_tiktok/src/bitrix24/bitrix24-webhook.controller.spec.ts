import { DataSource } from 'typeorm';
import { Deal } from '../database/entities';
import { Bitrix24WebhookService } from './bitrix24-webhook.service';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TikTokEventsService } from '../tiktok/tiktok-events.service';
import { Bitrix24Client } from './bitrix24.client';
import { Bitrix24WebhookController, stageToStatus } from './bitrix24-webhook.controller';
import { NotificationService } from './notification.service';
import { LeadsService } from '../leads/leads.service';

describe('Bitrix24WebhookController', () => {
  const config = { get: jest.fn(() => 'application-token') };
  const bitrix = { mode: 'real', getDeal: jest.fn() };
  const deals = { findByBitrixId: jest.fn(), findByLead: jest.fn(), save: jest.fn() };
  const leads = { addEvent: jest.fn(), getOrFail: jest.fn() };
  const tiktok = { queueConversion: jest.fn() };
  const notifier = { notify: jest.fn() };
  const manager = {
    findOne: jest.fn((_entity, options) =>
      options.where.bitrix24Id
        ? deals.findByBitrixId(options.where.bitrix24Id, options.where.bitrixMode)
        : deals.findByLead(options.where.leadId, options.where.bitrixMode),
    ),
    findOneByOrFail: jest.fn(() => leads.getOrFail()),
    create: jest.fn((_entity, value) => value),
    save: jest.fn((entity, value) =>
      entity === Deal ? deals.save(value) : leads.addEvent(value.leadId, value.type, value.message, value.meta),
    ),
  };
  const candidate = jest.fn();
  const ds = { getRepository: () => ({ findOne: candidate }), transaction: jest.fn((work) => work(manager)) };
  let controller: Bitrix24WebhookController;

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockReturnValue('application-token');
    candidate.mockResolvedValue({ id: 'local-deal', leadId: 'lead-1' });
    controller = new Bitrix24WebhookController(
      config as unknown as ConfigService,
      new Bitrix24WebhookService(
        ds as unknown as DataSource,
        bitrix as unknown as Bitrix24Client,
        tiktok as unknown as TikTokEventsService,
        notifier as unknown as NotificationService,
        { withSyncLock: (_id: string, work: () => Promise<unknown>) => work() } as LeadsService,
      ),
    );
  });

  it('maps Bitrix terminal stages to local statuses', () => {
    expect(stageToStatus('C2:WON')).toBe('won');
    expect(stageToStatus('C2:LOSE')).toBe('lost');
    expect(stageToStatus('C2:IN_PROGRESS')).toBe('open');
    expect(stageToStatus()).toBe('open');
  });

  it('rejects a webhook with an invalid application token', async () => {
    await expect(controller.deal({ auth: { application_token: 'wrong' } })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('ignores payloads without an ID and deals unknown to this integration', async () => {
    await expect(
      controller.deal({ auth: { application_token: 'application-token' }, data: { FIELDS: {} } }),
    ).resolves.toEqual({ ignored: true });
    candidate.mockResolvedValueOnce(null);
    await expect(
      controller.deal({ auth: { application_token: 'application-token' }, data: { FIELDS: { ID: '12' } } }),
    ).resolves.toEqual({
      ignored: true,
      reason: 'Không xác định được giao dịch',
    });
    expect(bitrix.getDeal).not.toHaveBeenCalled();
  });

  it('updates deal and lead timeline, then sends conversion when the deal becomes won', async () => {
    const deal = {
      id: 'local-deal',
      bitrix24Id: 12,
      bitrixMode: 'real',
      leadId: 'lead-1',
      stage: 'C2:NEW',
      status: 'open',
      amount: 200,
      currency: 'USD',
      probability: 0,
    };
    deals.findByBitrixId.mockResolvedValueOnce(deal);
    bitrix.getDeal.mockResolvedValueOnce({ STAGE_ID: 'C2:WON', PROBABILITY: '100', OPPORTUNITY: '500' });
    leads.getOrFail.mockResolvedValueOnce({
      rawData: { lead_data: { ttclid: 'click-1' } },
      email: 'a@example.com',
      phone: '+84901234567',
    });

    await expect(
      controller.deal({ auth: { application_token: 'application-token' }, data: { FIELDS: { ID: 12 } } }),
    ).resolves.toEqual({ updated: true });

    expect(deal).toMatchObject({ stage: 'C2:WON', probability: 100, amount: 500, status: 'won' });
    expect(deals.save).toHaveBeenCalledWith(deal);
    expect(leads.addEvent).toHaveBeenCalledWith('lead-1', 'deal_status', 'Trạng thái giao dịch open -> won', {
      stage: 'C2:WON',
    });
    expect(tiktok.queueConversion).toHaveBeenCalledWith(
      'deal-local-deal-won',
      {
        ttclid: 'click-1',
        event: 'CompletePayment',
        value: 500,
        currency: 'USD',
        email: 'a@example.com',
        phone: '+84901234567',
      },
      manager,
    );
    expect(notifier.notify).toHaveBeenCalledWith('deal.won', { dealId: 'local-deal' }, manager);
  });

  it('relinks a legacy deal only when CRM ORIGIN_ID matches its local lead', async () => {
    const legacy = {
      id: 'legacy-deal',
      bitrix24Id: 12,
      bitrixMode: 'legacy',
      leadId: 'lead-1',
      stage: 'NEW',
      status: 'open',
      amount: 100,
      currency: 'VND',
      probability: 0,
    };
    deals.findByBitrixId.mockResolvedValueOnce(null);
    deals.findByBitrixId.mockResolvedValueOnce(legacy);
    bitrix.getDeal.mockResolvedValueOnce({ ORIGIN_ID: 'lead-1', STAGE_ID: 'NEW', OPPORTUNITY: '100' });

    await expect(
      controller.deal({ auth: { application_token: 'application-token' }, data: { FIELDS: { ID: 12 } } }),
    ).resolves.toEqual({ updated: true });

    expect(legacy.bitrixMode).toBe('real');
    expect(deals.save).toHaveBeenCalledWith(legacy);
  });

  it('does not send status notifications when the status did not change', async () => {
    deals.findByBitrixId.mockResolvedValueOnce({
      id: 'deal-1',
      stage: 'C2:NEW',
      status: 'open',
      probability: 0,
      amount: 100,
      leadId: 'lead-1',
    });
    bitrix.getDeal.mockResolvedValueOnce({ STAGE_ID: 'C2:IN_PROGRESS' });
    await controller.deal({ auth: { application_token: 'application-token' }, data: { FIELDS: { ID: 12 } } });
    expect(deals.save).toHaveBeenCalledTimes(1);
    expect(leads.addEvent).not.toHaveBeenCalled();
    expect(notifier.notify).not.toHaveBeenCalled();
  });
});
