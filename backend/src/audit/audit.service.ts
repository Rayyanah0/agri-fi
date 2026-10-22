import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemAuditLog } from './entities/system-audit-log.entity';

export type FederatedLearningAuditEventType =
  | 'participant_onboarding'
  | 'round_completion'
  | 'contribution'
  | 'reward'
  | 'poisoning_rejection';

export interface FederatedLearningAuditEvent {
  eventType: FederatedLearningAuditEventType;
  participantId?: string;
  roundId?: string;
  details?: Record<string, any>;
  actorId?: string;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(SystemAuditLog)
    private readonly auditRepository: Repository<SystemAuditLog>,
  ) {}

  async logEvent(
    entry: Partial<SystemAuditLog>,
  ): Promise<SystemAuditLog | null> {
    try {
      const auditLog = this.auditRepository.create(entry);
      return await this.auditRepository.save(auditLog);
    } catch (err: any) {
      this.logger.error(
        `Failed to persist system audit log: ${err?.message || err}`,
        err?.stack,
      );
      return null;
    }
  }

  async findAll(limit = 100): Promise<SystemAuditLog[]> {
    return this.auditRepository.find({
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  /**
   * Log a federated learning participation event so network activity
   * (onboarding, round completion, contributions, rewards, poisoning
   * rejections) is traceable through the system audit log.
   */
  async logFederatedLearningEvent(
    event: FederatedLearningAuditEvent,
  ): Promise<SystemAuditLog | null> {
    const { eventType, participantId, roundId, details, actorId, ipAddress } =
      event;

    const entry: Partial<SystemAuditLog> = {
      action: `federated_learning.${eventType}`,
      actorId,
      ipAddress,
      metadata: {
        eventType,
        participantId,
        roundId,
        ...(details || {}),
      },
    } as Partial<SystemAuditLog>;

    return this.logEvent(entry);
  }

  async logParticipantOnboarding(
    participantId: string,
    details?: Record<string, any>,
  ): Promise<SystemAuditLog | null> {
    return this.logFederatedLearningEvent({
      eventType: 'participant_onboarding',
      participantId,
      details,
    });
  }

  async logRoundCompletion(
    roundId: string,
    details?: Record<string, any>,
  ): Promise<SystemAuditLog | null> {
    return this.logFederatedLearningEvent({
      eventType: 'round_completion',
      roundId,
      details,
    });
  }

  async logContribution(
    participantId: string,
    roundId: string,
    details?: Record<string, any>,
  ): Promise<SystemAuditLog | null> {
    return this.logFederatedLearningEvent({
      eventType: 'contribution',
      participantId,
      roundId,
      details,
    });
  }

  async logReward(
    participantId: string,
    details?: Record<string, any>,
  ): Promise<SystemAuditLog | null> {
    return this.logFederatedLearningEvent({
      eventType: 'reward',
      participantId,
      details,
    });
  }

  async logPoisoningRejection(
    participantId: string,
    roundId: string,
    details?: Record<string, any>,
  ): Promise<SystemAuditLog | null> {
    return this.logFederatedLearningEvent({
      eventType: 'poisoning_rejection',
      participantId,
      roundId,
      details,
    });
  }
}