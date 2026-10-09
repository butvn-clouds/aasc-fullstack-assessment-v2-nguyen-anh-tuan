import { ConfigService } from '@nestjs/config';
import { columnIndexToLetter, GoogleSheetsService } from './google-sheets.service';
import { AppConfig } from '../config/configuration';

describe('columnIndexToLetter', () => {
  it('chuyen doi index 0-based sang chu cai kieu Excel', () => {
    expect(columnIndexToLetter(0)).toBe('A');
    expect(columnIndexToLetter(25)).toBe('Z');
    expect(columnIndexToLetter(26)).toBe('AA');
    expect(columnIndexToLetter(27)).toBe('AB');
    expect(columnIndexToLetter(51)).toBe('AZ');
  });
});

describe('GoogleSheetsService', () => {
  function buildServiceWithFakeClient(values: any[][]) {
    const configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'google') return { sheetId: 'sheet-123', worksheetName: 'Leads' };
        if (key === 'sync') return { maxRetries: 1, retryBaseDelayMs: 1 };
        return {};
      }),
    } as unknown as ConfigService<AppConfig, true>;

    const service = new GoogleSheetsService(configService);
    const fakeGet = jest.fn().mockResolvedValue({ data: { values } });
    const fakeBatchUpdate = jest.fn().mockResolvedValue({ data: {} });

    // Gan truc tiep mot fake client (tranh phai xac thuc Google that trong unit test)
    (service as any).sheetsClient = {
      spreadsheets: {
        values: {
          get: fakeGet,
          batchUpdate: fakeBatchUpdate,
        },
      },
    };

    return { service, fakeGet, fakeBatchUpdate };
  }

  it('readRows: chuyen du lieu tho thanh cac hang co header lam key', async () => {
    const { service } = buildServiceWithFakeClient([
      ['Tên khách hàng', 'Email'],
      ['Nguyễn Văn A', 'a@example.com'],
      ['', ''], // hang trong, phai bi bo qua
      ['Lê Thị C', 'c@example.com'],
    ]);

    const { rows } = await service.readRows();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      rowNumber: 2,
      values: { 'Tên khách hàng': 'Nguyễn Văn A', Email: 'a@example.com' },
    });
    expect(rows[1].rowNumber).toBe(4); // giu dung so thu tu hang thuc te tren Sheet, bo qua hang rong
  });

  it('readRows: tra ve mang rong neu Sheet chua co du lieu', async () => {
    const { service } = buildServiceWithFakeClient([]);
    const rows = await service.readRows();
    expect(rows).toEqual({ headers: [], rows: [] });
  });

  it('rejects duplicate headers before one cell can overwrite another', async () => {
    const { service } = buildServiceWithFakeClient([
      ['Email', ' Email '],
      ['a@example.com', 'b@example.com'],
    ]);
    await expect(service.readRows()).rejects.toThrow('tiêu đề cột trùng');
  });

  it('writeStatusBatch: khong goi API neu danh sach update rong', async () => {
    const { service, fakeBatchUpdate } = buildServiceWithFakeClient([['Tên khách hàng']]);
    await service.writeStatusBatch([], []);
    expect(fakeBatchUpdate).not.toHaveBeenCalled();
  });

  it('writeStatusBatch: nem loi neu cot khong ton tai trong header', async () => {
    const { service } = buildServiceWithFakeClient([['Tên khách hàng']]);
    await expect(
      service.writeStatusBatch([], [{ rowNumber: 2, values: { 'Cot khong ton tai': 'x' } }]),
    ).rejects.toThrow(/Không tìm thấy cột/);
  });

  it('ensureLayout giữ vị trí cột cũ, mở rộng lưới và chỉ ghi header mới', async () => {
    const { service, fakeBatchUpdate } = buildServiceWithFakeClient([]);
    const api = (service as any).sheetsClient.spreadsheets;
    api.get = jest.fn().mockResolvedValue({
      data: {
        sheets: [
          {
            properties: {
              sheetId: 7,
              title: 'Leads',
              gridProperties: { rowCount: 2, columnCount: 1 },
            },
          },
        ],
      },
    });
    api.batchUpdate = jest.fn().mockResolvedValue({});
    expect(await service.ensureLayout(['Name'], ['Name', 'ID'], 3)).toEqual(['Name', 'ID']);
    expect(
      api.batchUpdate.mock.calls[0][0].requestBody.requests[0].updateSheetProperties.properties
        .gridProperties,
    ).toEqual({ rowCount: 3, columnCount: 2 });
    expect(fakeBatchUpdate.mock.calls[0][0].requestBody).toEqual({
      valueInputOption: 'RAW',
      data: [{ range: "'Leads'!B1", values: [['ID']] }],
    });
  });

  it('ensureLayout từ chối header trùng trước khi gọi API', async () => {
    const { service, fakeBatchUpdate } = buildServiceWithFakeClient([]);
    await expect(service.ensureLayout(['ID', 'ID'], ['ID'], 2)).rejects.toThrow('trùng');
    expect(fakeBatchUpdate).not.toHaveBeenCalled();
  });

  it('hides only the configured ID column', async () => {
    const { service } = buildServiceWithFakeClient([]);
    const api = (service as any).sheetsClient.spreadsheets;
    api.get = jest.fn().mockResolvedValue({
      data: {
        sheets: [
          {
            properties: {
              sheetId: 7,
              title: 'Leads',
              gridProperties: { rowCount: 10, columnCount: 10 },
            },
          },
        ],
      },
    });
    api.batchUpdate = jest.fn().mockResolvedValue({});
    await service.ensureLayout(['Name', 'ID'], ['ID'], 2, 'ID');
    expect(api.batchUpdate.mock.calls[0][0].requestBody.requests[0]).toEqual({
      updateDimensionProperties: {
        range: { sheetId: 7, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
        properties: { hiddenByUser: true },
        fields: 'hiddenByUser',
      },
    });
  });

  it('detects date formats without converting ordinary numeric cells', async () => {
    const { service } = buildServiceWithFakeClient([
      ['Date', 'Budget'],
      [2, 2],
    ]);
    (service as any).configService.get.mockImplementation((key) =>
      key === 'google'
        ? { sheetId: 'x', worksheetName: 'Leads', detectFormats: true }
        : { maxRetries: 0, retryBaseDelayMs: 1 },
    );
    (service as any).sheetsClient.spreadsheets.get = jest.fn().mockResolvedValue({
      data: {
        sheets: [
          {
            data: [
              {
                startRow: 1,
                rowData: [
                  {
                    values: [
                      { effectiveFormat: { numberFormat: { type: 'DATE' } } },
                      { effectiveFormat: { numberFormat: { type: 'NUMBER' } } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect((await service.readRows()).rows[0].values).toEqual({ Date: '1900-01-01', Budget: '2' });
  });
});
