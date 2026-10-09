import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Module } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { QUEUES } from '../common/constants';
import { RecoveryService } from './recovery.service';

@Injectable()
export class DeadLetterService {
  constructor(@InjectQueue(QUEUES.DEAD_LETTER) private readonly dlq: Queue) {}

  async push(queue: string, job: Job | undefined, err: Error, unrecoverable = false) {
    if (!job) return;
    const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!exhausted && !unrecoverable) return;
    await this.dlq.add('dead', {
      queue,
      jobId: job.id,
      data: job.data,
      error: err.message,
      failedAt: new Date().toISOString(),
    });
  }
}

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUES.LEAD_PROCESS }, { name: QUEUES.BITRIX_SYNC }, { name: QUEUES.DEAD_LETTER }),
  ],
  providers: [DeadLetterService, RecoveryService],
  exports: [BullModule, DeadLetterService],
})
export class QueuesModule {}
