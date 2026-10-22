import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { TradeDeal } from '../../trade-deals/entities/trade-deal.entity';

/** Mirrors the contract's `DisputePhase` enum (#1004). */
export type DisputePhase = 'open' | 'arbitration' | 'verdict' | 'resolved';

/** Mirrors the contract's `DisputeOutcome` enum (#1004). */
export type DisputeOutcome = 'release' | 'refund';

export interface DisputeEvidenceEntry {
  submitter: string;
  uri: string;
  /** Ledger close time of the event that attached this evidence (ISO string). */
  submittedAt: string;
  txHash: string;
}

export interface DisputeVoteEntry {
  voter: string;
  release: boolean;
  txHash: string;
}

/**
 * Local projection of one on-chain milestone dispute (issue #1004).
 *
 * The FarmCampaign contract is authoritative — this row exists so the dispute
 * status can be read without an RPC round-trip and so the evidence trail is
 * queryable. Rows are written by the Soroban event listener, keyed by
 * (contractId, milestoneIndex) because the contract only allows one dispute
 * per milestone.
 */
@Index(['dealId'])
@Unique('uq_contract_disputes_contract_milestone', [
  'contractId',
  'milestoneIndex',
])
@Entity('contract_disputes')
export class ContractDispute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contract_id', type: 'varchar', length: 64 })
  contractId: string;

  @Column({ name: 'deal_id', type: 'uuid', nullable: true })
  dealId: string | null;

  @ManyToOne(() => TradeDeal, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'deal_id' })
  deal: TradeDeal | null;

  @Column({ name: 'milestone_index', type: 'int' })
  milestoneIndex: number;

  @Column({ name: 'raised_by', type: 'varchar', length: 56 })
  raisedBy: string;

  @Column({
    name: 'phase',
    type: 'varchar',
    length: 16,
    default: 'open',
  })
  phase: DisputePhase;

  @Column({ name: 'voting_deadline', type: 'timestamp with time zone' })
  votingDeadline: Date;

  @Column({ name: 'release_votes', type: 'int', default: 0 })
  releaseVotes: number;

  @Column({ name: 'refund_votes', type: 'int', default: 0 })
  refundVotes: number;

  @Column({ name: 'outcome', type: 'varchar', length: 16, nullable: true })
  outcome: DisputeOutcome | null;

  @Column({ name: 'evidence_json', type: 'jsonb', nullable: true })
  evidenceJson: DisputeEvidenceEntry[] | null;

  @Column({ name: 'votes_json', type: 'jsonb', nullable: true })
  votesJson: DisputeVoteEntry[] | null;

  @Column({
    name: 'opened_tx_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  openedTxHash: string | null;

  @Column({
    name: 'resolved_tx_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  resolvedTxHash: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
