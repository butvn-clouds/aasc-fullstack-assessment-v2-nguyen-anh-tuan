import { MigrationInterface, QueryRunner } from 'typeorm';

export class Reliability1700000002000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE UNIQUE INDEX uq_deals_lead ON deals(lead_id) WHERE lead_id IS NOT NULL`);
    await q.query(
      `CREATE UNIQUE INDEX uq_mock_origin ON bitrix_mock_records(kind, (fields->>'ORIGIN_ID')) WHERE fields->>'ORIGIN_ID' IS NOT NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX uq_interaction_event ON lead_events(lead_id, (meta->>'eventId')) WHERE type='interaction'`,
    );
    await q.query(`CREATE TABLE conversion_outbox (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_key VARCHAR(255) UNIQUE NOT NULL,
      payload JSONB NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), sent_at TIMESTAMPTZ
    )`);
    await q.query(`CREATE INDEX idx_conversion_pending ON conversion_outbox(status, next_attempt_at)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE conversion_outbox');
    for (const name of ['uq_interaction_event', 'uq_mock_origin', 'uq_deals_lead']) await q.query(`DROP INDEX ${name}`);
  }
}
