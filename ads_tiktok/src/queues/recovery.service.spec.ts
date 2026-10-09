import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import { RecoveryService } from './recovery.service';

describe('Inbox recovery', () => {
  it('re-enqueues persisted inbox rows using database IDs (event IDs may contain colons)', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'db-id', event_id: 'tt:event:1' }]);
    const add = jest.fn().mockResolvedValue({});
    await new RecoveryService({ query } as unknown as DataSource, { add } as unknown as Queue).recover();
    expect(add).toHaveBeenCalledWith(
      'process',
      { webhookEventId: 'db-id' },
      expect.objectContaining({ jobId: 'db-id' }),
    );
  });
  it('does not overlap runs and can recover after a failure', async () => {
    let finish!: (rows: unknown[]) => void;
    const query = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([]);
    const service = new RecoveryService({ query } as unknown as DataSource, {} as Queue);
    const pending = service.recover();
    await service.recover();
    expect(query).toHaveBeenCalledTimes(1);
    finish([]);
    await pending;
    await service.recover();
    await service.recover();
    expect(query).toHaveBeenCalledTimes(3);
  });
});
