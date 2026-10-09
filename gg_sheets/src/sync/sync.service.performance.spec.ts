import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SyncService } from './sync.service';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { Bitrix24ClientService } from '../bitrix24/bitrix24-client.service';
import { MappingConfigService } from '../config/mapping-config.service';

/** Kiểm thử hiệu năng với hơn 100 bản ghi theo yêu cầu đề bài.
 * Giả lập độ trễ mạng để kiểm tra giới hạn song song SYNC_BITRIX_CONCURRENCY
 * và số lời gọi ghi batch bằng ceil(N/50), tránh phụ thuộc vào API thật.
 * Chạy riêng bằng npm run test:performance; kiểm thử cần vài giây do độ trễ giả lập. */
describe('SyncService performance (100+ records)', () => {
  const DEDUP_LATENCY_MS = 20; // Giả lập độ trễ một lượt kiểm tra trùng trên Bitrix24.
  const ROW_COUNT = 150;
  const CONCURRENCY = 5;

  let service: SyncService;
  const mockSheets = {
    readRows: jest.fn(),
    writeStatusBatch: jest.fn(),
    ensureLayout: jest.fn(async (headers, required) => [...new Set([...headers, ...required])]),
  };
  const mockBitrix = {
    findLeadByEmailOrPhone: jest.fn(
      () => new Promise((resolve) => setTimeout(() => resolve(null), DEDUP_LATENCY_MS)),
    ),
    batchWrite: jest.fn(),
    buildCommand: jest.fn((method: string) => `${method}?fields[NAME]=x`),
  };
  const mockConfigService = {
    get: (key: string, fallback: unknown) =>
      key === 'SYNC_BITRIX_CONCURRENCY' ? CONCURRENCY : fallback,
  };
  const mappingConfig = {
    columns: { 'Tên khách hàng': 'NAME', Email: 'EMAIL[0][VALUE]' },
    statusColumns: {
      leadId: 'Lead ID Bitrix24',
      syncStatus: 'Trạng thái đồng bộ',
      lastSyncedAt: 'Thời gian đồng bộ cuối',
      errorMessage: 'Thông báo lỗi',
      syncHash: 'Sync Hash',
    },
    dedupFields: ['Email'],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: GoogleSheetsService, useValue: mockSheets },
        { provide: Bitrix24ClientService, useValue: mockBitrix },
        { provide: MappingConfigService, useValue: { get: () => mappingConfig } },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(SyncService);
    jest.clearAllMocks();
    mockBitrix.batchWrite.mockImplementation((commands: Record<string, string>) => {
      const result: Record<string, number> = {};
      Object.keys(commands).forEach((key, idx) => (result[key] = idx + 1));
      return Promise.resolve({ result });
    });
  });

  it(`processes ${ROW_COUNT} rows within the expected time bound for concurrency=${CONCURRENCY}`, async () => {
    const rows = Array.from({ length: ROW_COUNT }, (_, i) => ({
      rowNumber: i + 2,
      values: { 'Tên khách hàng': `Person ${i}`, Email: `p${i}@example.com` },
    }));
    mockSheets.readRows.mockResolvedValue({ headers: ['Tên khách hàng', 'Email'], rows });

    const startedAt = Date.now();
    const result = await service.run();
    const elapsedMs = Date.now() - startedAt;

    // Nếu chạy tuần tự sẽ mất ROW_COUNT * DEDUP_LATENCY_MS (khoảng 3000 ms).
    // Khi giới hạn song song, thời gian dự kiến xấp xỉ
    // ceil(ROW_COUNT / CONCURRENCY) * DEDUP_LATENCY_MS, cộng khoảng dự phòng
    // cho sai lệch lịch chạy của bộ kiểm thử; đây là giới hạn kiểm tra hợp lý,
    // không phải phép đo hiệu năng tuyệt đối.
    const expectedMinMs = Math.ceil(ROW_COUNT / CONCURRENCY) * DEDUP_LATENCY_MS;
    const sequentialWorstCaseMs = ROW_COUNT * DEDUP_LATENCY_MS;

    expect(result.totalRows).toBe(ROW_COUNT);
    expect(result.created).toBe(ROW_COUNT);
    expect(result.errors).toBe(0);
    expect(elapsedMs).toBeGreaterThanOrEqual(expectedMinMs * 0.5); // Thực sự có chờ thao tác vào/ra, không chỉ trả về ngay.
    expect(elapsedMs).toBeLessThan(sequentialWorstCaseMs); // Xử lý song song giúp giảm thời gian đo được.
  }, 15000);

  it(`keeps Bitrix24 write calls at ceil(N/50) regardless of dataset size (batching honored)`, async () => {
    const rows = Array.from({ length: ROW_COUNT }, (_, i) => ({
      rowNumber: i + 2,
      values: { 'Tên khách hàng': `Person ${i}`, Email: `p${i}@example.com` },
    }));
    mockSheets.readRows.mockResolvedValue({ headers: ['Tên khách hàng', 'Email'], rows });

    await service.run();

    expect(mockBitrix.batchWrite).toHaveBeenCalledTimes(Math.ceil(ROW_COUNT / 50));
  }, 15000);

  it('batches pending and final Sheet statuses, regardless of row count', async () => {
    const rows = Array.from({ length: ROW_COUNT }, (_, i) => ({
      rowNumber: i + 2,
      values: { 'Tên khách hàng': `Person ${i}`, Email: `p${i}@example.com` },
    }));
    mockSheets.readRows.mockResolvedValue({ headers: ['Tên khách hàng', 'Email'], rows });

    await service.run();

    expect(mockSheets.writeStatusBatch).toHaveBeenCalledTimes(2);
    expect(mockSheets.writeStatusBatch.mock.calls[0][1]).toHaveLength(ROW_COUNT);
    expect(mockSheets.writeStatusBatch.mock.calls[0][1][0].values['Trạng thái đồng bộ']).toBe(
      'Chờ xử lý',
    );
    expect(mockSheets.writeStatusBatch.mock.calls[1][1][0].values['Trạng thái đồng bộ']).toBe(
      'Đã đồng bộ',
    );
  }, 15000);
});
