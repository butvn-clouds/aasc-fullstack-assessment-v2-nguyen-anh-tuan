import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1700000000000 implements MigrationInterface {
  name = 'InitSchema1700000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      external_id VARCHAR(255) UNIQUE NOT NULL,
      source VARCHAR(50) NOT NULL DEFAULT 'tiktok',
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255), phone VARCHAR(50), city VARCHAR(255),
      campaign_id VARCHAR(255), ad_id VARCHAR(255), form_id VARCHAR(255),
      score INTEGER NOT NULL DEFAULT 0,
      raw_data JSONB,
      bitrix24_id INTEGER,
      status VARCHAR(50) NOT NULL DEFAULT 'new',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW())`);
    await q.query(`CREATE INDEX idx_leads_email ON leads(email)`);
    await q.query(`CREATE INDEX idx_leads_phone ON leads(phone)`);
    await q.query(`CREATE INDEX idx_leads_campaign ON leads(campaign_id)`);
    await q.query(`CREATE INDEX idx_leads_status ON leads(status)`);
    await q.query(`CREATE INDEX idx_leads_created ON leads(created_at)`);

    await q.query(`CREATE TABLE deals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
      bitrix24_id INTEGER,
      title VARCHAR(255) NOT NULL,
      amount NUMERIC(18,2),
      currency VARCHAR(3) NOT NULL DEFAULT 'VND',
      stage VARCHAR(50), pipeline_id VARCHAR(50),
      probability INTEGER NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      assigned_to VARCHAR(50),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW())`);
    await q.query(`CREATE INDEX idx_deals_lead ON deals(lead_id)`);
    await q.query(`CREATE INDEX idx_deals_status ON deals(status)`);
    await q.query(`CREATE INDEX idx_deals_assigned ON deals(assigned_to)`);
    await q.query(`CREATE UNIQUE INDEX uq_deals_bitrix ON deals(bitrix24_id) WHERE bitrix24_id IS NOT NULL`);

    await q.query(`CREATE TABLE configurations (
      id SERIAL PRIMARY KEY,
      key VARCHAR(255) UNIQUE NOT NULL,
      value JSONB NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW())`);

    await q.query(`CREATE TABLE webhook_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id VARCHAR(255) UNIQUE NOT NULL,
      source VARCHAR(50) NOT NULL DEFAULT 'tiktok',
      event_type VARCHAR(100) NOT NULL,
      payload JSONB NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'received',
      error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW())`);
    await q.query(`CREATE INDEX idx_webhook_events_status ON webhook_events(status)`);

    await q.query(`CREATE TABLE lead_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      type VARCHAR(50) NOT NULL,
      message TEXT, meta JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW())`);
    await q.query(`CREATE INDEX idx_lead_events_lead ON lead_events(lead_id)`);
  }

  async down(q: QueryRunner): Promise<void> {
    for (const t of ['lead_events', 'webhook_events', 'configurations', 'deals', 'leads']) {
      await q.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
  }
}
