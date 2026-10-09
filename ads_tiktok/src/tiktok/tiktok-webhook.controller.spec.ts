import { BadRequestException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { WebhookEvent } from '../database/entities';
import { TikTokWebhookController } from './tiktok-webhook.controller';

describe('TikTokWebhookController', () => {
  const event = { id: 'saved-event', eventId: 'evt-1' } as WebhookEvent;
  let events: jest.Mocked<Pick<Repository<WebhookEvent>, 'create' | 'save'>>;
  let queue: jest.Mocked<Pick<Queue, 'add'>>;
  let controller: TikTokWebhookController;

  beforeEach(() => {
    events = {
      create: jest.fn((value) => value as WebhookEvent),
      save: jest.fn().mockResolvedValue(event),
    } as unknown as typeof events;
    queue = { add: jest.fn().mockResolvedValue({}) } as unknown as typeof queue;
    controller = new TikTokWebhookController(events as unknown as Repository<WebhookEvent>, queue as unknown as Queue);
  });

  it('lưu payload gốc rồi enqueue đúng một job có khóa idempotency', async () => {
    const payload = { event: 'lead.generate', event_id: 'evt-1', lead_data: { full_name: 'An' } };

    await expect(controller.receive(payload)).resolves.toEqual({ accepted: true, id: event.id });
    expect(events.create).toHaveBeenCalledWith({
      eventId: 'evt-1',
      eventType: 'lead.generate',
      payload,
    });
    expect(events.save).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'process',
      { webhookEventId: event.id },
      expect.objectContaining({ jobId: 'saved-event' }),
    );
  });

  it('báo đã nhận nếu event_id bị gửi lặp', async () => {
    events.save.mockRejectedValueOnce({ code: '23505' });

    await expect(controller.receive({ event: 'lead.generate', event_id: 'evt-1' })).resolves.toEqual({
      accepted: true,
      duplicate: true,
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('từ chối payload thiếu event hoặc event_id', async () => {
    await expect(controller.receive({ event_id: 'evt-1' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.receive({ event: 'lead.generate' })).rejects.toBeInstanceOf(BadRequestException);
    expect(events.save).not.toHaveBeenCalled();
  });

  it('trả lại lỗi lưu hoặc enqueue không phải lỗi trùng', async () => {
    const failure = new Error('database unavailable');
    queue.add.mockRejectedValueOnce(failure);

    await expect(controller.receive({ event: 'lead.generate', event_id: 'evt-1' })).rejects.toBe(failure);
  });
});
