import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, UnrecoverableError } from 'bullmq';
import { Repository } from 'typeorm';
import { JOB_OPTIONS, QUEUES } from '../common/constants';
import { WebhookEvent } from '../database/entities';
import { DeadLetterService } from '../queues/queues.module';
import { LEAD_EVENT } from '../tiktok/tiktok-payload.dto';
import { LeadsService } from './leads.service';
import { LeadProcessor } from './lead.processor';

describe('LeadProcessor', () => {
  const payload = {
    event: LEAD_EVENT,
    event_id: 'event-1',
    timestamp: 1_700_000_000,
    campaign: { campaign_id: 'campaign-1', ad_id: 'ad-1' },
    form: { form_id: 'form-1' },
    lead_data: {
      full_name: '  Nguyễn <b>Văn</b> A  ',
      email: ' TEST@EXAMPLE.COM ',
      phone: '+84901234567',
      city: '<i>Hà Nội</i>',
      ttclid: 'click-1',
    },
    custom_questions: [{ question: 'Budget', answer: '10' }],
  };
  let events: jest.Mocked<Pick<Repository<WebhookEvent>, 'findOne' | 'update'>>;
  let syncQueue: jest.Mocked<Pick<Queue, 'add'>>;
  let leads: jest.Mocked<Pick<LeadsService, 'upsert' | 'findByExternalId' | 'addEvent' | 'recordInteraction'>>;
  let dlq: jest.Mocked<Pick<DeadLetterService, 'push'>>;
  let processor: LeadProcessor;

  const makeEvent = (eventType: string, eventPayload: any = payload): WebhookEvent =>
    ({ id: 'webhook-1', eventId: 'event-1', eventType, payload: eventPayload }) as WebhookEvent;

  beforeEach(() => {
    events = {
      findOne: jest.fn().mockResolvedValue(makeEvent(LEAD_EVENT)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as typeof events;
    syncQueue = { add: jest.fn().mockResolvedValue({}) } as unknown as typeof syncQueue;
    leads = {
      upsert: jest.fn().mockResolvedValue({ lead: { id: 'lead-1' }, created: true }),
      findByExternalId: jest.fn(),
      recordInteraction: jest.fn(),
      addEvent: jest.fn().mockResolvedValue({}),
    } as unknown as typeof leads;
    dlq = { push: jest.fn().mockResolvedValue(undefined) } as unknown as typeof dlq;
    const config = { get: (_key: string, fallback: string) => fallback } as ConfigService;
    processor = new LeadProcessor(
      events as unknown as Repository<WebhookEvent>,
      syncQueue as unknown as Queue,
      leads as unknown as LeadsService,
      dlq as unknown as DeadLetterService,
      config,
    );
  });

  it('chuẩn hóa và làm sạch lead, lưu rồi đưa job đồng bộ Bitrix vào hàng đợi', async () => {
    await processor.process({ data: { webhookEventId: 'webhook-1' } } as Job);

    expect(leads.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'click-1',
        name: 'Nguyễn Văn A',
        email: 'test@example.com',
        phone: '+84901234567',
        city: 'Hà Nội',
        campaignId: 'campaign-1',
        adId: 'ad-1',
        formId: 'form-1',
        rawData: payload,
      }),
    );
    expect(syncQueue.add).toHaveBeenCalledWith(
      'sync',
      { leadId: 'lead-1' },
      { ...JOB_OPTIONS, jobId: 'sync-lead-1-webhook-1' },
    );
    expect(events.update).toHaveBeenCalledWith('webhook-1', { status: 'processed', error: null });
  });

  it('đánh dấu event chưa biết là đã xử lý mà không tạo lead', async () => {
    events.findOne.mockResolvedValueOnce(makeEvent('unsupported.event'));

    await processor.process({ data: { webhookEventId: 'webhook-1' } } as Job);

    expect(leads.upsert).not.toHaveBeenCalled();
    expect(syncQueue.add).not.toHaveBeenCalled();
    expect(events.update).toHaveBeenCalledWith('webhook-1', { status: 'processed', error: null });
  });

  it('ghi sự kiện tương tác khi tìm thấy lead theo ttclid', async () => {
    events.findOne.mockResolvedValueOnce(makeEvent('user.interact', { lead_data: { ttclid: 'click-1' } }));
    leads.findByExternalId.mockResolvedValueOnce({ id: 'lead-1' } as any);

    await processor.process({ data: { webhookEventId: 'webhook-1' } } as Job);

    expect(leads.recordInteraction).toHaveBeenCalledWith('lead-1', 'user.interact', 'event-1');
    expect(events.update).toHaveBeenCalledWith('webhook-1', { status: 'processed', error: null });
  });

  it('bỏ qua tương tác không gắn với lead đã biết', async () => {
    events.findOne.mockResolvedValueOnce(makeEvent('form.complete', { ttclid: 'unknown' }));
    leads.findByExternalId.mockResolvedValueOnce(null);

    await processor.process({ data: { webhookEventId: 'webhook-1' } } as Job);

    expect(leads.addEvent).not.toHaveBeenCalled();
  });

  it('đưa event thiếu khỏi hàng đợi dưới dạng lỗi không thể retry', async () => {
    events.findOne.mockResolvedValueOnce(null);

    await expect(processor.process({ data: { webhookEventId: 'missing' } } as Job)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('đưa payload sai định dạng vào lỗi không thể retry', async () => {
    events.findOne.mockResolvedValueOnce(makeEvent(LEAD_EVENT, { event_id: 'bad' }));

    await expect(processor.process({ data: { webhookEventId: 'webhook-1' } } as Job)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(leads.upsert).not.toHaveBeenCalled();
  });

  it('từ chối lead thiếu cả email hợp lệ lẫn số điện thoại hợp lệ', async () => {
    const invalidContact = structuredClone(payload);
    invalidContact.lead_data.email = 'invalid';
    invalidContact.lead_data.phone = '123';
    events.findOne.mockResolvedValueOnce(makeEvent(LEAD_EVENT, invalidContact));

    await expect(processor.process({ data: { webhookEventId: 'webhook-1' } } as Job)).rejects.toThrow(
      'Khách hàng tiềm năng không có email hoặc số điện thoại hợp lệ',
    );
  });

  it('lưu lỗi và chuyển job thất bại sang dead-letter queue', async () => {
    const job = { id: 'job-1', attemptsMade: 5, data: { webhookEventId: 'webhook-1' } } as Job;
    const error = new Error('processing failed');

    await processor.onFailed(job, error);

    expect(events.update).toHaveBeenCalledWith({ id: 'webhook-1' }, { status: 'failed', error: error.message });
    expect(dlq.push).toHaveBeenCalledWith(QUEUES.LEAD_PROCESS, job, error, false);
  });
});
