import { SyncService } from './sync.service';
import { TwoWaySyncService } from './two-way-sync.service';
import { RealtimeSyncService } from './realtime-sync.service';
import { BitrixWebhookController } from './bitrix-webhook.controller';
import { BitrixWebhookGuard } from '../common/guards/bitrix-webhook.guard';
import { buildBitrixFields, computeRowHash } from './row-hash.util';
import { MappingConfig, MappingConfigService } from '../config/mapping-config.service';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SyncController } from './sync.controller';
import { SyncSchedulerService } from './sync-scheduler.service';
import { withSyncLock } from './sync-lock.util';

const mapping: MappingConfig = {
  columns: {
    Name: 'NAME',
    Email: 'EMAIL[0][VALUE]',
    Phone: 'PHONE[0][VALUE]',
    Status: 'STATUS_ID',
    Date: 'UF_DATE',
  },
  statusColumns: {
    leadId: 'ID',
    syncHash: 'Hash',
    lastSyncedAt: 'Time',
    errorMessage: 'Error',
    syncStatus: 'Sync',
  },
  dedupFields: ['Email', 'Phone'],
  reverseColumns: { STATUS_ID: 'Status' },
  transforms: {
    Status: { type: 'enum', values: { New: 'NEW', Working: 'IN_PROCESS' } },
    Email: { type: 'multi_value' },
    Phone: { type: 'multi_value' },
    Date: { type: 'date' },
  },
};
const config = { get: (_key: string, fallback: unknown) => fallback };
const row = (i: number, values: Record<string, string>) => ({ rowNumber: i + 2, values });
function setup(rows: ReturnType<typeof row>[]) {
  const sheets = {
    readRows: jest.fn().mockResolvedValue({ headers: Object.values(mapping.statusColumns), rows }),
    writeStatusBatch: jest.fn().mockResolvedValue(undefined),
    ensureLayout: jest.fn(async (headers, required) => [...new Set([...headers, ...required])]),
  };
  let id = 100;
  const bitrix = {
    findLeadByEmailOrPhone: jest.fn().mockResolvedValue(null),
    buildCommand: jest.fn((method, params) => JSON.stringify({ method, ...params })),
    batchWrite: jest.fn(
      async (
        commands: Record<string, string>,
      ): Promise<{ result: Record<string, unknown>; result_error?: Record<string, unknown> }> => ({
        result: Object.fromEntries(Object.keys(commands).map((k) => [k, ++id])),
      }),
    ),
    getLeadsByIds: jest.fn().mockResolvedValue([]),
    getAllLeads: jest.fn(),
  };
  bitrix.getAllLeads.mockImplementation(() => bitrix.getLeadsByIds());
  const service = new SyncService(
    sheets as any,
    bitrix as any,
    { get: () => mapping } as any,
    config as any,
  );
  return { sheets, bitrix, service };
}

