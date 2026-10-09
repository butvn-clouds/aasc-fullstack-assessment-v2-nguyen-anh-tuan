import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('configurations')
export class Configuration {
  @PrimaryGeneratedColumn() id: number;
  @Column({ unique: true }) key: string;
  @Column({ type: 'jsonb' }) value: unknown;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
