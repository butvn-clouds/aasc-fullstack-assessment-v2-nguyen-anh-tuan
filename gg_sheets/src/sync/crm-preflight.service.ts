import { Injectable } from '@nestjs/common';
import { Bitrix24ClientService } from '../bitrix24/bitrix24-client.service';

/** Kiểm tra mỗi job, không cache để phát hiện portal vừa đổi chế độ. */
@Injectable()
export class CrmPreflightService {
  constructor(private readonly bitrix: Bitrix24ClientService) {}

  async assertClassic(): Promise<void> {
    const mode = await this.bitrix.call<number | string>('crm.settings.mode.get');
    if (mode === 2 || mode === '2') throw new Error('CRM_SIMPLE_MODE');
    if (mode !== 1 && mode !== '1') throw new Error('CRM_MODE_UNKNOWN');
  }
}