describe('data integrity regressions', () => {
  it.each([0, null, true, {}])('does not accept invalid created Lead ID %s', async (id) => {
    const { service, bitrix } = setup([row(0, { Email: 'a@example.com' })]);
    bitrix.batchWrite.mockResolvedValueOnce({ result: { cmd0: id } } as any);
    expect(await service.run()).toMatchObject({ errors: 1, created: 0 });
  });
  it('does not write CRM if pending status cannot be saved', async () => {
    const { service, bitrix, sheets } = setup([row(0, { Email: 'a@example.com' })]);
    sheets.writeStatusBatch.mockRejectedValueOnce(new Error('write forbidden'));
    await expect(service.run()).rejects.toThrow('write forbidden');
    expect(bitrix.batchWrite).not.toHaveBeenCalled();
  });
  it('stops before writing CRM when Sheet layout cannot be prepared', async () => {
    const { service, sheets, bitrix } = setup([row(0, { Email: 'a@example.com' })]);
    sheets.ensureLayout.mockRejectedValueOnce(new Error('Sheet is protected'));
    await expect(service.run()).rejects.toThrow('Sheet is protected');
    expect(bitrix.batchWrite).not.toHaveBeenCalled();
    expect(bitrix.findLeadByEmailOrPhone).not.toHaveBeenCalled();
  });
  it('prepares status columns and hides Lead ID even without crmModifiedAt', async () => {
    const { service, sheets, bitrix } = setup([row(0, { Email: 'a@example.com' })]);
    await service.run();
    expect(sheets.ensureLayout).toHaveBeenCalledWith(
      expect.any(Array),
      expect.arrayContaining(['ID', 'Hash', 'Error', 'Sync', 'Time']),
      2,
      'ID',
    );
    expect(sheets.ensureLayout.mock.invocationCallOrder[0]).toBeLessThan(
      bitrix.batchWrite.mock.invocationCallOrder[0],
    );
  });
  it('forward mode updates linked rows without pulling CRM changes into Sheet', async () => {
    const { service, sheets, bitrix } = setup([
      row(0, { ID: '123', Name: 'Local edit', Hash: 'old' }),
    ]);
    expect(await service.run()).toMatchObject({ updated: 1, pulledDown: 0, errors: 0 });
    expect(bitrix.getLeadsByIds).not.toHaveBeenCalled();
    expect(sheets.writeStatusBatch.mock.calls.slice(-1)[0][1][0].values).not.toHaveProperty(
      'Status',
    );
  });
  it('updates shared Lead IDs in row order in separate batches', async () => {
    const { service, bitrix } = setup([
      row(0, { ID: '123', Name: 'A' }),
      row(1, { ID: '123', Name: 'B' }),
    ]);
    expect(await service.run()).toMatchObject({ errors: 0, updated: 2, created: 0 });
    expect(bitrix.batchWrite).toHaveBeenCalledTimes(2);
    expect(bitrix.buildCommand.mock.calls.map((call) => call[1].fields.NAME)).toEqual(['A', 'B']);
  });
  it('rejects malformed Lead IDs', async () => {
    const { service, bitrix } = setup([row(0, { ID: 'abc', Name: 'A' })]);
    expect(await service.run()).toMatchObject({ errors: 1, updated: 0 });
    expect(bitrix.batchWrite).not.toHaveBeenCalled();
  });
  it('serializes a duplicate lookup resolving to an already linked Lead', async () => {
    const { service, bitrix } = setup([
      row(0, { ID: '123', Name: 'First' }),
      row(1, { Name: 'Later', Email: 'later@example.com' }),
    ]);
    bitrix.findLeadByEmailOrPhone.mockResolvedValue({ ID: '123' });
    expect(await service.run()).toMatchObject({ errors: 0, updated: 2, created: 0 });
    expect(bitrix.batchWrite).toHaveBeenCalledTimes(2);
    expect(bitrix.buildCommand.mock.calls.map((call) => String(call[1].id))).toEqual([
      '123',
      '123',
    ]);
  });
  it('creates once then updates for identical contacts within the same run', async () => {
    const { service, bitrix, sheets } = setup([
      row(0, { Email: 'a@example.com' }),
      row(1, { Email: 'a@example.com', Name: 'Updated' }),
    ]);
    expect(await service.run()).toMatchObject({ created: 1, updated: 1, errors: 0 });
    expect(bitrix.batchWrite).toHaveBeenCalledTimes(2);
    const commands = bitrix.buildCommand.mock.calls;
    expect(commands[1][0]).toBe('crm.lead.update');
    expect(commands[1][1].id).toBe('101');
    const updates = sheets.writeStatusBatch.mock.calls.slice(-1)[0][1];
    expect(updates[0].values.ID).toBe(updates[1].values.ID);
  });
  it('continues after a whole batch fails and persists success and error statuses', async () => {
    const { service, bitrix, sheets } = setup(
      Array.from({ length: 51 }, (_, i) => row(i, { Email: `p${i}@example.com` })),
    );
    bitrix.batchWrite.mockRejectedValueOnce(new Error('timeout'));
    expect(await service.run()).toMatchObject({ created: 1, errors: 50 });
    expect(sheets.writeStatusBatch.mock.calls.slice(-1)[0][1]).toHaveLength(51);
  });
  it('does not create a related lead after an ambiguous network failure', async () => {
    const { service, bitrix } = setup([
      row(0, { Email: 'a@example.com' }),
      row(1, { Email: 'a@example.com' }),
    ]);
    bitrix.batchWrite.mockRejectedValueOnce(new Error('timeout'));
    expect(await service.run()).toMatchObject({ created: 0, errors: 2 });
    expect(bitrix.batchWrite).toHaveBeenCalledTimes(1);
  });
  it('does not mark a related contact uncertain after a deterministic CRM rejection', async () => {
    const { service, bitrix } = setup([
      row(0, { Email: 'a@example.com' }),
      row(1, { Email: 'a@example.com', Name: 'Corrected' }),
    ]);
    bitrix.batchWrite
      .mockResolvedValueOnce({
        result: {},
        result_error: {
          cmd0: { error: 'ERROR_REQUIRED_PARAMETER', error_description: 'TITLE is required' },
        },
      })
      .mockResolvedValueOnce({ result: { cmd0: 101 } });

    expect(await service.run()).toMatchObject({ created: 1, errors: 1 });
    expect(bitrix.batchWrite).toHaveBeenCalledTimes(2);
  });
  it('looks up each email in a multi-value cell', async () => {
    const { service, bitrix } = setup([row(0, { Email: ' A@EXAMPLE.COM ;b@example.com' })]);
    bitrix.findLeadByEmailOrPhone.mockResolvedValueOnce(null).mockResolvedValueOnce({ ID: '55' });
    expect(await service.run()).toMatchObject({ updated: 1, created: 0 });
    expect(bitrix.findLeadByEmailOrPhone.mock.calls.map((c) => c[0])).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });
  it('rejects contacts pointing to different CRM leads', async () => {
    const { service, bitrix } = setup([row(0, { Email: 'a@example.com;b@example.com' })]);
    bitrix.findLeadByEmailOrPhone
      .mockResolvedValueOnce({ ID: '1' })
      .mockResolvedValueOnce({ ID: '2' });
    expect(await service.run()).toMatchObject({ errors: 1, created: 0 });
  });
  it('marks missing batch results as errors instead of storing undefined IDs', async () => {
    const { service, bitrix } = setup([row(0, { Email: 'a@example.com' })]);
    bitrix.batchWrite.mockResolvedValueOnce({ result: {} });
    expect(await service.run()).toMatchObject({ errors: 1, created: 0 });
  });
  it('serializes overlapping jobs and releases after rejection', async () => {
    const order: string[] = [];
    const a = withSyncLock(async () => {
      order.push('a');
      throw new Error('failed');
    });
    const b = withSyncLock(async () => {
      order.push('b');
    });
    await expect(a).rejects.toThrow('failed');
    await b;
    expect(order).toEqual(['a', 'b']);
  });
});

