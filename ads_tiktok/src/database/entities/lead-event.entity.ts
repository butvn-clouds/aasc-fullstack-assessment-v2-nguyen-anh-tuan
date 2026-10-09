import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('lead_events')
export class LeadEvent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ name: 'lead_id', type: 'uuid' }) leadId: string;
  @Column() type: string;
  @Column({ type: 'text', nullable: true }) message: string | null;
  @Column({ type: 'jsonb', nullable: true }) meta: Record<string, unknown> | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
