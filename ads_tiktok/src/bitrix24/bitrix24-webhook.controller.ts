import { Body, Controller, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { BitrixWebhookDto, parseCrmDto } from './bitrix.dto';

export { stageToStatus } from './bitrix24-webhook.service';
import { Bitrix24WebhookService } from './bitrix24-webhook.service';

@ApiTags('Webhook')
@Controller('webhooks/bitrix24')
@Throttle({ default: { limit: 600, ttl: 60000 } })
export class Bitrix24WebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly webhook: Bitrix24WebhookService,
  ) {}

  @Post('deals')
  @ApiBody({
    required: true,
    description: 'Mã xác thực: BITRIX24_APP_TOKEN trong .env. Mã giao dịch: bitrix24Id từ GET /api/v1/deals.',
    schema: {
      type: 'object',
      required: ['auth', 'data'],
      properties: {
        event: { type: 'string', example: 'ONCRMDEALUPDATE' },
        auth: {
          type: 'object',
          required: ['application_token'],
          properties: {
            application_token: { type: 'string', example: 'REPLACE_WITH_BITRIX24_APP_TOKEN' },
          },
        },
        data: {
          type: 'object',
          required: ['FIELDS'],
          properties: {
            FIELDS: {
              type: 'object',
              required: ['ID'],
              properties: {
                ID: { type: 'string', example: '27' },
              },
            },
          },
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Đã xử lý hoặc bỏ qua nếu giao dịch không có liên kết trong ứng dụng.' })
  @ApiUnauthorizedResponse({
    description: 'Thiếu hoặc sai auth.application_token; phải khớp BITRIX24_APP_TOKEN trên máy chủ.',
  })
  @ApiOperation({ summary: 'Nhận cập nhật giao dịch từ Bitrix24' })
  @HttpCode(200)
  async deal(@Body() input: unknown) {
    const body = parseCrmDto(BitrixWebhookDto, input);
    const token = this.config.get<string>('BITRIX24_APP_TOKEN');
    if (!token || body?.auth?.application_token !== token)
      throw new UnauthorizedException('Mã xác thực ứng dụng không hợp lệ');
    const bitrixId = Number(body?.data?.FIELDS?.ID);
    if (!bitrixId) return { ignored: true };

    return this.webhook.updateDeal(bitrixId);
  }
}