describe('transforms', () => {
  const build = (values: Record<string, string>, transforms = mapping.transforms) =>
    buildBitrixFields(values, mapping.columns, {}, transforms, mapping.dedupFields);
  it.each(['31/02/2026', '2026-02-30', '99/99/2026', 'nonsense'])(
    'rejects impossible date %s',
    (value) => expect(() => build({ Date: value })).toThrow('Ngày không hợp lệ'),
  );
  it.each([
    ['29/02/2024', '2024-02-29'],
    ['21-09-2026', '2026-09-21'],
    ['2026-09-21', '2026-09-21'],
  ])('converts %s', (input, output) => expect(build({ Date: input }).UF_DATE).toBe(output));
  it('rejects a blank required field', () =>
    expect(() => build({ Date: '' }, { Date: { type: 'date', required: true } })).toThrow(
      'bắt buộc',
    ));
  it('supports enum labels and existing CRM IDs', () => {
    expect(build({ Status: 'New' }).STATUS_ID).toBe('NEW');
    expect(build({ Status: 'NEW' }).STATUS_ID).toBe('NEW');
  });
  it('rejects invalid nonempty enums even when optional', () => {
    expect(() =>
      build(
        { Status: 'bad' },
        { Status: { type: 'enum', values: { New: 'NEW' }, required: true } },
      ),
    ).toThrow('Giá trị danh sách lựa chọn không hợp lệ');
    expect(() => build({ Status: 'bad' })).toThrow('Giá trị danh sách lựa chọn không hợp lệ');
  });
  it('normalizes each email and phone', () => {
    expect(build({ Email: ' A@EXAMPLE.COM;b@example.com' }).EMAIL).toEqual([
      { VALUE: 'a@example.com', VALUE_TYPE: 'WORK' },
      { VALUE: 'b@example.com', VALUE_TYPE: 'WORK' },
    ]);
    expect(build({ Phone: '0901234567;0912345678' }).PHONE).toEqual([
      { VALUE: '+84901234567', VALUE_TYPE: 'WORK' },
      { VALUE: '+84912345678', VALUE_TYPE: 'WORK' },
    ]);
    expect(() => build({ Email: 'bad' })).toThrow('Email không hợp lệ');
    expect(() => build({ Phone: 'abc' })).toThrow('Số điện thoại không hợp lệ');
  });
  it('requires multi-value field syntax', () =>
    expect(() =>
      buildBitrixFields({ X: 'a' }, { X: 'UF_X' }, {}, { X: { type: 'multi_value' } }),
    ).toThrow('cú pháp'));
});

