import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { WebhookEvent } from '../database/entities';
import { WebhookEventsController } from './webhook-events.controller';

describe('WebhookEventsController', () => {
  let qb: Record<string, jest.Mock>;
  let controller: WebhookEventsController;

  beforeEach(() => {
    qb = {
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[{ id: 'e1' }], 1]),
    };
    controller = new WebhookEventsController({ createQueryBuilder: () => qb } as unknown as Repository<WebhookEvent>);
  });

  it('lọc theo status và event_type, có phân trang', async () => {
    const result = await controller.list({ status: 'failed', event_type: 'lead.generate', page: 2, limit: 5 });
    expect(qb.andWhere).toHaveBeenCalledWith('e.status = :status', { status: 'failed' });
    expect(qb.andWhere).toHaveBeenCalledWith('e.event_type = :type', { type: 'lead.generate' });
    expect(qb.skip).toHaveBeenCalledWith(5);
    expect(qb.take).toHaveBeenCalledWith(5);
    expect(result).toEqual({ items: [{ id: 'e1' }], total: 1, page: 2, limit: 5 });
  });

  it('dùng mặc định và chặn limit ngoài biên', async () => {
    await controller.list({ limit: 9999 });
    expect(qb.take).toHaveBeenCalledWith(100);
    await controller.list({ page: -1, limit: 0 });
    expect(qb.skip).toHaveBeenLastCalledWith(0);
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('từ chối status không hợp lệ', async () => {
    await expect(controller.list({ status: 'bogus' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
