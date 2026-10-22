import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import {
  RemediationAction,
  RemediationActionType,
  RemediationStatus,
} from '../entities/remediation-action.entity';

/** Filters accepted by the history query endpoint. */
export interface RemediationHistoryQuery {
  status?: RemediationStatus;
  actionType?: RemediationActionType;
  issueId?: string;
  target?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

/** Aggregated counters for a target over a time window. */
export interface TargetHistorySummary {
  total: number;
  success: number;
  failed: number;
  skipped: number;
}

/**
 * RemediationHistoryService
 *
 * Persists every remediation attempt. The records are append-only from a
 * business perspective: they form the audit trail used both by the
 * analytics endpoint and by the root cause analysis (a target that was
 * already remediated recently is unlikely to be the cause of a new issue).
 */
@Injectable()
export class RemediationHistoryService {
  private readonly logger = new Logger(RemediationHistoryService.name);

  constructor(
    @InjectRepository(RemediationAction)
    private readonly remediationActionRepo: Repository<RemediationAction>,
  ) {}

  /**
   * Persist a new remediation record.
   */
  async record(
    entry: Partial<RemediationAction>,
  ): Promise<RemediationAction | null> {
    try {
      const action = this.remediationActionRepo.create(entry);
      return await this.remediationActionRepo.save(action);
    } catch (error) {
      this.logger.error(
        `Failed to persist remediation history entry: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return null;
    }
  }

  /**
   * Update an existing remediation record.
   */
  async update(
    id: string,
    changes: Partial<RemediationAction>,
  ): Promise<RemediationAction | null> {
    try {
      const action = await this.remediationActionRepo.findOne({
        where: { id },
      });
      if (!action) {
        return null;
      }
      Object.assign(action, changes);
      return await this.remediationActionRepo.save(action);
    } catch (error) {
      this.logger.error(
        `Failed to update remediation history entry ${id}: ${
          (error as Error).message
        }`,
        (error as Error).stack,
      );
      return null;
    }
  }

  /**
   * Query the remediation history with optional filters and pagination.
   */
  async find(
    query: RemediationHistoryQuery,
  ): Promise<{ data: RemediationAction[]; total: number }> {
    const where: any = {};

    if (query.status) {
      where.status = query.status;
    }
    if (query.actionType) {
      where.actionType = query.actionType;
    }
    if (query.issueId) {
      where.issueId = query.issueId;
    }
    if (query.target) {
      where.target = query.target;
    }
    if (query.from || query.to) {
      where.createdAt = Between(
        query.from ?? new Date(0),
        query.to ?? new Date(),
      );
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 20), 100);

    const [data, total] = await this.remediationActionRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total };
  }

  /**
   * Summarise the remediation attempts recorded for a target in the last
   * `minutes` minutes.
   */
  async summariseTargetHistory(
    target: string,
    minutes = 60,
  ): Promise<TargetHistorySummary> {
    const since = new Date(Date.now() - minutes * 60_000);
    const actions = await this.remediationActionRepo.find({
      where: { target, createdAt: Between(since, new Date()) },
    });

    return {
      total: actions.length,
      success: actions.filter((action) => action.status === 'success').length,
      failed: actions.filter((action) => action.status === 'failed').length,
      skipped: actions.filter((action) => action.status === 'skipped').length,
    };
  }

  /**
   * Count the executions of an action type for a target inside a window.
   * Used by the safety checks for rate limiting.
   */
  async countRecentExecutions(
    actionType: RemediationActionType,
    target: string,
    minutes: number,
  ): Promise<number> {
    const since = new Date(Date.now() - minutes * 60_000);
    const actions = await this.remediationActionRepo.find({
      where: {
        actionType,
        target,
        createdAt: Between(since, new Date()),
      },
    });

    return actions.filter((action) =>
      ['success', 'executing', 'approved'].includes(action.status),
    ).length;
  }

  /**
   * Return the most recent successful action for a target, if any.
   */
  async findLastSuccessful(
    actionType: RemediationActionType,
    target: string,
  ): Promise<RemediationAction | null> {
    const actions = await this.remediationActionRepo.find({
      where: { actionType, target, status: 'success' },
      order: { createdAt: 'DESC' },
      take: 1,
    });

    return actions[0] ?? null;
  }
}