describe('reverse and real-time consistency', () => {
  it('does not report an unchanged sheet as conflict; repeated event is a no-op', async () => {
    const values: Record<string, string> = {
      ID: '123',
      Name: 'A',
      Status: 'New',
      Time: '2026-01-01T00:00:00Z',
    };
    values.Hash = computeRowHash(
      buildBitrixFields(values, mapping.columns, {}, mapping.transforms),
    );
    const { sheets, bitrix } = setup([row(0, values)]);
    bitrix.getLeadsByIds.mockResolvedValue([
      { ID: '123', STATUS_ID: 'IN_PROCESS', DATE_MODIFY: '2026-02-01T00:00:00Z' },
    ]);
    sheets.writeStatusBatch.mockImplementation(async (_h, updates) => {
      updates.forEach((u: any) => Object.assign(values, u.values));
    });
    const reverse = new TwoWaySyncService(
      sheets as any,
      bitrix as any,
      { get: () => mapping } as any,
      { get: () => 'sheet_wins' } as any,
    );
    const realtime = new RealtimeSyncService(reverse);
    expect(await realtime.syncLeadFromWebhook('123')).toMatchObject({
      updated: true,
      conflicts: 0,
    });
    expect(values.Status).toBe('Working');
    expect(buildBitrixFields(values, mapping.columns, {}, mapping.transforms).STATUS_ID).toBe(
      'IN_PROCESS',
    );
    expect(await realtime.syncLeadFromWebhook('123')).toMatchObject({ updated: false });
  });
  it('preserves pending forward-only edits under bitrix_wins', async () => {
    const { sheets, bitrix } = setup([
      row(0, { ID: '123', Name: 'local edit', Hash: 'old', Time: '2026-01-01' }),
    ]);
    bitrix.getLeadsByIds.mockResolvedValue([
      { ID: '123', STATUS_ID: 'NEW', DATE_MODIFY: '2026-02-01' },
    ]);
    const reverse = new TwoWaySyncService(
      sheets as any,
      bitrix as any,
      { get: () => mapping } as any,
      config as any,
    );
    expect(await reverse.run()).toMatchObject({ conflicts: 1, pulledDown: 1 });
    expect(sheets.writeStatusBatch.mock.calls.slice(-1)[0][1][0].values).not.toHaveProperty('Hash');
  });
  it('validates event and ID and accepts flat form payloads', async () => {
    const rt = { enqueue: jest.fn().mockReturnValue({ queued: true, pending: 1 }) };
    const controller = new BitrixWebhookController(rt as any);
    await expect(controller.leadChanged({ event: 'OTHER', leadId: '1' })).rejects.toThrow(
      'không được hỗ trợ',
    );
    await expect(controller.leadChanged({ leadId: 'abc' })).rejects.toThrow('không hợp lệ');
    expect(
      await controller.leadChanged({ event: 'ONCRMLEADUPDATE', 'data[FIELDS][ID]': '2' }),
    ).toMatchObject({ accepted: true });
    await controller.leadChanged({ data: { FIELDS: { ID: '3' } } });
    await controller.leadChanged({ data: { ID: '4' } });
  });
  it('checks native application tokens and rejects invalid values', () => {
    const guard = new BitrixWebhookGuard({ get: () => 'secret' } as any);
    const context = (body: any, header?: string) =>
      ({ switchToHttp: () => ({ getRequest: () => ({ body, header: () => header }) }) }) as any;
    expect(guard.canActivate(context({ auth: { application_token: 'secret' } }))).toBe(true);
    expect(guard.canActivate(context({ 'auth[application_token]': 'secret' }))).toBe(true);
    expect(guard.canActivate(context({}, 'secret'))).toBe(true);
    for (const token of [null, 123, 'wrong', 'badbad'])
      expect(() => guard.canActivate(context({ auth: { application_token: token } }))).toThrow();
    expect(() =>
      new BitrixWebhookGuard({ get: () => undefined } as any).canActivate(context({}, 'secret')),
    ).toThrow();
  });
});

