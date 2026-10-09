import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SyncHistoryService } from './sync-history.service';
import { SyncErrorFilter } from '../common/sync-error.filter';

describe('Lịch sử bền vững và lỗi an toàn', () => {
  let directory: string;
  const create = () => new SyncHistoryService({ get: () => directory } as any);
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sync-history-test-'));
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));
  it('lưu kết quả và đọc lại khi khởi động', async () => {
    const service = create();
    await service.track('crm_to_sheet', async () => ({ updated: 1, errors: 0 }));
    const restarted = create();
    restarted.onModuleInit();
    expect(restarted.list().runs[0]).toMatchObject({
      status: 'success',
      summary: { updated: 1, errors: 0 },
    });
  });
  it('không lưu secret hoặc payload lỗi vào lịch sử', async () => {
    const service = create();
    await expect(
      service.track('webhook', async () => {
        throw new Error('FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN secret-test-token');
      }),
    ).rejects.toThrow();
    expect(service.list().runs[0].error?.code).toBe('FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN');
    expect(readFileSync(join(directory, 'sync-history.json'), 'utf8')).not.toContain(
      'secret-test-token',
    );
  });
  it('đánh dấu tác vụ bị gián đoạn khi khởi động lại', () => {
    writeFileSync(
      join(directory, 'sync-history.json'),
      JSON.stringify([{ id: 'x', status: 'running' }]),
    );
    const service = create();
    service.onModuleInit();
    expect(service.list().runs[0].status).toBe('interrupted');
  });
  it('trả lỗi rõ ràng, không trả raw secret qua HTTP', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    new SyncErrorFilter().catch(
      new Error('FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN secret-test-token'),
      { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as any,
    );
    expect(status).toHaveBeenCalledWith(502);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN' }),
    );
    expect(JSON.stringify(json.mock.calls)).not.toContain('secret-test-token');
  });
});
