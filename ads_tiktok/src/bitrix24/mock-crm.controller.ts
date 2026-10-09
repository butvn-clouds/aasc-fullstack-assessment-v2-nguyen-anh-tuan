import {
  BadGatewayException,
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomBytes } from 'crypto';
import axios from 'axios';
import { DataSource } from 'typeorm';
import { Bitrix24Client } from './bitrix24.client';
import { MockCrmDto, parseCrmDto } from './bitrix.dto';

@Injectable()
export class MockOnlyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate() {
    if (String(this.config.get('BITRIX24_MOCK', 'false')).toLowerCase() !== 'true') throw new NotFoundException();
    return true;
  }
}

@ApiTags('Chạy thử')
@UseGuards(MockOnlyGuard)
@Controller('mock/bitrix24')
export class MockCrmController {
  constructor(
    private readonly client: Bitrix24Client,
    private readonly config: ConfigService,
    private readonly ds: DataSource,
  ) {}

  @Post(':entity/:action')
  @ApiOperation({ summary: 'Thêm, xem, sửa, xóa khách hàng/giao dịch giả lập; sửa giao dịch tự gửi webhook' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        start: { type: 'integer', default: 0 },
        fields: { type: 'object', additionalProperties: true },
      },
    },
    examples: {
      won: { value: { id: 27, fields: { STAGE_ID: 'WON', PROBABILITY: 100, OPPORTUNITY: 16200000 } } },
      lost: { value: { id: 27, fields: { STAGE_ID: 'LOSE', PROBABILITY: 0 } } },
      add: { value: { fields: { TITLE: 'Demo', STAGE_ID: 'NEW', OPPORTUNITY: 15000000, CURRENCY_ID: 'VND' } } },
      getOrDelete: { value: { id: 27 } },
      list: { value: { start: 0 } },
    },
  })
  async crud(@Param('entity') entity: string, @Param('action') action: string, @Body() input: unknown = {}) {
    if (!['lead', 'deal'].includes(entity) || !['add', 'get', 'list', 'update', 'delete'].includes(action))
      throw new BadRequestException('entity phải là lead/deal; action phải là add/get/list/update/delete');
    const body = parseCrmDto(MockCrmDto, input ?? {});
    if (['get', 'update', 'delete'].includes(action) && (!Number.isSafeInteger(Number(body.id)) || Number(body.id) < 1))
      throw new BadRequestException('id phải là số nguyên dương');
    if (
      ['add', 'update'].includes(action) &&
      (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields))
    )
      throw new BadRequestException('Bắt buộc cung cấp đối tượng fields');
    if (
      body.fields?.OPPORTUNITY != null &&
      (typeof body.fields.OPPORTUNITY !== 'number' ||
        !Number.isFinite(body.fields.OPPORTUNITY) ||
        body.fields.OPPORTUNITY < 0)
    )
      throw new BadRequestException('OPPORTUNITY phải là số không âm');
    const result = await this.client.call(`crm.${entity}.${action}`, { ...body }).catch((error: Error) => {
      throw new BadRequestException(error.message);
    });
    if (entity !== 'deal' || action !== 'update') return { result };
    let token = this.config.get<string>('BITRIX24_APP_TOKEN');
    if (!token) {
      token = randomBytes(32).toString('hex');
      this.config.set('BITRIX24_APP_TOKEN', token);
    }
    try {
      const response = await axios.post(
        `http://127.0.0.1:${this.config.get('PORT', 3000)}/webhooks/bitrix24/deals`,
        {
          event: 'ONCRMDEALUPDATE',
          auth: { application_token: token },
          data: { FIELDS: { ID: String(body.id) } },
        },
        { timeout: 10000 },
      );
      return { result, callback: response.data };
    } catch {
      throw new BadGatewayException(
        'Đã cập nhật CRM nhưng gửi thông báo về ứng dụng thất bại. Hãy cập nhật lại để thử lại.',
      );
    }
  }

  @Get('conversions')
  @ApiOperation({ summary: 'Xem hàng đợi chuyển đổi: chờ gửi/đã gửi/giả lập/thất bại' })
  conversions() {
    return this.ds.query(
      'SELECT id,event_key,status,attempts,error,created_at,sent_at FROM conversion_outbox ORDER BY created_at DESC LIMIT 100',
    );
  }

  @Post('conversions/:id/retry')
  @ApiOperation({ summary: 'Gửi lại sự kiện chuyển đổi đã hết lượt thử' })
  async retry(@Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('Bắt buộc cung cấp UUID');
    const rows = await this.ds.query(
      `WITH changed AS (UPDATE conversion_outbox SET status='pending', attempts=0, next_attempt_at=NOW()
      WHERE id=$1 AND status='failed' RETURNING id) SELECT id FROM changed`,
      [id],
    );
    return { queued: rows.length === 1 };
  }
}
