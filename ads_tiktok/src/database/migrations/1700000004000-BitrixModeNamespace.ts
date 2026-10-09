import { MigrationInterface, QueryRunner } from 'typeorm';

export class BitrixModeNamespace1700000004000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE leads ADD COLUMN bitrix_mode VARCHAR(10) NOT NULL DEFAULT 'legacy'
      CHECK (bitrix_mode IN ('mock', 'real', 'legacy'))`);
    await q.query(`ALTER TABLE deals ADD COLUMN bitrix_mode VARCHAR(10) NOT NULL DEFAULT 'legacy'
      CHECK (bitrix_mode IN ('mock', 'real', 'legacy'))`);
    await q.query(`UPDATE leads l SET bitrix_mode='mock'
      WHERE EXISTS (
        SELECT 1 FROM bitrix_mock_records r
        WHERE r.kind='lead' AND r.id=l.bitrix24_id AND r.fields->>'ORIGIN_ID'=l.id::text
      )`);
    await q.query(`UPDATE deals d SET bitrix_mode='mock'
      WHERE EXISTS (
        SELECT 1 FROM bitrix_mock_records r
        WHERE r.kind='deal' AND r.id=d.bitrix24_id AND r.fields->>'ORIGIN_ID'=d.lead_id::text
      )`);
    await q.query(`ALTER TABLE leads ALTER COLUMN bitrix_mode SET DEFAULT 'real'`);
    await q.query(`ALTER TABLE deals ALTER COLUMN bitrix_mode SET DEFAULT 'real'`);
    await q.query('DROP INDEX uq_deals_lead');
    await q.query('DROP INDEX uq_deals_bitrix');
    await q.query(`CREATE UNIQUE INDEX uq_deals_lead_mode ON deals(lead_id, bitrix_mode) WHERE lead_id IS NOT NULL`);
    await q.query(
      `CREATE UNIQUE INDEX uq_deals_bitrix_mode ON deals(bitrix_mode, bitrix24_id) WHERE bitrix24_id IS NOT NULL`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX uq_deals_bitrix_mode');
    await q.query('DROP INDEX uq_deals_lead_mode');
    await q.query('CREATE UNIQUE INDEX uq_deals_lead ON deals(lead_id) WHERE lead_id IS NOT NULL');
    await q.query('CREATE UNIQUE INDEX uq_deals_bitrix ON deals(bitrix24_id) WHERE bitrix24_id IS NOT NULL');
    await q.query('ALTER TABLE deals DROP COLUMN bitrix_mode');
    await q.query('ALTER TABLE leads DROP COLUMN bitrix_mode');
  }
}
