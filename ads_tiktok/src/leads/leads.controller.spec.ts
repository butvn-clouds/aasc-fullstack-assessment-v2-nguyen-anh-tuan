import { Queue } from 'bullmq';
import { LeadImportService } from './lead-import.service';
import { JOB_OPTIONS } from '../common/constants';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';

describe('LeadsController', () => {
  const leads = { list: jest.fn(), getOrFail: jest.fn(), getTimeline: jest.fn() };
  const syncQueue = { add: jest.fn() };
  const importer = { importBatch: jest.fn() };
  let controller: LeadsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new LeadsController(
      leads as unknown as LeadsService,
      syncQueue as unknown as Queue,
      importer as unknown as LeadImportService,
    );
  });

  it('passes lead filters and returns the lead with its timeline', async () => {
    const query = { page: 2, limit: 10, source: 'tiktok', status: 'synced', campaign_id: 'campaign-1' };
    const lead = { id: 'lead-1', name: 'Customer' };
    const timeline = [{ type: 'created' }];
    leads.list.mockResolvedValueOnce({ items: [lead], total: 1 });
    leads.getOrFail.mockResolvedValueOnce(lead);
    leads.getTimeline.mockResolvedValueOnce(timeline);

    await expect(controller.list(query)).resolves.toEqual({ items: [lead], total: 1 });
    await expect(controller.get('lead-1')).resolves.toEqual({ ...lead, timeline });
    expect(leads.list).toHaveBeenCalledWith(query);
    expect(leads.getTimeline).toHaveBeenCalledWith('lead-1');
  });

  it('queues an existing lead for deal conversion with a stable idempotency key', async () => {
    leads.getOrFail.mockResolvedValueOnce({ id: 'lead-1' });
    syncQueue.add.mockResolvedValueOnce({});

    await expect(controller.convert('lead-1')).resolves.toEqual({ queued: true });

    expect(syncQueue.add).toHaveBeenCalledWith(
      'sync',
      { leadId: 'lead-1', forceDeal: true },
      { ...JOB_OPTIONS, jobId: 'convert-lead-1' },
    );
  });

  it('chuyển nội dung nhập dữ liệu sang dịch vụ', async () => {
    const payloads = [{ event_id: 'evt-1' }];
    importer.importBatch.mockResolvedValue({ queued: 1 });
    await expect(controller.importBatch(payloads)).resolves.toEqual({ queued: 1 });
    expect(importer.importBatch).toHaveBeenCalledWith(payloads);
  });
});
