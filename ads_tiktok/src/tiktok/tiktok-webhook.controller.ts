import { BadRequestException, Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { JOB_OPTIONS, QUEUES } from '../common/constants';
import { WebhookEvent } from '../database/entities';
import { TikTokSignatureGuard } from './tiktok-signature.guard';
import { isRecord } from '../common/object';

@ApiTags('Webhook')
@Controller('webhooks/tiktok')
export class TikTokWebhookController {
  constructor(
    @InjectRepository(WebhookEvent)
    private readonly events: Repository<WebhookEvent>,
    @InjectQueue(QUEUES.LEAD_PROCESS) private readonly queue: Queue,
  ) {}

  @Post('leads')
  @ApiBody({
    required: false,
    description:
      'Payload cần có event và event_id. Trong Swagger ở chế độ giả lập, body {} được interceptor thay bằng lead demo và ký tự động.',
    schema: {
      oneOf: [
        {
          type: 'object',
          required: ['event', 'event_id'],
          properties: {
            event: { type: 'string', minLength: 1 },
            event_id: { type: 'string', minLength: 1 },
          },
          additionalProperties: true,
        },
        {
          type: 'object',
          maxProperties: 0,
          description: 'Chỉ dùng trong Swagger khi bật Bitrix mock hoặc MOCK_LEADS_ENABLED.',
        },
      ],
    },
    examples: {
      autoDemo: { summary: 'Giả lập: để {} để tự sinh khách hàng tiềm năng mới và ký yêu cầu', value: {} },
    },
  })
  @ApiHeader({
    name: 'TikTok-Signature',
    required: false,
    description:
      'Swagger tự ký khi BITRIX24_MOCK=true hoặc MOCK_LEADS_ENABLED=true. Nếu tắt cả hai, phải tự cung cấp chữ ký hợp lệ.',
  })
  @ApiUnauthorizedResponse({
    description: 'Thiếu, sai hoặc hết hạn chữ ký. Swagger tự ký khi chế độ tạo dữ liệu TikTok demo được bật.',
  })
  @ApiBadRequestResponse({ description: 'Payload thiếu event hoặc event_id dạng chuỗi không rỗng.' })
  @ApiAcceptedResponse({
    description: 'Sự kiện đã được lưu và đưa vào hàng đợi; sự kiện trùng được xác nhận mà không enqueue lại.',
    schema: {
      oneOf: [
        {
          type: 'object',
          required: ['accepted', 'id'],
          properties: {
            accepted: { type: 'boolean', enum: [true] },
            id: { type: 'string', format: 'uuid' },
          },
        },
        {
          type: 'object',
          required: ['accepted', 'duplicate'],
          properties: {
            accepted: { type: 'boolean', enum: [true] },
            duplicate: { type: 'boolean', enum: [true] },
          },
        },
      ],
    },
  })
  @HttpCode(202)
  @UseGuards(TikTokSignatureGuard)
  @Throttle({ default: { limit: 600, ttl: 60000 } })
  @ApiOperation({
    summary: 'Nhận khách hàng tiềm năng từ TikTok',
    description: 'Trả 202 sau khi đưa vào hàng đợi. Chế độ giả lập: nội dung {}, để trống chữ ký để Swagger tự ký.',
  })
  async receive(@Body() body: unknown) {
    if (
      !isRecord(body) ||
      typeof body.event !== 'string' ||
      !body.event.trim() ||
      typeof body.event_id !== 'string' ||
      !body.event_id.trim()
    )
      throw new BadRequestException('Bắt buộc có event và event_id dạng chuỗi không rỗng');

    try {
      const saved = await this.events.save(
        this.events.create({
          eventId: String(body.event_id),
          eventType: String(body.event),
          payload: body,
        }),
      );
      await this.queue.add('process', { webhookEventId: saved.id }, { ...JOB_OPTIONS, jobId: saved.id });
      return { accepted: true, id: saved.id };
    } catch (e: unknown) {
      if (isRecord(e) && e.code === '23505') return { accepted: true, duplicate: true };
      throw e;
    }
  }
}
