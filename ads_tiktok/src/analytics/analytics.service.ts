import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CONFIG_KEYS } from '../common/constants';
import { ConfigStoreService } from '../config/config-store.service';
import { parseDateRange } from './date-range';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
export { parseDateRange } from './date-range';

interface CampaignMetrics {
  campaign_id: string | null;
  leads: number;
  deals: number;
  won: number;
  revenue: number | null;
  avg_score: number;
}
export type ExportRow = Record<string, unknown>;
const MODE_FILTER = `(l.bitrix_mode = $2 OR EXISTS (
  SELECT 1 FROM deals linked WHERE linked.lead_id = l.id AND linked.bitrix_mode = $2
))`;
const EXPORT_SQL = `SELECT l.id, l.name, l.email, l.phone, l.city, l.campaign_id, l.ad_id, l.score, l.status,
  CASE WHEN l.bitrix_mode = $2 THEN l.bitrix24_id END AS bitrix24_id,
  d.stage AS deal_stage, d.status AS deal_status, d.amount AS deal_amount, l.created_at
  FROM leads l LEFT JOIN deals d ON d.lead_id = l.id AND d.bitrix_mode = $2
  WHERE l.created_at >= $1 AND ${MODE_FILTER} ORDER BY l.created_at DESC, l.id DESC`;

export const rate = (num: number, den: number) => (den > 0 ? Number((num / den).toFixed(4)) : 0);

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly store: ConfigStoreService,
    private readonly config: ConfigService,
  ) {}

  private get mode(): 'mock' | 'real' {
    return String(this.config.get('BITRIX24_MOCK', 'false')).toLowerCase() === 'true' ? 'mock' : 'real';
  }

  private async perCampaign(since: Date) {
    const rows = await this.ds.query(
      `SELECT l.campaign_id, COUNT(DISTINCT l.id)::int AS leads,
              COUNT(DISTINCT d.id)::int AS deals,
              COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'won')::int AS won,
              CASE WHEN COUNT(*) FILTER (WHERE d.status='won' AND d.currency<>'VND') > 0 THEN NULL
                ELSE COALESCE(SUM(d.amount) FILTER (WHERE d.status = 'won'), 0)::float END AS revenue,
              COALESCE(AVG(l.score), 0)::float AS avg_score
         FROM leads l LEFT JOIN deals d ON d.lead_id = l.id AND d.bitrix_mode = $2
        WHERE l.created_at >= $1 AND ${MODE_FILTER} GROUP BY l.campaign_id ORDER BY leads DESC`,
      [since, this.mode],
    );
    return rows as CampaignMetrics[];
  }

  async conversionRates(range = '30d') {
    const rows = await this.perCampaign(parseDateRange(range));
    return this.conversionFrom(rows, range);
  }

  private conversionFrom(rows: CampaignMetrics[], range: string) {
    const total = rows.reduce((a, r) => ({ leads: a.leads + r.leads, deals: a.deals + r.deals, won: a.won + r.won }), {
      leads: 0,
      deals: 0,
      won: 0,
    });
    return {
      range,
      overall: {
        ...total,
        lead_to_deal: rate(total.deals, total.leads),
        deal_to_won: rate(total.won, total.deals),
        lead_to_won: rate(total.won, total.leads),
      },
      campaigns: rows.map((r) => ({
        campaign_id: r.campaign_id,
        leads: r.leads,
        deals: r.deals,
        won: r.won,
        lead_to_deal: rate(r.deals, r.leads),
        lead_to_won: rate(r.won, r.leads),
      })),
    };
  }

  async campaignPerformance(range = '30d') {
    const since = parseDateRange(range);
    const costs = await this.store.get<Record<string, number>>(CONFIG_KEYS.COSTS);
    const rows = await this.perCampaign(since);
    return this.performanceFrom(rows, costs);
  }

  private performanceFrom(rows: CampaignMetrics[], costs: Record<string, number>) {
    return rows.map((r) => {
      const spend = Number(costs?.[r.campaign_id ?? ''] ?? 0);
      return {
        campaign_id: r.campaign_id,
        leads: r.leads,
        won: r.won,
        revenue: r.revenue,
        currency: 'VND',
        revenue_valid: r.revenue !== null,
        spend,
        cost_per_lead: r.leads ? Number((spend / r.leads).toFixed(2)) : 0,
        roi: spend > 0 && r.revenue !== null ? Number(((r.revenue - spend) / spend).toFixed(4)) : null,
        avg_lead_score: Number(r.avg_score.toFixed(1)),
      };
    });
  }

  async snapshot(range: string) {
    const since = parseDateRange(range);
    const [rows, costs] = await Promise.all([
      this.perCampaign(since),
      this.store.get<Record<string, number>>(CONFIG_KEYS.COSTS),
    ]);
    return { conversion: this.conversionFrom(rows, range), campaigns: this.performanceFrom(rows, costs) };
  }

  exportLeads(range = '30d') {
    return this.ds.query<ExportRow[]>(EXPORT_SQL, [parseDateRange(range), this.mode]);
  }

  /** Con trỏ PostgreSQL đọc từng phần; hủy luồng và trả kết nối kể cả khi bên nhận ngắt. */
  async *streamLeads(range = '30d', signal?: AbortSignal): AsyncGenerator<ExportRow> {
    const since = parseDateRange(range);
    const runner = this.ds.createQueryRunner();
    let stream: Readable | undefined;
    const abort = () => stream?.destroy(new Error('Đã hủy đọc dữ liệu báo cáo'));
    try {
      signal?.throwIfAborted();
      await runner.connect();
      stream = (await runner.stream(EXPORT_SQL, [since, this.mode])) as Readable;
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      for await (const row of stream) yield row as ExportRow;
    } finally {
      signal?.removeEventListener('abort', abort);
      stream?.destroy();
      if (stream) await finished(stream).catch(() => undefined);
      await runner.release();
    }
  }
}

export function csvRow(row: ExportRow, cols: string[]): string {
  const esc = (v: unknown) => {
    let s = v instanceof Date ? v.toISOString() : v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // chặn CSV/formula injection
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return cols.map((c) => esc(row[c])).join(',');
}

export function toCsv(rows: ExportRow[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  return [cols.join(','), ...rows.map((row) => csvRow(row, cols))].join('\n');
}
