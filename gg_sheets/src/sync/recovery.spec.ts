import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CreateJournalService } from './create-journal.service';
import { SyncService } from './sync.service';
import { MappingConfig } from '../config/mapping-config.service';

describe('durable Lead creation recovery', () => {
  let directory: string;
  const mapping: MappingConfig = {
    columns: { Name: 'TITLE', Email: 'EMAIL[0][VALUE]' },
    statusColumns: {
      leadId: 'ID',
      syncStatus: 'Sync',
      lastSyncedAt: 'Time',
      errorMessage: 'Error',
      syncHash: 'Hash',
    },
    dedupFields: ['Email'],
  };
  const config = (sheet = 'test-sheet') => ({
    get: (key: string, fallback: unknown) =>
      ({
        SYNC_HISTORY_DIR: directory,
        'google.sheetId': sheet,
        'google.worksheetName': 'Leads',
      })[key] ?? fallback,
  });
  const journal = (sheet?: string) => new CreateJournalService(config(sheet) as any);
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'lead-recovery-'));
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  function setup(values: Record<string, string> = { Name: 'Demo without contact' }) {
    const rows = [{ rowNumber: 2, values }];
    const sheets = {
      readRows: jest.fn(async () => ({ headers: Object.keys(values), rows })),
      ensureLayout: jest.fn(async (headers, required) => [...new Set([...headers, ...required])]),
      writeStatusBatch: jest.fn(async (_headers, updates) => {
        for (const update of updates) Object.assign(values, update.values);
      }),
    };
    const bitrix = {
      findLeadByEmailOrPhone: jest.fn().mockResolvedValue(null),
      buildCommand: (method, params) => JSON.stringify({ method, ...params }),
      batchWrite: jest.fn().mockResolvedValue({ result: { cmd0: 501 } }),
    };
    const restart = () =>
      new SyncService(
        sheets as any,
        bitrix as any,
        { get: () => mapping } as any,
        config() as any,
        undefined,
        undefined,
        journal(),
      );
    return { rows, values, sheets, bitrix, restart };
  }

  it('recovers a confirmed ID after Sheet write fails and process restarts, even without email/phone', async () => {
    const s = setup();
    s.sheets.writeStatusBatch
      .mockImplementationOnce(async () => {})
      .mockRejectedValueOnce(new Error('Google unavailable'));
    await expect(s.restart().run()).rejects.toThrow('Google unavailable');
    expect(
      Object.values(JSON.parse(readFileSync(join(directory, 'create-journal.json'), 'utf8')))[0],
    ).toMatchObject({ leadId: '501' });
    s.bitrix.batchWrite.mockResolvedValueOnce({ result: { cmd0: true } });
    expect(await s.restart().run()).toMatchObject({ created: 0, updated: 1 });
    expect(JSON.parse(s.bitrix.batchWrite.mock.calls[1][0].cmd0)).toMatchObject({
      method: 'crm.lead.update',
      id: '501',
    });
    expect(s.values.ID).toBe('501');
    expect(JSON.parse(readFileSync(join(directory, 'create-journal.json'), 'utf8'))).toEqual({});
  });

  it('does not create again after ambiguous timeout and restart', async () => {
    const s = setup();
    s.bitrix.batchWrite.mockRejectedValueOnce(new Error('timeout'));
    expect(await s.restart().run()).toMatchObject({ errors: 1 });
    expect(await s.restart().run()).toMatchObject({ errors: 1, created: 0 });
    expect(s.bitrix.batchWrite).toHaveBeenCalledTimes(1);
    expect(s.values.Error).toContain('RECOVERY_UNCERTAIN');
  });

  it('uses exact contact lookup to recover an uncertain create', async () => {
    const s = setup({ Name: 'Demo', Email: 'demo@example.com' });
    s.bitrix.batchWrite.mockRejectedValueOnce(new Error('timeout'));
    await s.restart().run();
    s.bitrix.findLeadByEmailOrPhone.mockResolvedValueOnce({ ID: '501' });
    s.bitrix.batchWrite.mockResolvedValueOnce({ result: { cmd0: true } });
    expect(await s.restart().run()).toMatchObject({ updated: 1, created: 0 });
    expect(s.values.ID).toBe('501');
  });

  it.each(['UNCERTAIN_WRITE', 'MISSING_RESULT'])(
    'keeps the journal (fail-closed) when the client reports %s, so no duplicate create follows',
    async (code) => {
      const s = setup();
      s.bitrix.batchWrite.mockResolvedValueOnce({
        result: {},
        result_error: { cmd0: { error: code, error_description: 'lost response' } },
      });
      expect(await s.restart().run()).toMatchObject({ errors: 1, created: 0 });
      const journalAfter = JSON.parse(readFileSync(join(directory, 'create-journal.json'), 'utf8'));
      expect(Object.keys(journalAfter)).toHaveLength(1);
      // Chạy lại: bị chặn, KHÔNG gọi crm.lead.add lần nữa.
      expect(await s.restart().run()).toMatchObject({ errors: 1, created: 0 });
      expect(s.bitrix.batchWrite).toHaveBeenCalledTimes(1);
      expect(s.values.Error).toContain('RECOVERY_UNCERTAIN');
    },
  );

  it('does not leave an orphan "Chờ xử lý" status when the snapshot changes before any write', async () => {
    const s = setup({ Name: 'A', Email: 'a@x.vn' });
    let reads = 0;
    s.sheets.readRows.mockImplementation(async () => {
      reads++;
      // Lần đọc thứ 2 (revalidate): dòng đã bị đổi/sắp xếp lại.
      return {
        headers: ['Name', 'Email'],
        rows: [{ rowNumber: 2, values: reads === 1 ? s.values : { Name: 'B', Email: 'b@x.vn' } }],
      };
    });
    await expect(s.restart().run()).rejects.toThrow('SHEET_CHANGED_DURING_SYNC');
    expect(s.bitrix.batchWrite).not.toHaveBeenCalled();
    expect(s.sheets.writeStatusBatch).not.toHaveBeenCalled();
    expect(s.values.Sync).toBeUndefined();
  });

  it('accepts an explicitly reconciled ID without replaying add', async () => {
    const s = setup();
    s.bitrix.batchWrite.mockRejectedValueOnce(new Error('timeout'));
    await s.restart().run();
    s.values.ID = '701';
    s.bitrix.batchWrite.mockResolvedValueOnce({ result: { cmd0: true } });
    expect(await s.restart().run()).toMatchObject({ updated: 1, created: 0 });
  });

  it('fails closed before CRM write if a pending Sheet row changes position/content', async () => {
    const s = setup({ Name: 'Original', Email: 'original@example.com' });
    s.sheets.readRows
      .mockResolvedValueOnce({ headers: ['Name', 'Email'], rows: s.rows })
      .mockResolvedValueOnce({
        headers: ['Name', 'Email'],
        rows: [{ rowNumber: 2, values: { Name: 'Different', Email: 'other@example.com' } }],
      });

    await expect(s.restart().run()).rejects.toThrow('SHEET_CHANGED_DURING_SYNC');
    expect(s.bitrix.batchWrite).not.toHaveBeenCalled();
  });

  it('releases a create rejected explicitly by CRM so corrected data may retry', async () => {
    const s = setup();
    s.bitrix.batchWrite.mockResolvedValueOnce({
      result: {},
      result_error: {
        cmd0: { error: 'ERROR_REQUIRED_PARAMETER', error_description: 'TITLE is required' },
      },
    });
    expect(await s.restart().run()).toMatchObject({ created: 0, errors: 1 });

    // Simulate the user correcting the row before the next run. A deterministic CRM rejection
    // must not leave an ambiguous-create journal entry behind.
    s.values.Name = 'Corrected lead';
    expect(await s.restart().run()).toMatchObject({ created: 1, errors: 0 });
    expect(s.bitrix.batchWrite).toHaveBeenCalledTimes(2);
  });

  it('releases a create rejected explicitly for quota so a later job may retry', async () => {
    const s = setup();
    s.bitrix.batchWrite.mockResolvedValueOnce({
      result: {},
      result_error: { cmd0: { error: 'QUERY_LIMIT_EXCEEDED' } },
    });
    await s.restart().run();
    expect(await s.restart().run()).toMatchObject({ created: 1, errors: 0 });
  });

  it('blocks edits or row movement during unresolved recovery', () => {
    journal().begin([{ rowNumber: 2, hash: 'fingerprint' }]);
    expect(() => journal().lookup(2, 'changed')).toThrow('RECOVERY_ROW_CHANGED');
    expect(() => journal().lookup(3, 'fingerprint')).toThrow('RECOVERY_ROW_CHANGED');
    expect(() => journal().begin([{ rowNumber: 2, hash: 'fingerprint' }])).toThrow(
      'RECOVERY_UNCERTAIN',
    );
  });

  it('rejects a conflicting confirmed ID, but permits another Sheet to use the same row', () => {
    const first = journal();
    first.begin([{ rowNumber: 2, hash: 'fingerprint' }]);
    first.confirm(2, '501');
    expect(() => journal().lookup(2, 'fingerprint', '999')).toThrow('RECOVERY_ROW_CHANGED');
    expect(journal('other-sheet').lookup(2, 'fingerprint')).toBeUndefined();
  });

  it('fails closed on corrupt journal before CRM writes', async () => {
    writeFileSync(join(directory, 'create-journal.json'), '{broken');
    const s = setup();
    await expect(s.restart().run()).rejects.toThrow('RECOVERY_STORAGE_ERROR');
    expect(s.bitrix.batchWrite).not.toHaveBeenCalled();
  });

  it('does not send a create if journal persistence fails', async () => {
    const s = setup();
    const path = join(directory, 'not-a-directory');
    writeFileSync(path, 'occupied');
    const broken = new CreateJournalService({
      get: (key, fallback) => (key === 'SYNC_HISTORY_DIR' ? path : fallback),
    } as any);
    const service = new SyncService(
      s.sheets as any,
      s.bitrix as any,
      { get: () => mapping } as any,
      config() as any,
      undefined,
      undefined,
      broken,
    );
    await expect(service.run()).rejects.toThrow('RECOVERY_STORAGE_ERROR');
    expect(s.bitrix.batchWrite).not.toHaveBeenCalled();
  });

  it('stores no contact values or webhook credentials', async () => {
    const s = setup({ Name: 'Private customer', Email: 'private@example.com' });
    s.bitrix.batchWrite.mockRejectedValueOnce(new Error('timeout'));
    await s.restart().run();
    const raw = readFileSync(join(directory, 'create-journal.json'), 'utf8');
    expect(raw).not.toMatch(/Private customer|private@example.com|https:/);
  });
});