describe('management config persistence', () => {
  let dir: string;
  let service: MappingConfigService;
  const original = process.env.MAPPING_CONFIG_PATH;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sync-config-test-'));
    process.env.MAPPING_CONFIG_PATH = join(dir, 'mapping.json');
    writeFileSync(process.env.MAPPING_CONFIG_PATH, JSON.stringify(mapping));
    service = new MappingConfigService();
    service.onModuleInit();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.MAPPING_CONFIG_PATH;
    else process.env.MAPPING_CONFIG_PATH = original;
    rmSync(dir, { recursive: true, force: true });
  });
  it('persists validated changes across reload', () => {
    service.update({ ...mapping, reverseColumns: {} });
    const restarted = new MappingConfigService();
    restarted.onModuleInit();
    expect(restarted.get().reverseColumns).toEqual({});
  });
  it.each([
    null,
    {},
    { ...mapping, columns: {} },
    { ...mapping, statusColumns: { leadId: 'ID' } },
    { ...mapping, dedupFields: ['missing'] },
    { ...mapping, reverseColumns: { A: 3 } },
    { ...mapping, transforms: { Missing: { type: 'date' } } },
    { ...mapping, transforms: { Date: { type: 'bad' } } },
    { ...mapping, transforms: { Status: { type: 'enum' } } },
    { ...mapping, transforms: { Date: { type: 'date', separator: '' } } },
    { ...mapping, transforms: { Date: { type: 'date', required: 'yes' } } },
    { ...mapping, transforms: [] },
    { ...mapping, reverseColumns: { 'bad-field': 'Name' } },
    { ...mapping, additionalFields: { 'bad-field': 'Name' } },
    { ...mapping, columns: { ...mapping.columns, OtherName: 'NAME' } },
    { ...mapping, columns: { ...mapping.columns, Sync: 'COMMENTS' } },
    { ...mapping, statusColumns: { ...mapping.statusColumns, syncHash: 'ID' } },
    { ...mapping, transforms: { Name: { type: 'multi_value' } } },
    { ...mapping, transforms: { Email: { type: 'multi_value', valueType: 42 } } },
  ])('rejects malformed config without corrupting disk', (bad) => {
    expect(() => service.update(bad as any)).toThrow();
    expect(JSON.parse(readFileSync(join(dir, 'mapping.json'), 'utf8'))).toEqual(mapping);
  });
  it('serves admin page and delegates protected operations', async () => {
    const forward = { run: jest.fn().mockResolvedValue({ created: 1 }) };
    const reverse = { run: jest.fn().mockResolvedValue({ pulledDown: 1 }) };
    const controller = new SyncController(forward as any, reverse as any, service);
    expect(controller.adminConnection()).toEqual({ authenticated: true });
    expect(controller.config()).toEqual(mapping);
    expect(await controller.updateConfig(mapping)).toEqual(mapping);
    expect(await controller.run()).toMatchObject({ created: 1 });
    expect(await controller.reverseRun()).toMatchObject({ pulledDown: 1 });
  });
});

describe('scheduler recovery', () => {
  it('registers cron, suppresses overlap, and recovers from a rejected run', async () => {
    let job: any;
    const registry = {
      addCronJob: (_name: string, j: any) => {
        job = j;
      },
    };
    let release!: () => void;
    const run = jest
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(undefined);
    const scheduler = new SyncSchedulerService(config as any, registry as any, { run } as any);
    scheduler.onModuleInit();
    job.stop();
    const first = (scheduler as any).runIfNotAlreadyRunning();
    await (scheduler as any).runIfNotAlreadyRunning();
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await first;
    await (scheduler as any).runIfNotAlreadyRunning();
    await (scheduler as any).runIfNotAlreadyRunning();
    expect(run).toHaveBeenCalledTimes(3);
  });
});
