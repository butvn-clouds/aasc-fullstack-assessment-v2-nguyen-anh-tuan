import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TwoWaySyncService } from './two-way-sync.service';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { Bitrix24ClientService } from '../bitrix24/bitrix24-client.service';
import { MappingConfigService } from '../config/mapping-config.service';

describe('TwoWaySyncService', () => {
  let service: TwoWaySyncService;
  const mockSheets = {
    readRows: jest.fn(),
    writeStatusBatch: jest.fn(),
    ensureLayout: jest.fn(async (headers, required) => [...new Set([...headers, ...required])]),
  };
  const mockBitrix = {
    getLeadsByIds: jest.fn(),
    getAllLeads: jest.fn(),
  };
  mockBitrix.getAllLeads.mockImplementation(() => mockBitrix.getLeadsByIds());
  let conflictStrategy = 'bitrix_wins';
  const mockConfigService = {
    get: (key: string, fallback: unknown) =>
      key === 'CONFLICT_RESOLUTION_STRATEGY' ? conflictStrategy : fallback,
  };

  const mappingConfig = {
    columns: { 'Tên khách hàng': 'NAME' },
    statusColumns: {
      leadId: 'Lead ID Bitrix24',
      syncStatus: 'Trạng thái đồng bộ',
      lastSyncedAt: 'Thời gian đồng bộ cuối',
      errorMessage: 'Thông báo lỗi',
      syncHash: 'Sync Hash',
    },
    dedupFields: ['Email'],
    reverseColumns: { STATUS_ID: 'Trạng thái', ASSIGNED_BY_ID: 'Người phụ trách' },
  };
  const mockMappingConfig = { get: () => mappingConfig };

  const headers = [
    'Tên khách hàng',
    'Lead ID Bitrix24',
    'Thời gian đồng bộ cuối',
    'Sync Hash',
    'Trạng thái',
    'Người phụ trách',
  ];

  beforeEach(async () => {
    conflictStrategy = 'bitrix_wins';
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoWaySyncService,
        { provide: GoogleSheetsService, useValue: mockSheets },
        { provide: Bitrix24ClientService, useValue: mockBitrix },
        { provide: MappingConfigService, useValue: mockMappingConfig },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(TwoWaySyncService);
    jest.clearAllMocks();
    mockBitrix.getLeadsByIds.mockResolvedValue([]);
  });

  it('pulls down STATUS_ID/ASSIGNED_BY_ID when Bitrix24 changed after the last forward sync', async () => {
    mockSheets.readRows.mockResolvedValue({
      headers,
      rows: [
        {
          rowNumber: 2,
          values: {
            'Tên khách hàng': 'A',
            'Lead ID Bitrix24': '123',
            'Thời gian đồng bộ cuối': '2026-01-01T00:00:00.000Z',
            'Sync Hash': '', // Không sửa dữ liệu cục bộ từ lần đồng bộ xuôi gần nhất.
          },
        },
      ],
    });
    mockBitrix.getLeadsByIds.mockResolvedValue([
      {
        ID: '123',
        STATUS_ID: 'IN_PROCESS',
        ASSIGNED_BY_ID: '7',
        DATE_MODIFY: '2026-02-01T00:00:00.000Z',
      },
    ]);

    const result = await service.run();

    expect(result.pulledDown).toBe(1);
    expect(result.conflicts).toBe(0);
    const [[, updates]] = mockSheets.writeStatusBatch.mock.calls;
    expect(updates[0].values).toEqual(
      expect.objectContaining({ 'Trạng thái': 'IN_PROCESS', 'Người phụ trách': '7' }),
    );
  });

  it('skips a row when Bitrix24 has not changed since the last forward sync', async () => {
    mockSheets.readRows.mockResolvedValue({
      headers,
      rows: [
        {
          rowNumber: 2,
          values: {
            'Lead ID Bitrix24': '123',
            'Thời gian đồng bộ cuối': '2026-03-01T00:00:00.000Z',
          },
        },
      ],
    });
    mockBitrix.getLeadsByIds.mockResolvedValue([
      { ID: '123', STATUS_ID: 'NEW', DATE_MODIFY: '2026-01-01T00:00:00.000Z' }, // Cũ hơn lastSyncedAt.
    ]);

    const result = await service.run();

    expect(result.pulledDown).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('skips rows with no Lead ID entirely (never forward-synced)', async () => {
    mockSheets.readRows.mockResolvedValue({ headers, rows: [{ rowNumber: 2, values: {} }] });

    const result = await service.run();

    expect(mockBitrix.getAllLeads).not.toHaveBeenCalled();
    expect(mockBitrix.getLeadsByIds).not.toHaveBeenCalled();
    expect(result.totalChecked).toBe(0);
  });

  it('reports a conflict and applies "bitrix_wins" by default when both sides changed', async () => {
    mockSheets.readRows.mockResolvedValue({
      headers,
      rows: [
        {
          rowNumber: 2,
          values: {
            'Lead ID Bitrix24': '123',
            'Thời gian đồng bộ cuối': '2026-01-01T00:00:00.000Z',
            'Sync Hash': 'abc123', // Có hàm băm cũ: Sheet đã từng đồng bộ và có thể có thay đổi cục bộ.
          },
        },
      ],
    });
    mockBitrix.getLeadsByIds.mockResolvedValue([
      { ID: '123', STATUS_ID: 'WON', DATE_MODIFY: '2026-02-01T00:00:00.000Z' },
    ]);

    const result = await service.run();

    expect(result.conflicts).toBe(1);
    expect(result.pulledDown).toBe(1); // bitrix_wins vẫn kéo giá trị về Sheet.
  });

  it('honors "sheet_wins" strategy by skipping the conflicted row instead of overwriting it', async () => {
    conflictStrategy = 'sheet_wins';
    mockSheets.readRows.mockResolvedValue({
      headers,
      rows: [
        {
          rowNumber: 2,
          values: {
            'Lead ID Bitrix24': '123',
            'Thời gian đồng bộ cuối': '2026-01-01T00:00:00.000Z',
            'Sync Hash': 'abc123',
          },
        },
      ],
    });
    mockBitrix.getLeadsByIds.mockResolvedValue([
      { ID: '123', STATUS_ID: 'WON', DATE_MODIFY: '2026-02-01T00:00:00.000Z' },
    ]);

    const result = await service.run();

    expect(result.conflicts).toBe(1);
    expect(result.pulledDown).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('skips a row whose Lead ID is not found in Bitrix24 (e.g. deleted)', async () => {
    mockSheets.readRows.mockResolvedValue({
      headers,
      rows: [
        {
          rowNumber: 2,
          values: {
            'Lead ID Bitrix24': '999',
            'Thời gian đồng bộ cuối': '2026-01-01T00:00:00.000Z',
          },
        },
      ],
    });
    mockBitrix.getLeadsByIds.mockResolvedValue([]); // Lead 999 không còn tồn tại.

    const result = await service.run();

    expect(result.totalChecked).toBe(0);
    expect(result.pulledDown).toBe(0);
  });

  it('does not query CRM when reverse mapping is explicitly empty', async () => {
    mockSheets.readRows.mockResolvedValue({ headers, rows: [] });
    const emptyMappingConfig = { get: () => ({ ...mappingConfig, reverseColumns: {} }) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoWaySyncService,
        { provide: GoogleSheetsService, useValue: mockSheets },
        { provide: Bitrix24ClientService, useValue: mockBitrix },
        { provide: MappingConfigService, useValue: emptyMappingConfig },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    const emptyService = module.get(TwoWaySyncService);

    const result = await emptyService.run();

    expect(mockSheets.readRows).toHaveBeenCalled();
    expect(mockBitrix.getAllLeads).not.toHaveBeenCalled();
    expect(mockBitrix.getLeadsByIds).not.toHaveBeenCalled();
    expect(result.totalChecked).toBe(0);
  });
});
