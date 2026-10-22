import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  FarmerCreditScoreDispute,
  CreditScoreDisputeStatus,
} from './entities/farmer-credit-score-dispute.entity';
import { CreateCreditScoreDisputeDto } from './dto/create-credit-score-dispute.dto';
import { ResolveCreditScoreDisputeDto } from './dto/resolve-credit-score-dispute.dto';
import { FarmerCreditScoringService } from './farmer-credit-scoring.service';
import { FarmerCreditPerformanceService } from './farmer-credit-performance.service';

/**
 * Lets a farmer challenge a credit score they believe is wrong, and lets
 * an administrator correct it.
 *
 * A farmer may only have one dispute in flight at a time, so the review
 * queue stays unambiguous.
 */
@Injectable()
export class FarmerCreditDisputeService {
  private readonly logger = new Logger(FarmerCreditDisputeService.name);

  constructor(
    @InjectRepository(FarmerCreditScoreDispute)
    private readonly disputeRepository: Repository<FarmerCreditScoreDispute>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly scoringService: FarmerCreditScoringService,
    private readonly performanceService: FarmerCreditPerformanceService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Files a dispute against the farmer's current score.
   */
  async fileDispute(
    userId: string,
    dto: CreateCreditScoreDisputeDto,
  ): Promise<FarmerCreditScoreDispute> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    if (user.role !== 'farmer') {
      throw new ForbiddenException(
        'Only farmers can dispute their credit score.',
      );
    }

    const openDispute = await this.disputeRepository.findOne({
      where: { userId, status: In(['open', 'under_review']) },
    });
    if (openDispute) {
      throw new BadRequestException(
        'You already have a credit score dispute under review. Wait for it to be resolved before filing another.',
      );
    }

    const dispute = this.disputeRepository.create({
      userId,
      disputedScore: user.creditScore ?? 0,
      reason: dto.reason.trim(),
      factor: dto.factor ?? null,
      status: 'open',
      resolution: null,
      correctedScore: null,
      resolvedBy: null,
      resolvedAt: null,
    });

    const saved = await this.disputeRepository.save(dispute);
    this.logger.log(
      `Credit score dispute ${saved.id} filed by farmer ${userId} (factor: ${saved.factor ?? 'unspecified'})`,
    );

    return saved;
  }

  /** The disputes a farmer filed. */
  async listForFarmer(userId: string): Promise<FarmerCreditScoreDispute[]> {
    return this.disputeRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /** The administrator review queue. */
  async listDisputes(
    status?: CreditScoreDisputeStatus,
  ): Promise<FarmerCreditScoreDispute[]> {
    return this.disputeRepository.find({
      where: status ? { status } : {},
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Closes a dispute.
   *
   * Upholding a dispute either applies the administrator's corrected score
   * or, when no score is supplied, re-measures the farmer from their
   * corrected history.
   */
  async resolveDispute(
    adminId: string,
    disputeId: string,
    dto: ResolveCreditScoreDisputeDto,
  ): Promise<FarmerCreditScoreDispute> {
    const dispute = await this.disputeRepository.findOne({
      where: { id: disputeId },
    });
    if (!dispute) {
      throw new NotFoundException('Credit score dispute not found.');
    }
    if (dispute.status === 'resolved' || dispute.status === 'rejected') {
      throw new BadRequestException(
        `This dispute was already ${dispute.status}.`,
      );
    }

    let correctedScore: number | null = null;

    if (dto.status === 'resolved') {
      if (dto.correctedScore !== undefined && dto.correctedScore !== null) {
        await this.scoringService.manualOverride(
          adminId,
          dispute.userId,
          dto.correctedScore,
          `Credit score dispute ${dispute.id} upheld: ${dto.resolution}`,
        );
        correctedScore = dto.correctedScore;
      } else {
        // No explicit score: re-measure the farmer from their (now
        // corrected) history so the fix flows from the data.
        const outcome = await this.performanceService.recalculate(
          dispute.userId,
          `Credit score dispute ${dispute.id} upheld: ${dto.resolution}`,
        );
        correctedScore = outcome.score;
      }
    }

    dispute.status = dto.status;
    dispute.resolution = dto.resolution.trim();
    dispute.correctedScore = correctedScore;
    dispute.resolvedBy = adminId;
    dispute.resolvedAt = new Date();

    const saved = await this.disputeRepository.save(dispute);

    await this.notifyResolution(dispute);

    return saved;
  }

  /**
   * Tells the farmer how their dispute was handled.
   */
  private async notifyResolution(
    dispute: FarmerCreditScoreDispute,
  ): Promise<void> {
    try {
      const upheld = dispute.status === 'resolved';
      await this.notificationsService.createNotification({
        userId: dispute.userId,
        type: 'alert',
        title: upheld
          ? 'Credit score dispute upheld'
          : 'Credit score dispute rejected',
        message: upheld
          ? `Your credit score dispute was upheld. Your score is now ${dispute.correctedScore}. ${dispute.resolution}`
          : `Your credit score dispute was not upheld. ${dispute.resolution}`,
        linkUrl: '/dashboard/farmer',
        metadataJson: {
          disputeId: dispute.id,
          status: dispute.status,
          correctedScore: dispute.correctedScore,
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `Failed to notify dispute resolution for ${dispute.id}: ${err.message}`,
      );
    }
  }
}
