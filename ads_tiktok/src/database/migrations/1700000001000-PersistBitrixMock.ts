import { MigrationInterface, QueryRunner } from 'typeorm';

export class PersistBitrixMock1700000001000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE bitrix_mock_records (
      id SERIAL PRIMARY KEY,
      kind VARCHAR(10) NOT NULL CHECK (kind IN ('lead', 'deal')),
      fields JSONB NOT NULL
    )`);
    // Giữ toàn bộ mã CRM đã cấp, kể cả bản ghi có trước lần cập nhật cấu trúc này.
    await q.query(`SELECT setval(pg_get_serial_sequence('bitrix_mock_records', 'id'),
      GREATEST(COALESCE((SELECT MAX(bitrix24_id) FROM leads), 0),
               COALESCE((SELECT MAX(bitrix24_id) FROM deals), 0))::bigint + 1, false)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE bitrix_mock_records');
  }
}
