import { Body, Controller, NotFoundException, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { randomBytes } from 'crypto';
import { MockLeadFactory } from './mock-lead.factory';
import { signPayload } from './tiktok-signature.guard';

@ApiExcludeController()
@Controller('mock/tiktok')
export class TikTokDemoController {
  private readonly factory = new MockLeadFactory();
  constructor(private readonly config: ConfigService) {}

  @Post('signed-request')
  prepare(@Body() input?: Record<string, unknown>) {
    const crmMock = String(this.config.get('BITRIX24_MOCK', 'false')).toLowerCase() === 'true';
    const tiktokMock = String(this.config.get('MOCK_LEADS_ENABLED', 'false')).toLowerCase() === 'true';
    if (!crmMock && !tiktokMock) throw new NotFoundException();
    let secret = this.config.get<string>('TIKTOK_WEBHOOK_SECRET');
    if (!secret) {
      secret = randomBytes(32).toString('hex');
      this.config.set('TIKTOK_WEBHOOK_SECRET', secret);
    }
    const body = JSON.stringify(input && Object.keys(input).length ? input : this.factory.create());
    const timestamp = Math.floor(Date.now() / 1000);
    return { body, signature: `t=${timestamp},s=${signPayload(secret, timestamp, body)}` };
  }
}
