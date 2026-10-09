import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { CONFIG_KEYS, QUEUES } from '../common/constants';
import { Deal, Lead } from '../database/entities';
import { DeadLetterService } from '../queues/queues.module';
import { AssignmentService } from './assignment.service';
import { BitrixSyncProcessor } from './bitrix-sync.processor';
import { Bitrix24Client, BitrixHttpError } from './bitrix24.client';
import { NotificationService } from './notification.service';
import { ConfigStoreService } from '../config/config-store.service';
import { RuleEngineService } from '../deals/rule-engine.service';
import { DealsService } from '../deals/deals.service';
import { LeadsService } from '../leads/leads.service';

describe('BitrixSyncProcessor', () => {
  const lead = (): Lead =>
    ({
      id: 'lead-1',
      name: 'Nguyễn Văn A',
      email: 'a@example.com',
      phone: '+84901234567',
      city: 'Hà Nội',
      campaignId: 'campaign-1',
      bitrixMode: 'real',
      score: 80,
      bitrix24Id: 42,
      status: 'new',
      rawData: {
        campaign: { campaign_name: 'Khuyến mãi mùa xuân' },
        lead_data: { full_name: 'Nguyễn Văn A', city: 'Hà Nội' },
      },
    }) as unknown as Lead;

  let leads: jest.Mocked<Pick<LeadsService, 'getOrFail' | 'save' | 'addEvent' | 'withSyncLock'>>;
  let deals: jest.Mocked<Pick<DealsService, 'findByLead' | 'create' | 'save'>>;
  let bitrix: jest.Mocked<Pick<Bitrix24Client, 'mode' | 'addLead' | 'updateLead' | 'addDeal' | 'updateDeal'>>;
  let store: jest.Mocked<Pick<ConfigStoreService, 'get'>>;
  let rules: jest.Mocked<Pick<RuleEngineService, 'findMatch'>>;
  let assignment: jest.Mocked<Pick<AssignmentService, 'pick'>>;
  let notifier: jest.Mocked<Pick<NotificationService, 'notify'>>;
  let dlq: jest.Mocked<Pick<DeadLetterService, 'push'>>;
  let processor: BitrixSyncProcessor;

  beforeEach(() => {
    leads = {
      withSyncLock: jest.fn((_id, work) => work()),
      getOrFail: jest.fn().mockResolvedValue(lead()),
      save: jest.fn().mockImplementation(async (value) => value),
      addEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as typeof leads;
    deals = {
      findByLead: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async (value, onCreated) => {
        const deal = { id: 'deal-1', ...value };
        if (onCreated) await onCreated(deal, {});
        return deal;
      }),
      save: jest.fn().mockImplementation(async (value) => value),
    } as unknown as typeof deals;
    bitrix = {
      mode: 'real',
      addLead: jest.fn().mockResolvedValue(42),
      updateLead: jest.fn().mockResolvedValue(true),
      updateDeal: jest.fn().mockResolvedValue(true),
      addDeal: jest.fn().mockResolvedValue(84),
    } as unknown as typeof bitrix;
    store = {
      get: jest.fn().mockImplementation(async (key: string) => {
        if (key === CONFIG_KEYS.MAPPING) return { 'lead_data.full_name': 'TITLE', 'lead_data.city': 'UF_CRM_CITY' };
        if (key === CONFIG_KEYS.RULES) return [];
        return {};
      }),
    } as unknown as typeof store;
    rules = { findMatch: jest.fn().mockReturnValue(null) } as unknown as typeof rules;
    assignment = { pick: jest.fn().mockResolvedValue(null) } as unknown as typeof assignment;
    notifier = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as typeof notifier;
    dlq = { push: jest.fn().mockResolvedValue(undefined) } as unknown as typeof dlq;
    processor = new BitrixSyncProcessor(
      leads as unknown as LeadsService,
      deals as unknown as DealsService,
      bitrix as unknown as Bitrix24Client,
      store as unknown as ConfigStoreService,
      rules as unknown as RuleEngineService,
      assignment as unknown as AssignmentService,
      notifier as unknown as NotificationService,
      dlq as unknown as DeadLetterService,
    );
  });

  it('đưa lỗi lead không tồn tại vào loại không thể retry', async () => {
    leads.getOrFail.mockRejectedValueOnce(new NotFoundException('missing'));

    await expect(processor.process({ data: { leadId: 'missing' } } as Job)).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('không retry lỗi HTTP 4xx từ Bitrix24', async () => {
    bitrix.updateLead.mockRejectedValueOnce(new BitrixHttpError('crm.lead.update', 400, 'Invalid field'));

    await expect(processor.process({ data: { leadId: 'lead-1' } } as Job)).rejects.toMatchObject({
      name: 'UnrecoverableError',
      message: 'Bitrix24 crm.lead.update HTTP 400: Invalid field',
    });
  });

  it('giữ lỗi tạm thời từ CRM để BullMQ retry', async () => {
    const error = new Error('Bitrix temporarily unavailable');
    bitrix.updateLead.mockRejectedValueOnce(error);

    await expect(processor.process({ data: { leadId: 'lead-1' } } as Job)).rejects.toBe(error);
  });

  it.each([408, 429, 500, 503])('cho BullMQ thử lại lỗi HTTP %s', async (status) => {
    const error = new BitrixHttpError('crm.lead.update', status, 'Tạm thời không khả dụng');
    bitrix.updateLead.mockRejectedValueOnce(error);
    await expect(processor.process({ data: { leadId: 'lead-1' } } as Job)).rejects.toBe(error);
  });

  it('giữ lỗi DB gốc để thử lại, không báo nhầm lead bị thiếu', async () => {
    const error = new Error('Kết nối PostgreSQL bị ngắt');
    leads.getOrFail.mockRejectedValueOnce(error);
    await expect(processor.process({ data: { leadId: 'lead-1' } } as Job)).rejects.toBe(error);
    expect(bitrix.updateLead).not.toHaveBeenCalled();
  });

  it('cập nhật lead đã được liên kết và không tạo Deal khi không khớp quy tắc', async () => {
    const existing = lead();

    await processor.process({ data: { leadId: existing.id } } as Job);

    expect(bitrix.updateLead).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        TITLE: 'Nguyễn Văn A',
        UF_CRM_CITY: 'Hà Nội',
        SOURCE_ID: 'TIKTOK',
      }),
    );
    expect(leads.addEvent).toHaveBeenCalledWith(existing.id, 'synced', 'Đã cập nhật trong Bitrix24', {
      bitrix24Id: 42,
    });
    expect(deals.create).not.toHaveBeenCalled();
  });

  it('dùng pipeline mặc định của Bitrix khi chuyển đổi thủ công không có rule', async () => {
    await processor.process({ data: { leadId: 'lead-1', forceDeal: true } } as Job);

    expect(bitrix.addDeal).toHaveBeenCalledWith(expect.objectContaining({ CATEGORY_ID: '0', STAGE_ID: 'NEW' }));
  });

  it('tạo lead trên Bitrix, lưu ID CRM và cập nhật timeline', async () => {
    const newLead = lead();
    newLead.bitrix24Id = null;
    leads.getOrFail.mockResolvedValueOnce(newLead);

    await processor.process({ data: { leadId: newLead.id } } as Job);

    expect(bitrix.addLead).toHaveBeenCalledWith(
      expect.objectContaining({ TITLE: 'Nguyễn Văn A', SOURCE_ID: 'TIKTOK' }),
    );
    expect(bitrix.addLead.mock.calls[0][0]).not.toHaveProperty('OPPORTUNITY');
    expect(newLead.bitrix24Id).toBe(42);
    expect(newLead.status).toBe('synced');
    expect(leads.save).toHaveBeenCalledWith(newLead);
    expect(leads.addEvent).toHaveBeenCalledWith(newLead.id, 'synced', 'Đã tạo trong Bitrix24', { bitrix24Id: 42 });
  });

  it('tạo Deal theo rule, gán nhân viên, lưu trạng thái và gửi thông báo', async () => {
    const existing = lead();
    leads.getOrFail.mockResolvedValueOnce(existing);
    const rule = {
      condition: "campaign.campaign_name CONTAINS 'xuân'",
      action: 'create_deal' as const,
      pipeline_id: '2',
      stage_id: 'NEW',
      probability: 40,
      amount: 1_000_000,
      name: 'Deal kiểm thử',
    };
    store.get.mockImplementation(async (key: string) =>
      key === CONFIG_KEYS.MAPPING ? { 'lead_data.full_name': 'TITLE' } : key === CONFIG_KEYS.RULES ? [rule] : {},
    );
    rules.findMatch.mockReturnValueOnce(rule);
    assignment.pick.mockResolvedValueOnce('7');

    await processor.process({ data: { leadId: existing.id } } as Job);

    expect(bitrix.updateLead).toHaveBeenCalledWith(
      existing.bitrix24Id,
      expect.objectContaining({ OPPORTUNITY: 1_000_000, CURRENCY_ID: 'VND' }),
    );
    expect(bitrix.addDeal).toHaveBeenCalledWith(
      expect.objectContaining({
        TITLE: 'Nguyễn Văn A - Khuyến mãi mùa xuân',
        CATEGORY_ID: '2',
        STAGE_ID: 'NEW',
        PROBABILITY: 40,
        OPPORTUNITY: 1_000_000,
        LEAD_ID: 42,
        SOURCE_ID: 'TIKTOK',
        ASSIGNED_BY_ID: '7',
      }),
    );
    expect(deals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: existing.id,
        bitrix24Id: 84,
        assignedTo: '7',
        status: 'open',
      }),
      expect.any(Function),
    );
    expect(existing.status).toBe('converted');
    expect(notifier.notify).toHaveBeenCalledWith(
      'deal.created',
      expect.objectContaining({ leadId: existing.id }),
      {},
      'deal-created:deal-1',
    );
  });

  it('không tạo Deal lần hai nếu đã có liên kết', async () => {
    deals.findByLead.mockResolvedValueOnce({
      id: 'deal-existing',
      bitrix24Id: 84,
      amount: 5000000,
      currency: 'VND',
    } as Deal);

    await processor.process({ data: { leadId: 'lead-1' } } as Job);

    expect(bitrix.addDeal).not.toHaveBeenCalled();
    expect(deals.create).not.toHaveBeenCalled();
    expect(bitrix.updateDeal).toHaveBeenCalledWith(
      84,
      expect.objectContaining({
        LEAD_ID: 42,
        SOURCE_ID: 'TIKTOK',
        OPPORTUNITY: 5000000,
        CURRENCY_ID: 'VND',
      }),
    );
    expect(deals.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'deal-existing', amount: 5000000 }));
  });

  it('syncs an existing deal amount to its Bitrix lead', async () => {
    deals.findByLead.mockResolvedValueOnce({ amount: 39_000_000 } as any);

    await processor.process({ data: { leadId: 'lead-1' } } as Job);

    expect(bitrix.updateLead).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ OPPORTUNITY: 39_000_000, CURRENCY_ID: 'VND' }),
    );
    expect(bitrix.addDeal).not.toHaveBeenCalled();
  });

  it('relinks a legacy deal to the active CRM mode without inserting a duplicate local deal', async () => {
    const legacyDeal = {
      id: 'legacy-deal',
      leadId: 'lead-1',
      bitrix24Id: 367,
      bitrixMode: 'legacy',
      title: 'Existing deal',
      amount: 500,
      stage: 'NEW',
      pipelineId: '0',
      probability: 30,
      currency: 'VND',
      assignedTo: null,
    } as Deal;
    deals.findByLead.mockImplementation(async (_leadId, mode) => (mode === 'legacy' ? legacyDeal : null));

    await processor.process({ data: { leadId: 'lead-1' } } as Job);

    expect(bitrix.addDeal).toHaveBeenCalledWith(
      expect.objectContaining({ ORIGIN_ID: 'lead-1', TITLE: 'Existing deal' }),
    );
    expect(deals.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'legacy-deal', bitrix24Id: 84, bitrixMode: 'real' }),
    );
    expect(deals.create).not.toHaveBeenCalled();
  });

  it.each([undefined, 20000000, 0])(
    'stores and sends the same demo amount, respecting rule amount %s',
    async (ruleAmount) => {
      const existing = lead();
      existing.rawData = {
        ...existing.rawData,
        mock: true,
        event_id: 'demo-price-1',
        custom_questions: [{ question: 'Budget range', answer: '15-25 triệu VND' }],
      };
      leads.getOrFail.mockResolvedValueOnce(existing);
      rules.findMatch.mockReturnValueOnce({
        condition: '',
        action: 'create_deal',
        pipeline_id: '1',
        stage_id: 'NEW',
        probability: 30,
        amount: ruleAmount,
      });
      await processor.process({ data: { leadId: existing.id } } as Job);
      const amount = deals.create.mock.calls[0][0].amount!;
      if (ruleAmount !== undefined) expect(amount).toBe(ruleAmount);
      else {
        expect(amount).toBeGreaterThanOrEqual(15000000);
        expect(amount).toBeLessThanOrEqual(25000000);
      }
      expect(bitrix.addDeal).toHaveBeenCalledWith(expect.objectContaining({ OPPORTUNITY: amount, CURRENCY_ID: 'VND' }));
      expect(bitrix.updateLead).toHaveBeenCalledWith(
        existing.bitrix24Id,
        expect.objectContaining({ OPPORTUNITY: amount, CURRENCY_ID: 'VND' }),
      );
    },
  );

  it('đưa job lỗi vào dead-letter và chỉ báo động khi hết số lần thử', async () => {
    const job = { id: 'sync-1', attemptsMade: 5, opts: { attempts: 5 } } as Job;
    const error = new Error('Bitrix unavailable');

    await processor.onFailed(job, error);

    expect(dlq.push).toHaveBeenCalledWith(QUEUES.BITRIX_SYNC, job, error, false);
    expect(notifier.notify).toHaveBeenCalledWith('sync.failed', { jobId: job.id, error: error.message });
  });
});
