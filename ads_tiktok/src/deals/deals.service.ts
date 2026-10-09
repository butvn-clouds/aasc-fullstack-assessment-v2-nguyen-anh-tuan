import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Deal } from '../database/entities';

@Injectable()
export class DealsService {
  constructor(@InjectRepository(Deal) private readonly repo: Repository<Deal>) {}

  async list(q: { status?: string; assigned_to?: string; page?: number; limit?: number }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 10)));
    const qb = this.repo
      .createQueryBuilder('d')
      .orderBy('d.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    if (q.status) qb.andWhere('d.status = :s', { s: q.status });
    if (q.assigned_to) qb.andWhere('d.assigned_to = :a', { a: q.assigned_to });
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }

  findByLead(leadId: string, bitrixMode: 'mock' | 'real' | 'legacy' = 'real') {
    return this.repo.findOne({ where: { leadId, bitrixMode } });
  }
  findByBitrixId(id: number, bitrixMode: 'mock' | 'real' | 'legacy' = 'real') {
    return this.repo.findOne({ where: { bitrix24Id: id, bitrixMode } });
  }
  /** Recover a retry after Bitrix24 succeeded but the local insert collided.
   * Never attach an existing remote deal to an unrelated lead. */
  async create(data: Partial<Deal>, onCreated?: (deal: Deal, manager: EntityManager) => Promise<void>): Promise<Deal> {
    try {
      if (onCreated)
        return await this.repo.manager.transaction(async (manager) => {
          const deal = await manager.save(Deal, manager.create(Deal, data));
          await onCreated(deal, manager);
          return deal;
        });
      return await this.repo.save(this.repo.create(data));
    } catch (error: unknown) {
      const pgCode =
        (error as { code?: string; driverError?: { code?: string } })?.driverError?.code ??
        (error as { code?: string })?.code;
      if (pgCode !== '23505' || !data.bitrixMode) throw error;
      const existing = data.bitrix24Id != null ? await this.findByBitrixId(data.bitrix24Id, data.bitrixMode) : null;
      const byLead = data.leadId ? await this.findByLead(data.leadId, data.bitrixMode) : null;
      if (existing && existing.leadId === data.leadId) return existing;
      if (byLead && byLead.bitrix24Id === data.bitrix24Id) return byLead;
      throw new ConflictException('Deal đã được liên kết với Lead hoặc Bitrix24 ID khác; cần kiểm tra đồng bộ');
    }
  }
  save(deal: Deal) {
    return this.repo.save(deal);
  }

  async getOrFail(id: string) {
    const d = await this.repo.findOne({ where: { id } });
    if (!d) throw new NotFoundException('Không tìm thấy giao dịch');
    return d;
  }
}
