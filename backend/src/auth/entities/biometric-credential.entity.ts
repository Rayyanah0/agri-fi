import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export type BiometricModality = 'fingerprint' | 'facial' | 'voice';

@Entity('biometric_credentials')
@Index(['userId', 'credentialId'], { unique: true })
export class BiometricCredential {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'credential_id', unique: true })
  credentialId: string;

  @Column({ name: 'public_key', type: 'text' })
  publicKey: string;

  @Column({ name: 'sign_count', type: 'int', default: 0 })
  signCount: number;

  @Column({ name: 'device_name', nullable: true })
  deviceName: string;

  @Column({
    name: 'biometric_type',
    type: 'varchar',
    default: 'fingerprint',
  })
  biometricType: BiometricModality;

  @Column({ name: 'aaguid', nullable: true })
  aaguid: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'last_used_at', type: 'timestamp', nullable: true })
  lastUsedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
