import { TwoWaySyncService } from './two-way-sync.service';
import { SyncService } from './sync.service';
import { buildBitrixFields, computeRowHash } from './row-hash.util';

describe('Đồng bộ Lead đã liên kết và ưu tiên hai chiều', () => {
  const config = {
    columns: { Name: 'NAME', Status: 'STATUS_ID', Owner: 'ASSIGNED_BY_ID' },
    statusColumns: {
      leadId: 'ID',
      syncHash: 'Hash',
      lastSyncedAt: 'Time',
      crmModifiedAt: 'CrmTime',
      syncStatus: 'Sync',
      errorMessage: 'Error',
    },
    dedupFields: [],
    reverseColumns: { STATUS_ID: 'Status', ASSIGNED_BY_ID: 'Owner' },
    transforms: {
      Status: { type: 'enum' as const, values: { New: 'NEW', Working: 'IN_PROCESS' } },
    },
  };
  const hash = (values: Record<string, string>) =>
    computeRowHash(buildBitrixFields(values, config.columns, {}, config.transforms));
  function setup(strategy = 'bitrix_wins') {
    const values: Record<string, string> = {
      ID: '12',
      Name: 'Local',
      Status: 'New',
      Owner: '1',
      Time: '2026-01-01T00:00:00Z',
      CrmTime: '2026-01-01T00:00:00Z',
    };
    values.Hash = hash(values);
    const rows = [{ rowNumber: 2, values }];
    const headers = Object.keys(values);
    const remote = {
      ID: '12',
      STATUS_ID: 'IN_PROCESS',
      ASSIGNED_BY_ID: '2',
      DATE_MODIFY: '2026-01-02T00:00:00Z',
    };
    const sheets = {
      readRows: jest.fn(async () => ({ headers, rows })),
      ensureLayout: jest.fn(async () => headers),
      writeStatusBatch: jest.fn(async (_headers, updates) => {
        updates.forEach((update) =>
          Object.assign(
            rows.find((row) => row.rowNumber === update.rowNumber)!.values,
            update.values,
          ),
        );
      }),
    };
    const bitrix = {
      getLeadsByIds: jest.fn(async () => [remote]),
      batchWrite: jest.fn(async () => ({ result: { cmd0: true } })),
      buildCommand: jest.fn((method, params) => method + '?' + JSON.stringify(params)),
      findLeadByEmailOrPhone: jest.fn(),
    };
    const mapping = { get: () => config };
    const env = {
      get: (key, fallback) =>
        key === 'SYNC_DIRECTION'
          ? 'both'
          : key === 'CONFLICT_RESOLUTION_STRATEGY'
            ? strategy
            : fallback,
    };
    return {
      rows,
      values,
      remote,
      sheets,
      bitrix,
      reverse: new TwoWaySyncService(sheets as any, bitrix as any, mapping as any, env as any),
      forward: new SyncService(sheets as any, bitrix as any, mapping as any, env as any),
    };
  }
  it('không nhập lead mới hoặc hàng nháp chưa liên kết', async () => {
    const s = setup();
    delete s.values.ID;
    expect(await s.reverse.run('12')).toMatchObject({ created: 0, pulledDown: 0 });
    expect(s.bitrix.getLeadsByIds).not.toHaveBeenCalled();
    expect(s.sheets.writeStatusBatch).not.toHaveBeenCalled();
  });

  it('uses CRM baseline even if local clock is far ahead', async () => {
    const s = setup();
    s.values.Time = '2099-01-01T00:00:00Z';
    expect(await s.reverse.run()).toMatchObject({ updated: 1, errors: 0 });
    expect(s.values.CrmTime).toBe(s.remote.DATE_MODIFY);
    expect(s.values.Time).not.toBe(s.values.CrmTime);
  });
  it('webhook lạ không truy vấn CRM và không ghi Sheet', async () => {
    const s = setup();
    await s.reverse.run('99');
    expect(s.bitrix.getLeadsByIds).not.toHaveBeenCalled();
    expect(s.sheets.writeStatusBatch).not.toHaveBeenCalled();
  });
  it('chỉ kéo trường được chọn; webhook lặp không ghi lại', async () => {
    const s = setup();
    expect(await s.reverse.run('12')).toMatchObject({ updated: 1, errors: 0 });
    expect(s.values).toMatchObject({ Name: 'Local', Status: 'Working', Owner: '2' });
    expect(s.values.Hash).toBe(hash(s.values));
    expect(await s.reverse.run('12')).toMatchObject({ skipped: 1 });
    expect(s.sheets.writeStatusBatch).toHaveBeenCalledTimes(1);
  });
  it('cập nhật tất cả dòng cùng liên kết một Lead', async () => {
    const s = setup();
    s.rows.push({ rowNumber: 3, values: { ...s.values } });
    expect(await s.reverse.run()).toMatchObject({ errors: 0, pulledDown: 2, totalChecked: 1 });
    expect(s.rows.every((row) => row.values.Status === 'Working')).toBe(true);
    expect(s.rows.every((row) => row.values.Owner === '2')).toBe(true);
  });
  it('từ chối trạng thái CRM ngoài enum', async () => {
    const s = setup();
    s.remote.STATUS_ID = 'UNKNOWN';
    expect(await s.reverse.run()).toMatchObject({ errors: 1, pulledDown: 0 });
    expect(s.sheets.writeStatusBatch).not.toHaveBeenCalled();
  });
  it('không báo thành công khi Google ghi lỗi', async () => {
    const s = setup();
    s.sheets.writeStatusBatch.mockRejectedValueOnce(new Error('write failed'));
    await expect(s.reverse.run()).rejects.toThrow('write failed');
  });
  it.each(['bitrix_wins', 'sheet_wins'])(
    'reverse trước, chính sách %s giữ đúng dữ liệu',
    async (strategy) => {
      const s = setup(strategy);
      s.values.Name = 'Pending local';
      const oldHash = s.values.Hash;
      expect(await s.reverse.run()).toMatchObject({
        conflicts: 1,
        updated: strategy === 'bitrix_wins' ? 1 : 0,
      });
      expect(s.values.Name).toBe('Pending local');
      expect(s.values.Status).toBe(strategy === 'bitrix_wins' ? 'Working' : 'New');
      expect(s.values.Hash).toBe(oldHash);
      expect(await s.forward.run()).toMatchObject({ updated: 1, errors: 0 });
      expect(s.bitrix.buildCommand).toHaveBeenCalledWith(
        'crm.lead.update',
        expect.objectContaining({
          fields: expect.objectContaining({
            NAME: 'Pending local',
            STATUS_ID: strategy === 'bitrix_wins' ? 'IN_PROCESS' : 'NEW',
          }),
        }),
      );
    },
  );
  it.each(['bitrix_wins', 'sheet_wins'])(
    'forward trước, chính sách %s không bỏ qua conflict',
    async (strategy) => {
      const s = setup(strategy);
      s.values.Name = 'Pending local';
      const result = await s.forward.run();
      expect(result.errors).toBe(0);
      if (strategy === 'bitrix_wins') {
        expect(result.pulledDown).toBe(1);
        expect(s.bitrix.batchWrite).not.toHaveBeenCalled();
        expect(s.values).toMatchObject({ Name: 'Pending local', Status: 'Working', Owner: '2' });
        expect(await s.forward.run()).toMatchObject({ updated: 1, errors: 0 });
      } else {
        expect(result.updated).toBe(1);
        expect(s.bitrix.batchWrite).toHaveBeenCalledTimes(1);
      }
    },
  );
});
