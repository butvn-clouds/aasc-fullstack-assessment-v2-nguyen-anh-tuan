import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('deals')
export class Deal {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index() @Column({ name: 'lead_id', type: 'uuid', nullable: true }) leadId: string | null;
  @Column({ name: 'bitrix24_id', type: 'int', nullable: true }) bitrix24Id: number | null;
  @Column({ name: 'bitrix_mode', type: 'varchar', length: 10, default: 'real' })
  bitrixMode: 'mock' | 'real' | 'legacy';
  @Column() title: string;
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: { to: (v) => v, from: (v) => (v == null ? null : Number(v)) },
  })
  amount: number | null;
  @Column({ length: 3, default: 'VND' }) currency: string;
  @Column({ type: 'varchar', nullable: true }) stage: string | null;
  @Column({ name: 'pipeline_id', type: 'varchar', nullable: true }) pipelineId: string | null;
  @Column({ type: 'int', default: 0 }) probability: number;
  @Index() @Column({ default: 'open' }) status: string; // open | won | lost
  @Index() @Column({ name: 'assigned_to', type: 'varchar', nullable: true }) assignedTo: string | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
