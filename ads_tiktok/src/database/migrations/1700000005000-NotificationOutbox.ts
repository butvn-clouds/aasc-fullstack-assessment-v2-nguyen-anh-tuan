import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationOutbox1700000005000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE notification_outbox (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_key TEXT NOT NULL UNIQUE,
      event TEXT NOT NULL, payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed','logged')),
      attempts INT NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      lease_token UUID, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), sent_at TIMESTAMPTZ
    )`);
    await q.query(`CREATE INDEX notification_outbox_pending ON notification_outbox(next_attempt_at)
      WHERE status IN ('pending','processing')`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE notification_outbox');
  }
}
