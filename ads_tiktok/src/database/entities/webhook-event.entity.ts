import { LeadPayload } from '../../common/payload';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Lưu raw payload để audit/debug và làm khóa idempotency (event_id). */
@Entity('webhook_events')
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'event_id', unique: true }) eventId: string;
  @Column({ default: 'tiktok' }) source: string;
  @Column({ name: 'event_type' }) eventType: string;
  @Column({ type: 'jsonb' }) payload: LeadPayload;
  @Index() @Column({ default: 'received' }) status: string; // received | processed | failed
  @Column({ type: 'text', nullable: true }) error: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
