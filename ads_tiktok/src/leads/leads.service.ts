import { LeadPayload } from '../common/payload';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Lead, LeadEvent } from '../database/entities';

export interface UpsertInput {
  bitrixMode?: 'mock' | 'real';
  externalId: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  campaignId: string | null;
  adId: string | null;
  formId: string | null;
  score: number;
  rawData: LeadPayload;
}

function collectExtra(primary: string | null, incoming: string | null, known: string[]): string[] {
  return incoming && primary && incoming !== primary && !known.includes(incoming) ? [incoming] : [];
}

/** Giữ attribution first-touch (campaign, form, ttclid); phần còn lại lấy từ payload mới nhất. */
export function mergeRawData(existing: LeadPayload | null, incoming: LeadPayload): LeadPayload {
  if (!existing) return incoming;
  const firstTtclid = existing.lead_data?.ttclid;
  return {
    ...incoming,
    campaign: existing.campaign ?? incoming.campaign,
    form: existing.form ?? incoming.form,
    lead_data: { ...incoming.lead_data, ...(firstTtclid ? { ttclid: firstTtclid } : {}) },
  };
}

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(LeadEvent) private readonly timeline: Repository<LeadEvent>,
    private readonly ds: DataSource,
  ) {}

  /** Khóa theo liên hệ đầu vào; giữ dữ liệu chính cũ và bổ sung liên hệ phụ khi gộp. */ async upsert(
    input: UpsertInput,
  ): Promise<{ lead: Lead; created: boolean }> {
    const keys = [
      `ext:${input.externalId}`,
      ...(input.email ? [`email:${input.email}`] : []),
      ...(input.phone ? [`phone:${input.phone}`] : []),
    ].sort();
    return this.ds.transaction(async (m: EntityManager) => {
      for (const key of keys) await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
      const qb = m.getRepository(Lead).createQueryBuilder('l');
      const ors: string[] = [];
      const params: Record<string, string> = { ext: input.externalId };
      ors.push('l.external_id = :ext');
      if (input.email) {
        ors.push('l.email = :email', `l.extra_contacts->'emails' @> to_jsonb(CAST(:email AS text))`);
        params.email = input.email;
      }
      if (input.phone) {
        ors.push('l.phone = :phone', `l.extra_contacts->'phones' @> to_jsonb(CAST(:phone AS text))`);
        params.phone = input.phone;
      }
      const existing = await qb.where(ors.join(' OR '), params).orderBy('l.created_at', 'ASC').getOne();

      if (!existing) {
        const lead = await m
          .getRepository(Lead)
          .save(m.getRepository(Lead).create({ ...input, source: 'tiktok', status: 'new' }));
        await m.getRepository(LeadEvent).save({
          leadId: lead.id,
          type: 'created',
          message: 'Đã tạo khách hàng tiềm năng từ TikTok',
          meta: { campaignId: input.campaignId, adId: input.adId },
        });
        return { lead, created: true };
      }

      const extra = existing.extraContacts ?? { emails: [], phones: [] };
      const addedEmails = collectExtra(existing.email, input.email, extra.emails);
      const addedPhones = collectExtra(existing.phone, input.phone, extra.phones);
      const merged: Partial<Lead> = {
        extraContacts: { emails: [...extra.emails, ...addedEmails], phones: [...extra.phones, ...addedPhones] },
        email: existing.email ?? input.email,
        phone: existing.phone ?? input.phone,
        city: existing.city ?? input.city,
        campaignId: existing.campaignId ?? input.campaignId,
        adId: existing.adId ?? input.adId,
        formId: existing.formId ?? input.formId,
        score: Math.max(existing.score, input.score),
        rawData: mergeRawData(existing.rawData, input.rawData),
      };
      Object.assign(existing, merged);
      await m.getRepository(Lead).save(existing);
      await m.getRepository(LeadEvent).save({
        leadId: existing.id,
        type: 'merged',
        message: 'Đã gộp dữ liệu gửi trùng',
        meta: {
          externalId: input.externalId,
          ...(addedEmails.length ? { addedEmails } : {}),
          ...(addedPhones.length ? { addedPhones } : {}),
        },
      });
      return { lead: existing, created: false };
    });
  }

  async list(q: { page?: number; limit?: number; source?: string; status?: string; campaign_id?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 10)));
    const qb = this.leads
      .createQueryBuilder('l')
      .orderBy('l.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    if (q.source) qb.andWhere('l.source = :src', { src: q.source });
    if (q.status) qb.andWhere('l.status = :st', { st: q.status });
    if (q.campaign_id) qb.andWhere('l.campaign_id = :c', { c: q.campaign_id });
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }

  async getOrFail(id: string) {
    const lead = await this.leads.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Không tìm thấy khách hàng tiềm năng');
    return lead;
  }

  findByExternalId(externalId: string) {
    return this.leads.findOne({ where: { externalId } });
  }
  async withSyncLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    const runner = this.ds.createQueryRunner();
    await runner.connect();
    let locked = false;
    try {
      await runner.query('SELECT pg_advisory_lock(hashtext($1))', [`crm-sync:${id}`]);
      locked = true;
      return await work();
    } finally {
      try {
        if (locked) await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [`crm-sync:${id}`]);
      } finally {
        await runner.release();
      }
    }
  }

  async recordInteraction(leadId: string, type: string, eventId: string) {
    await this.ds.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`engagement:${leadId}`]);
      const inserted = await m.query(
        `INSERT INTO lead_events(lead_id,type,message,meta)
        VALUES ($1,'interaction',$2,jsonb_build_object('eventId',$3::text)) ON CONFLICT DO NOTHING RETURNING id`,
        [leadId, type, eventId],
      );
      if (inserted.length)
        await m.query('UPDATE leads SET score=LEAST(100, score+$2), updated_at=NOW() WHERE id=$1', [
          leadId,
          type === 'form.complete' ? 10 : 5,
        ]);
    });
  }
  save(lead: Lead) {
    return this.leads.save(lead);
  }
  addEvent(leadId: string, type: string, message: string, meta?: Record<string, unknown>) {
    return this.timeline.save(this.timeline.create({ leadId, type, message, meta: meta ?? null }));
  }
  getTimeline(leadId: string) {
    return this.timeline.find({ where: { leadId }, order: { createdAt: 'ASC' } });
  }
}
