import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { BitrixWebhookGuard } from '../common/guards/bitrix-webhook.guard';
import { RealtimeSyncService } from './realtime-sync.service';

@Controller('webhooks/bitrix24')
export class BitrixWebhookController {
  constructor(private readonly realtimeSync: RealtimeSyncService) {}

  @Post('leads')
  @UseGuards(BitrixWebhookGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async leadChanged(
    @Body()
    payload: {
      event?: string;
      probe?: string;
      'data[FIELDS][ID]'?: string;
      data?: { FIELDS?: { ID?: string | number }; ID?: string | number };
      leadId?: string | number;
    },
  ) {
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      (payload.event !== undefined && typeof payload.event !== 'string')
    )
      throw new BadRequestException('Payload webhook không hợp lệ');
    if (payload.event === 'SYNC_CONNECTION_PROBE') {
      if (typeof payload.probe !== 'string' || !/^[a-f0-9]{32}$/.test(payload.probe))
        throw new BadRequestException('Probe không hợp lệ');
      return { probe: payload.probe, receiver: 'bitrix-leads' };
    }
    if (payload.event && !['ONCRMLEADADD', 'ONCRMLEADUPDATE'].includes(payload.event.toUpperCase()))
      throw new BadRequestException('Sự kiện không được hỗ trợ');
    const leadId =
      payload.leadId ?? payload.data?.FIELDS?.ID ?? payload.data?.ID ?? payload['data[FIELDS][ID]'];
    if (!leadId || !/^[1-9]\d*$/.test(String(leadId)))
      throw new BadRequestException('Lead ID bị thiếu hoặc không hợp lệ');
    // ACK ngay: Bitrix24 hủy/gửi lại webhook nếu phản hồi chậm; việc kéo dữ liệu chạy nền, có gộp và retry.
    return { accepted: true, ...this.realtimeSync.enqueue(String(leadId)) };
  }
}
