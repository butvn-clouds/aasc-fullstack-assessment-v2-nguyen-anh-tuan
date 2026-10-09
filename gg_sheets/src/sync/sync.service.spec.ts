import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SyncService } from './sync.service';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { Bitrix24ClientService } from '../bitrix24/bitrix24-client.service';
import { MappingConfigService } from '../config/mapping-config.service';

describe('SyncService', () => {
  let service: SyncService;
  const mockSheets = {
    readRows: jest.fn(),
    writeStatusBatch: jest.fn(),
    ensureLayout: jest.fn(async (headers, required) => [...new Set([...headers, ...required])]),
  };
  const mockBitrix = {
    getLeadsByIds: jest
      .fn()
      .mockResolvedValue([{ ID: '456', DATE_MODIFY: '2026-01-01T00:00:00Z' }]),
    findLeadByEmailOrPhone: jest.fn(),
    batchWrite: jest.fn(),
    buildCommand: jest.fn(
      (method: string, params: Record<string, unknown>) => `${method}?${JSON.stringify(params)}`,
    ),
  };
  const mockConfigService = { get: (_key: string, fallback: unknown) => fallback };

  const mappingConfig = {
    columns: {
      'Tên khách hàng': 'NAME',
      Email: 'EMAIL[0][VALUE]',
      'Số điện thoại': 'PHONE[0][VALUE]',
    },
    statusColumns: {
      leadId: 'Lead ID Bitrix24',
      syncStatus: 'Trạng thái đồng bộ',
      lastSyncedAt: 'Thời gian đồng bộ cuối',
      errorMessage: 'Thông báo lỗi',
      syncHash: 'Sync Hash',
    },
    dedupFields: ['Email', 'Số điện thoại'],
  };
  const mockMappingConfig = { get: () => mappingConfig };

  const headers = ['Tên khách hàng', 'Email', 'Số điện thoại', 'Lead ID Bitrix24', 'Sync Hash'];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: GoogleSheetsService, useValue: mockSheets },
        { provide: Bitrix24ClientService, useValue: mockBitrix },
        { provide: MappingConfigService, useValue: mockMappingConfig },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(SyncService);
    jest.clearAllMocks();
  });

  it('TC1: creates a new lead via a batch command when no Lead ID and no duplicate exists', async () => {
    mockSheets.readRows.mockResolvedValue({
      headers,
      rows: [
        {
          rowNumber: 2,
          values: {
            'Tên khách hàng': 'Nguyễn A',
            Email: 'a@email.com',
            'Số điện thoại': '0901234567',
          },
        },
      ],
    });
    mockBitrix.findLeadByEmailOrPhone.mockResolvedValue(null);
    mockBitrix.batchWrite.mockResolvedValue({ result: { cmd0: 123 } });

    const result = await service.run();

    expect(mockBitrix.batchWrite).toHaveBeenCalledTimes(1);
    const [commands] = mockBitrix.batchWrite.mock.calls[0];
    expect(commands.cmd0).toContain('crm.lead.add');
    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.errors).toBe(0);

    const [, updates] = mockSheets.writeStatusBatch.mock.calls.slice(-1)[0];
    expect(updates[0].values['Lead ID Bitrix24']).toBe('123');
  });

  it('TC3: updates the existing lead (found via dedup) instead of creating a new one', async () => {
    mockSheets.readRows.mockResolvedValue({
      headers,
      rows: [
        {
          rowNumber: 2,
          values: {
            'Tên khách hàng': 'Nguyễn A',
            Email: 'a@email.com',
            'Số điện thoại': '0901234567',
          },
        },
      ],
    });
    mockBitrix.findLeadByEmailOrPhone.mockResolvedValue({ ID: '999' });
    mockBitrix.batchWrite.mockResolvedValue({ result: { cmd0: true } });

    const result = await service.run();

    const [commands] = mockBitrix.batchWrite.mock.calls[0];
    expect(commands.cmd0).toContain('crm.lead.update');
    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);

    const [, updates] = mockSheets.writeStatusBatch.mock.calls.slice(-1)[0];
    expect(updates[0].values['Lead ID Bitrix24']).toBe('999');
  });

  it('TC2: updates when a row that already has a Lead ID changes (hash differs), without a dedup lookup', async () => {
    mockSheets.readRows.mockResolvedValue({
      headers,
      rows: [
        {
          rowNumber: 5,
          values: {
            'Tên khách hàng': 'Trần B (đã đổi tên)',
            Email: 'b@email.com',
            'Số điện thoại': '0912345678',
            'Lead ID Bitrix24': '456',
            'Sync Hash': 'stale0000000000',
            'Thời gian đồng bộ cuối': '2026-01-02T00:00:00Z',
          },
        },
      ],
    });
    mockBitrix.batchWrite.mockResolvedValue({ result: { cmd0: true } });

    const result = await service.run();

    expect(mockBitrix.findLeadByEmailOrPhone).not.toHaveBeenCalled();
    const [commands] = mockBitrix.batchWrite.mock.calls[0];
    expect(commands.cmd0).toContain('"id":"456"');
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('skips a row whose content hash matches the stored Sync Hash, without any Bitrix24 call', async () => {
    mockSheets.readRows.mockResolvedValue({
      headers,
      rows: [
        {
          rowNumber: 2,
          values: {
            'Tên khách hàng': 'Nguyễn A',
            Email: 'a@email.com',
            'Số điện thoại': '0901234567',
          },
        },
      ],
    });
    mockBitrix.findLeadByEmailOrPhone.mockResolvedValue(null);
    mockBitrix.batchWrite.mockResolvedValue({ result: { cmd0: 123 } });

    await service.run(); // Lấy hàm băm từ lần chạy đầu.
    const [, firstUpdates] = mockSheets.writeStatusBatch.mock.calls.slice(-1)[0];
    const storedHash = firstUpdates[0].values['Sync Hash'];
    jest.clearAllMocks();

    mockSheets.readRows.mockResolvedValue({
      headers,
      rows: [
        {
          rowNumber: 2,
          values: {
            'Tên khách hàng': 'Nguyễn A',
            Email: 'a@email.com',
            'Số điện thoại': '0901234567',
            'Lead ID Bitrix24': '123',
            'Sync Hash': storedHash,
          },
        },
      ],
    });

    const result = await service.run();

    expect(mockBitrix.batchWrite).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it('TC4: records a per-command batch error and continues, without throwing', async () => {
    mockSheets.readRows.mockResolvedValue({
      headers,
      rows: [
        { rowNumber: 2, values: { 'Tên khách hàng': 'A', Email: 'a@email.com' } },
        { rowNumber: 3, values: { 'Tên khách hàng': 'B', Email: 'b@email.com' } },
      ],
    });
    mockBitrix.findLeadByEmailOrPhone.mockResolvedValue(null);
    mockBitrix.batchWrite.mockResolvedValue({
      result: { cmd1: 456 },
      result_error: {
        cmd0: { error: 'QUERY_LIMIT_EXCEEDED', error_description: 'Too many requests' },
      },
    });

    const result = await service.run();

    expect(result.errors).toBe(1);
    expect(result.created).toBe(1);
    expect(result.errorDetails[0]).toEqual({
      rowNumber: 2,
      message: '[QUERY_LIMIT_EXCEEDED] Too many requests',
    });
  });

  it('handles a planning-phase error (e.g. dedup lookup throws) without stopping the whole run', async () => {
    mockSheets.readRows.mockResolvedValue({
      headers,
      rows: [{ rowNumber: 2, values: { 'Tên khách hàng': 'Lỗi test', Email: 'err@email.com' } }],
    });
    mockBitrix.findLeadByEmailOrPhone.mockRejectedValue(new Error('Bitrix24 timeout'));

    const result = await service.run();

    expect(result.errors).toBe(1);
    expect(result.errorDetails[0].message).toContain('timeout');
    expect(mockBitrix.batchWrite).not.toHaveBeenCalled(); // Không còn dữ liệu cần ghi.
  });

  it('splits more than 50 writable rows into multiple batch calls (Bitrix24 batch limit)', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      rowNumber: i + 2,
      values: { 'Tên khách hàng': `Person ${i}`, Email: `p${i}@email.com` },
    }));
    mockSheets.readRows.mockResolvedValue({ headers, rows });
    mockBitrix.findLeadByEmailOrPhone.mockResolvedValue(null);
    mockBitrix.batchWrite.mockImplementation((commands: Record<string, string>) => {
      const result: Record<string, number> = {};
      Object.keys(commands).forEach((key, idx) => (result[key] = idx + 1));
      return Promise.resolve({ result });
    });

    const result = await service.run();

    // 120 dòng tương ứng ceil(120/50) = 3 lời gọi batch.
    expect(mockBitrix.batchWrite).toHaveBeenCalledTimes(3);
    expect(result.created).toBe(120);
  });
});
