import { MappingConfigService } from './mapping-config.service';
import { buildBitrixFields, normalizeContact } from '../sync/row-hash.util';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Tương thích mapping sau hợp nhất', () => {
  it.each(['mapping.json', 'mapping.advanced.example.json'])(
    'validates shipped configuration %s',
    (file) => {
      const service = new MappingConfigService();
      const mapping = (service as any).parseAndValidate(
        readFileSync(join(process.cwd(), 'config', file), 'utf8'),
      );
      const fields = buildBitrixFields(
        {
          'Tên khách hàng': 'Demo',
          Email: ' DEMO@EXAMPLE.COM ; second@example.com',
          'Số điện thoại': '0901234567',
          'Trạng thái': 'NEW',
          'Ngân sách dự kiến': '10tr',
          'Người phụ trách': '1',
        },
        mapping.columns,
        {},
        mapping.transforms,
        mapping.dedupFields,
        mapping.additionalFields,
      );
      expect(fields).toMatchObject({
        TITLE: 'Demo',
        NAME: 'Demo',
        STATUS_ID: 'NEW',
        ASSIGNED_BY_ID: '1',
        OPPORTUNITY: 10000000,
      });
      expect(fields.EMAIL).toHaveLength(2);
    },
  );
  it('preserves date, enum labels and reverse rules in legacy files', () => {
    const current = JSON.parse(readFileSync(join(process.cwd(), 'config', 'mapping.json'), 'utf8'));
    const base: any = { statusColumns: current.statusColumns };
    base.fields = [
      { sheetColumn: 'Date', bitrixField: 'UF_DATE', type: 'date' },
      { sheetColumn: 'Status', bitrixField: 'STATUS_ID', type: 'enum', values: { Mới: 'NEW' } },
    ];
    base.dedupeColumns = {};
    base.reverseColumns = { STATUS_ID: 'Status' };
    const mapping = (new MappingConfigService() as any).parseAndValidate(JSON.stringify(base));
    expect(mapping.reverseColumns).toEqual(base.reverseColumns);
    expect(
      buildBitrixFields(
        { Date: '28/09/2026', Status: 'Mới' },
        mapping.columns,
        {},
        mapping.transforms,
      ),
    ).toEqual({ UF_DATE: '2026-09-28', STATUS_ID: 'NEW' });
  });
  it('giữ một cột ra TITLE và NAME, required, number và multi-value', () => {
    const service = new MappingConfigService();
    const mapping = (service as any).parseAndValidate(
      JSON.stringify({
        statusColumns: {
          leadId: 'ID',
          syncHash: 'Hash',
          syncStatus: 'Sync',
          lastSyncedAt: 'Time',
          errorMessage: 'Error',
        },
        dedupeColumns: { email: 'Email' },
        fields: [
          { sheetColumn: 'Name', bitrixField: 'TITLE', required: true },
          { sheetColumn: 'Name', bitrixField: 'NAME', required: true },
          { sheetColumn: 'Email', bitrixField: 'EMAIL', multiValue: true, valueType: 'WORK' },
          { sheetColumn: 'Budget', bitrixField: 'OPPORTUNITY', type: 'number' },
        ],
      }),
    );
    const row = { Name: 'Test', Email: 'A@example.com;b@example.com', Budget: '10tr' };
    const build = (values: Record<string, string>) =>
      buildBitrixFields(
        values,
        mapping.columns,
        normalizeContact(values, mapping.dedupFields),
        mapping.transforms,
        mapping.dedupFields,
        mapping.additionalFields,
      );
    expect(build(row)).toMatchObject({
      TITLE: 'Test',
      NAME: 'Test',
      OPPORTUNITY: 10000000,
      EMAIL: [
        { VALUE: 'a@example.com', VALUE_TYPE: 'WORK' },
        { VALUE: 'b@example.com', VALUE_TYPE: 'WORK' },
      ],
    });
    expect(() => build({ ...row, Name: '' })).toThrow();
  });
});
