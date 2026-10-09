import { LeadPayload } from '../../common/payload';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export interface ExtraContacts {
  emails: string[];
  phones: string[];
}

@Entity('leads')
export class Lead {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'external_id', unique: true }) externalId: string;
  @Column({ default: 'tiktok' }) source: string;
  @Column() name: string;

  @Index() @Column({ type: 'varchar', nullable: true }) email: string | null;
  @Index() @Column({ type: 'varchar', nullable: true }) phone: string | null;
  @Column({ type: 'varchar', nullable: true }) city: string | null;

  @Index() @Column({ name: 'campaign_id', type: 'varchar', nullable: true }) campaignId: string | null;
  @Column({ name: 'ad_id', type: 'varchar', nullable: true }) adId: string | null;
  @Column({ name: 'form_id', type: 'varchar', nullable: true }) formId: string | null;

  /** Email/SĐT khác được gửi từ các form trùng người; dùng để dedup lần sau và đồng bộ đủ sang CRM. */
  @Column({ name: 'extra_contacts', type: 'jsonb', default: () => `'{"emails":[],"phones":[]}'` })
  extraContacts: ExtraContacts;

  @Column({ type: 'int', default: 0 }) score: number;
  @Column({ name: 'raw_data', type: 'jsonb', nullable: true }) rawData: LeadPayload | null;
  @Column({ name: 'bitrix24_id', type: 'int', nullable: true }) bitrix24Id: number | null;
  @Column({ name: 'bitrix_mode', type: 'varchar', length: 10, default: 'real' })
  bitrixMode: 'mock' | 'real' | 'legacy';
  @Index() @Column({ default: 'new' }) status: string;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
