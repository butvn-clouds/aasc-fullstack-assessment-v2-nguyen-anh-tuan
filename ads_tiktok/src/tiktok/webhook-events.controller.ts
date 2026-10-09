import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Repository } from 'typeorm';
import { WebhookEvent } from '../database/entities';

const STATUSES = ['received', 'processed', 'failed'];

@ApiTags('Webhook')
@Controller('api/v1/webhook-events')
export class WebhookEventsController {
  constructor(@InjectRepository(WebhookEvent) private readonly events: Repository<WebhookEvent>) {}

  @ApiOperation({
    summary: 'Danh sách sự kiện webhook đã nhận (kèm payload gốc và lý do lỗi)',
    description:
      'Webhook trả 202 ngay khi đã lưu; dữ liệu sai (email/SĐT không hợp lệ...) chỉ bị phát hiện ở bước xử lý nền và có status=failed cùng trường error.',
  })
  @ApiQuery({ name: 'status', required: false, enum: STATUSES })
  @ApiQuery({ name: 'event_type', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @Get()
  async list(@Query() q: { status?: string; event_type?: string; page?: number; limit?: number }) {
    if (q.status && !STATUSES.includes(q.status)) {
      throw new BadRequestException(`status phải là một trong: ${STATUSES.join(', ')}`);
    }
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 10) || 10));
    const qb = this.events
      .createQueryBuilder('e')
      .orderBy('e.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    if (q.status) qb.andWhere('e.status = :status', { status: q.status });
    if (q.event_type) qb.andWhere('e.event_type = :type', { type: q.event_type });
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }
}
