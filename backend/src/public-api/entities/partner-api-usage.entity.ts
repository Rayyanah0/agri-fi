import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type PartnerTier = 'free' | 'standard' | 'premium';

@Entity('partner_api_usage')
export class PartnerApiUsage {
  @PrimaryColumn({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ type: 'varchar', length: 16, default: 'free' })
  tier: PartnerTier;

  @Column({ name: 'monthly_quota_override', type: 'integer', nullable: true })
  monthlyQuotaOverride: number | null;

  @Column({ name: 'last_alerted_month', type: 'varchar', length: 7, nullable: true })
  lastAlertedMonth: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}