import { Module } from '@nestjs/common';
import { Bitrix24ClientService } from './bitrix24-client.service';

@Module({
  providers: [Bitrix24ClientService],
  exports: [Bitrix24ClientService],
})
export class Bitrix24Module {}
