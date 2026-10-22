import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { rpc, scValToNative } from '@stellar/stellar-sdk';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { ContractDispute } from './entities/contract-dispute.entity';

/**
 * On-chain dispute lifecycle topics emitted by the FarmCampaign contract
 * (#1004). Each carries the milestone index in topic[1].
 */
const DISPUTE_TOPICS = [
  'dispute_raised',
  'dispute_evidence',
  'dispute_vote',
  'dispute_verdict',
  'dispute_resolved',
];

@Injectable()
export class SorobanListenerService implements OnModuleInit {
  private readonly rpcServer: rpc.Server;
  private lastProcessedLedger = 0;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(ContractDispute)
    private readonly disputeRepo: Repository<ContractDispute>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SorobanListenerService.name);

    const rpcUrl = this.config.get<string>(
      'SOROBAN_RPC_URL',
      'https://soroban-testnet.stellar.org',
    );
    this.rpcServer = new rpc.Server(rpcUrl, { allowHttp: false });
  }

  async onModuleInit(): Promise<void> {
    try {
      const latest = await this.rpcServer.getLatestLedger();
      this.lastProcessedLedger = Math.max(0, latest.sequence - 10);
      this.logger.info(
        { startLedger: this.lastProcessedLedger },
        'SorobanListenerService initialized',
      );
    } catch (err: any) {
      this.logger.warn(
        { err: err.message },
        'Failed to fetch initial ledger; will retry on first poll',
      );
    }
  }

  @Cron('*/30 * * * * *')
  async pollContractEvents(): Promise<void> {
    try {
      const latestLedger = (await this.rpcServer.getLatestLedger()).sequence;
      if (latestLedger <= this.lastProcessedLedger) return;

      const startLedger = this.lastProcessedLedger + 1;

      const deals = await this.tradeDealRepo.find({
        where: { sorobanCampaignContractId: Not(IsNull()) },
        select: ['sorobanCampaignContractId'],
      });
      const contractIds = deals
        .map((d) => d.sorobanCampaignContractId)
        .filter(Boolean) as string[];

      if (contractIds.length === 0) {
        this.lastProcessedLedger = latestLedger;
        return;
      }

      const response = await this.rpcServer.getEvents({
        startLedger,
        filters: [{ type: 'contract', contractIds }],
        limit: 100,
      });

      for (const event of response.events) {
        if (!event.inSuccessfulContractCall) continue;
        await this.handleEvent(event);
      }

      this.lastProcessedLedger = Math.max(
        this.lastProcessedLedger,
        response.latestLedger,
      );
    } catch (err: any) {
      this.logger.error({ err: err.message }, 'Soroban event poll failed');
    }
  }

  private async handleEvent(event: rpc.Api.EventResponse): Promise<void> {
    const topic = event.topic;
    if (topic.length === 0) return;

    let eventName: string;
    try {
      eventName = String(scValToNative(topic[0]));
    } catch {
      return;
    }

    const contractId = event.contractId as unknown as string;

    const deal = await this.tradeDealRepo.findOne({
      where: { sorobanCampaignContractId: contractId },
    });
    if (!deal) return;

    this.logger.debug(
      { contractId, eventName, ledger: event.ledger },
      'Processing Soroban event',
    );

    if (DISPUTE_TOPICS.includes(eventName)) {
      await this.indexDisputeEvent(eventName, event, deal, contractId);
      return;
    }

    switch (eventName) {
      case 'approve':
        if (deal.status === 'draft') {
          deal.status = 'open';
        }
        break;
      case 'pause':
      case 'mark_failed':
        deal.status = 'failed';
        break;
      case 'distribute_revenue':
        if (deal.status === 'funded' || deal.status === 'delivered') {
          deal.status = 'completed';
        }
        break;
      default:
        return;
    }

    await this.tradeDealRepo.save(deal);
    this.logger.info(
      { contractId, eventName, newStatus: deal.status },
      'Trade deal status updated from Soroban event',
    );
  }

  /**
   * Indexes one dispute event into `contract_disputes` (issue #1004).
   *
   * Idempotent: events are replayed by `replayEvents` and by the ledger cursor
   * advancing, so evidence is deduplicated by (txHash, uri), votes by voter,
   * and the tallies are recomputed from the stored vote list instead of
   * incremented.
   *
   * A dispute row is only ever created by `dispute_raised`. Events for a
   * dispute the listener never saw opened (raised before this instance's
   * starting ledger) are skipped: the DB is a projection, and the authoritative
   * record stays readable through `GET /soroban/campaign/:id/dispute/:index`.
   */
  private async indexDisputeEvent(
    eventName: string,
    event: rpc.Api.EventResponse,
    deal: TradeDeal,
    contractId: string,
  ): Promise<void> {
    const milestoneIndex = this.readMilestoneIndex(event);
    if (milestoneIndex === null) {
      this.logger.warn(
        { contractId, eventName, ledger: event.ledger },
        'Dispute event is missing a milestone index in topic[1]',
      );
      return;
    }

    const payload = this.decodePayload(event);

    if (eventName === 'dispute_raised') {
      await this.openDispute(contractId, deal, milestoneIndex, event, payload);
      return;
    }

    const dispute = await this.disputeRepo.findOne({
      where: { contractId, milestoneIndex },
    });
    if (!dispute) {
      this.logger.debug(
        { contractId, milestoneIndex, eventName },
        'Dispute event precedes the indexed dispute; relying on the on-chain read endpoint',
      );
      return;
    }

    if (eventName === 'dispute_evidence') {
      const [submitter, uri] = this.asTuple(payload);
      if (typeof submitter !== 'string' || typeof uri !== 'string') return;
      const evidence = dispute.evidenceJson ?? [];
      if (!evidence.some((e) => e.uri === uri && e.txHash === event.txHash)) {
        evidence.push({
          submitter,
          uri,
          submittedAt: event.ledgerClosedAt,
          txHash: event.txHash,
        });
      }
      dispute.evidenceJson = evidence;
    }

    if (eventName === 'dispute_vote') {
      const [voter, release] = this.asTuple(payload);
      if (typeof voter !== 'string' || typeof release !== 'boolean') return;
      const votes = dispute.votesJson ?? [];
      if (!votes.some((v) => v.voter === voter)) {
        votes.push({ voter, release, txHash: event.txHash });
      }
      dispute.votesJson = votes;
      dispute.releaseVotes = votes.filter((v) => v.release).length;
      dispute.refundVotes = votes.length - dispute.releaseVotes;
      if (dispute.phase === 'open') dispute.phase = 'arbitration';
    }

    if (eventName === 'dispute_verdict' || eventName === 'dispute_resolved') {
      const release = typeof payload === 'boolean' ? payload : undefined;
      if (release === undefined) return;
      dispute.outcome = release ? 'release' : 'refund';
      dispute.phase = eventName === 'dispute_resolved' ? 'resolved' : 'verdict';
      if (eventName === 'dispute_resolved') {
        dispute.resolvedTxHash = event.txHash;
      }
    }

    await this.disputeRepo.save(dispute);
    this.logger.info(
      {
        contractId,
        milestoneIndex,
        eventName,
        phase: dispute.phase,
        outcome: dispute.outcome,
      },
      'Dispute event indexed',
    );
  }

  private async openDispute(
    contractId: string,
    deal: TradeDeal,
    milestoneIndex: number,
    event: rpc.Api.EventResponse,
    payload: unknown,
  ): Promise<void> {
    const [raisedBy, deadlineSeconds] = this.asTuple(payload);
    if (typeof raisedBy !== 'string') return;
    const deadline = Number(deadlineSeconds);
    if (!Number.isFinite(deadline) || deadline <= 0) return;

    const existing = await this.disputeRepo.findOne({
      where: { contractId, milestoneIndex },
    });
    if (existing) {
      // Replayed raise: reset the projection to the opened state rather than
      // accumulating a second lifecycle on top of the first one.
      existing.raisedBy = raisedBy;
      existing.votingDeadline = new Date(deadline * 1000);
      existing.phase = 'open';
      existing.outcome = null;
      existing.evidenceJson = [];
      existing.votesJson = [];
      existing.releaseVotes = 0;
      existing.refundVotes = 0;
      existing.openedTxHash = event.txHash;
      await this.disputeRepo.save(existing);
      return;
    }

    await this.disputeRepo.save(
      this.disputeRepo.create({
        contractId,
        dealId: deal.id,
        milestoneIndex,
        raisedBy,
        phase: 'open',
        votingDeadline: new Date(deadline * 1000),
        releaseVotes: 0,
        refundVotes: 0,
        outcome: null,
        evidenceJson: [],
        votesJson: [],
        openedTxHash: event.txHash,
      }),
    );

    this.logger.info(
      { contractId, dealId: deal.id, milestoneIndex },
      'Dispute opened and voting window recorded',
    );
  }

  /** Milestone index travels in topic[1] on every dispute event. */
  private readMilestoneIndex(event: rpc.Api.EventResponse): number | null {
    if (event.topic.length < 2) return null;
    try {
      const raw = Number(scValToNative(event.topic[1]));
      return Number.isInteger(raw) && raw >= 0 ? raw : null;
    } catch {
      return null;
    }
  }

  private decodePayload(event: rpc.Api.EventResponse): unknown {
    try {
      return scValToNative(event.value);
    } catch {
      return undefined;
    }
  }

  private asTuple(payload: unknown): unknown[] {
    return Array.isArray(payload) ? payload : [];
  }
}
