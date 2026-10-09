import { MigrationInterface, QueryRunner } from 'typeorm';

/** Lưu email/SĐT phụ khi gộp lead trùng, có GIN index để dedup theo cả giá trị phụ. */
export class LeadExtraContacts1700000003000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE leads ADD COLUMN extra_contacts JSONB NOT NULL DEFAULT '{"emails":[],"phones":[]}'`);
    await q.query(`CREATE INDEX idx_leads_extra_contacts ON leads USING GIN (extra_contacts jsonb_path_ops)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX idx_leads_extra_contacts`);
    await q.query(`ALTER TABLE leads DROP COLUMN extra_contacts`);
  }
}
