import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead, LeadEvent, WebhookEvent } from '../database/entities';
import { QueuesModule } from '../queues/queues.module';
import { LeadProcessor } from './lead.processor';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadImportService } from './lead-import.service';

@Module({
  imports: [TypeOrmModule.forFeature([Lead, LeadEvent, WebhookEvent]), QueuesModule],
  controllers: [LeadsController],
  providers: [LeadsService, LeadProcessor, LeadImportService],
  exports: [LeadsService],
})
export class LeadsModule {}
