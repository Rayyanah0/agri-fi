import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Address, Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { PinoLogger } from 'nestjs-pino';
import { SorobanListenerService } from './soroban-listener.service';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { ContractDispute } from './entities/contract-dispute.entity';

const CONTRACT_ID = 'CAMPAIGNDISPUTE123';
const DEAL = {
  id: 'deal-1',
  sorobanCampaignContractId: CONTRACT_ID,
  status: 'funded',
};

function makeDisputeRepo() {
  const rows: ContractDispute[] = [];
  return {
    rows,
    findOne: jest.fn(({ where }: any) =>
      Promise.resolve(
        rows.find(
          (r) =>
            r.contractId === where.contractId &&
            r.milestoneIndex === where.milestoneIndex,
        ) ?? null,
      ),
    ),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn((entity: any) => {
      const index = rows.findIndex(
        (r) =>
          r.contractId === entity.contractId &&
          r.milestoneIndex === entity.milestoneIndex,
      );
      if (index === -1) rows.push(entity);
      else rows[index] = entity;
      return Promise.resolve(entity);
    }),
  };
}

function disputeEvent(options: {
  topic: string;
  milestoneIndex?: number;
  value: xdr.ScVal;
  txHash?: string;
}) {
  const topic: xdr.ScVal[] = [nativeToScVal(options.topic, { type: 'symbol' })];
  if (options.milestoneIndex !== undefined) {
    topic.push(nativeToScVal(options.milestoneIndex, { type: 'u32' }));
  }
  return {
    id: `${options.topic}-${options.milestoneIndex ?? 0}`,
    type: 'contract' as const,
    ledger: 500,
    ledgerClosedAt: '2026-10-19T12:00:00.000Z',
    pagingToken: '0-0',
    inSuccessfulContractCall: true,
    txHash: options.txHash ?? 'a'.repeat(64),
    contractId: CONTRACT_ID,
    topic,
    value: options.value,
  };
}

function tuple(values: xdr.ScVal[]): xdr.ScVal {
  return xdr.ScVal.scvVec(values);
}

function addressScVal(publicKey: string): xdr.ScVal {
  return new Address(publicKey).toScVal();
}

describe('SorobanListenerService dispute indexing (#1004)', () => {
  let service: SorobanListenerService;
  let disputeRepo: ReturnType<typeof makeDisputeRepo>;
  let tradeDealRepo: any;
  let rpcServer: { getLatestLedger: jest.Mock; getEvents: jest.Mock };

  const investor = Keypair.random().publicKey();
  const arbitratorA = Keypair.random().publicKey();
  const arbitratorB = Keypair.random().publicKey();

  beforeEach(async () => {
    disputeRepo = makeDisputeRepo();
    tradeDealRepo = {
      find: jest.fn().mockResolvedValue([DEAL]),
      findOne: jest.fn().mockResolvedValue({ ...DEAL }),
      save: jest.fn().mockResolvedValue(undefined),
    };

    rpcServer = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 501 }),
      getEvents: jest.fn().mockResolvedValue({ events: [], latestLedger: 501 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanListenerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_key: string, fallback?: unknown) => fallback),
          },
        },
        { provide: getRepositoryToken(TradeDeal), useValue: tradeDealRepo },
        { provide: getRepositoryToken(ContractDispute), useValue: disputeRepo },
        {
          provide: PinoLogger,
          useValue: {
            setContext: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(SorobanListenerService);
    (service as any).rpcServer = rpcServer;
  });

  /**
   * Feeds events through the real poll path so topic routing is covered too.
   * The cursor is rewound because each emit stands for its own 30s poll tick.
   */
  async function emit(...events: unknown[]): Promise<void> {
    (service as any).lastProcessedLedger = 0;
    rpcServer.getEvents.mockResolvedValueOnce({ events, latestLedger: 501 });
    await service.pollContractEvents();
  }

  it('opens a dispute row with the on-chain voting deadline', async () => {
    await emit(
      disputeEvent({
        topic: 'dispute_raised',
        milestoneIndex: 1,
        value: tuple([
          addressScVal(investor),
          nativeToScVal(1_800_000_000n, { type: 'u64' }),
        ]),
        txHash: 'b'.repeat(64),
      }),
    );

    expect(disputeRepo.rows).toHaveLength(1);
    const dispute = disputeRepo.rows[0];
    expect(dispute.contractId).toBe(CONTRACT_ID);
    expect(dispute.dealId).toBe('deal-1');
    expect(dispute.milestoneIndex).toBe(1);
    expect(dispute.raisedBy).toBe(investor);
    expect(dispute.phase).toBe('open');
    expect(dispute.votingDeadline).toEqual(new Date(1_800_000_000 * 1000));
    expect(dispute.releaseVotes).toBe(0);
    expect(dispute.refundVotes).toBe(0);
  });

  it('tallies arbitrator votes and deduplicates a replayed vote', async () => {
    const voteA = disputeEvent({
      topic: 'dispute_raised',
      milestoneIndex: 0,
      value: tuple([
        addressScVal(investor),
        nativeToScVal(1_800_000_000n, { type: 'u64' }),
      ]),
    });
    await emit(voteA);

    await emit(
      disputeEvent({
        topic: 'dispute_vote',
        milestoneIndex: 0,
        value: tuple([
          addressScVal(arbitratorA),
          nativeToScVal(true, { type: 'bool' }),
        ]),
        txHash: 'c'.repeat(64),
      }),
    );
    await emit(
      disputeEvent({
        topic: 'dispute_vote',
        milestoneIndex: 0,
        value: tuple([
          addressScVal(arbitratorB),
          nativeToScVal(false, { type: 'bool' }),
        ]),
        txHash: 'd'.repeat(64),
      }),
    );

    let dispute = disputeRepo.rows[0];
    expect(dispute.releaseVotes).toBe(1);
    expect(dispute.refundVotes).toBe(1);
    expect(dispute.phase).toBe('arbitration');

    // Same vote replayed (indexer cursor overlap) must not change the tally.
    await emit(
      disputeEvent({
        topic: 'dispute_vote',
        milestoneIndex: 0,
        value: tuple([
          addressScVal(arbitratorA),
          nativeToScVal(true, { type: 'bool' }),
        ]),
        txHash: 'e'.repeat(64),
      }),
    );
    dispute = disputeRepo.rows[0];
    expect(dispute.releaseVotes).toBe(1);
    expect(dispute.refundVotes).toBe(1);
    expect(dispute.votesJson).toHaveLength(2);
  });

  it('records evidence once per transaction', async () => {
    await emit(
      disputeEvent({
        topic: 'dispute_raised',
        milestoneIndex: 2,
        value: tuple([
          addressScVal(investor),
          nativeToScVal(1_800_000_000n, { type: 'u64' }),
        ]),
      }),
    );

    const evidence = disputeEvent({
      topic: 'dispute_evidence',
      milestoneIndex: 2,
      value: tuple([
        addressScVal(investor),
        nativeToScVal('https://docs.example/inspection.pdf', {
          type: 'string',
        }),
      ]),
      txHash: 'f'.repeat(64),
    });
    await emit(evidence);
    await emit(evidence);

    const dispute = disputeRepo.rows[0];
    expect(dispute.evidenceJson).toHaveLength(1);
    expect(dispute.evidenceJson?.[0].uri).toBe(
      'https://docs.example/inspection.pdf',
    );
    expect(dispute.evidenceJson?.[0].submittedAt).toBe(
      '2026-10-19T12:00:00.000Z',
    );
    expect(dispute.phase).toBe('open');
  });

  it('moves to verdict and then resolved with the executed outcome', async () => {
    await emit(
      disputeEvent({
        topic: 'dispute_raised',
        milestoneIndex: 3,
        value: tuple([
          addressScVal(investor),
          nativeToScVal(1_800_000_000n, { type: 'u64' }),
        ]),
      }),
    );

    await emit(
      disputeEvent({
        topic: 'dispute_verdict',
        milestoneIndex: 3,
        value: nativeToScVal(false, { type: 'bool' }),
      }),
    );
    expect(disputeRepo.rows[0].phase).toBe('verdict');
    expect(disputeRepo.rows[0].outcome).toBe('refund');

    await emit(
      disputeEvent({
        topic: 'dispute_resolved',
        milestoneIndex: 3,
        value: nativeToScVal(false, { type: 'bool' }),
        txHash: '9'.repeat(64),
      }),
    );
    expect(disputeRepo.rows[0].phase).toBe('resolved');
    expect(disputeRepo.rows[0].outcome).toBe('refund');
    expect(disputeRepo.rows[0].resolvedTxHash).toBe('9'.repeat(64));
  });

  it('re-raising a milestone resets the projection instead of stacking lifecycles', async () => {
    const raised = (voter: string) =>
      disputeEvent({
        topic: 'dispute_raised',
        milestoneIndex: 4,
        value: tuple([
          addressScVal(voter),
          nativeToScVal(1_900_000_000n, { type: 'u64' }),
        ]),
        txHash: voter.slice(0, 8).padEnd(64, '0'),
      });

    await emit(raised(investor));
    await emit(
      disputeEvent({
        topic: 'dispute_vote',
        milestoneIndex: 4,
        value: tuple([
          addressScVal(arbitratorA),
          nativeToScVal(true, { type: 'bool' }),
        ]),
      }),
    );
    await emit(raised(arbitratorA));

    expect(disputeRepo.rows).toHaveLength(1);
    const dispute = disputeRepo.rows[0];
    expect(dispute.raisedBy).toBe(arbitratorA);
    expect(dispute.phase).toBe('open');
    expect(dispute.releaseVotes).toBe(0);
    expect(dispute.votesJson).toEqual([]);
    expect(dispute.votingDeadline).toEqual(new Date(1_900_000_000 * 1000));
  });

  it('ignores dispute events for a dispute it never saw opened', async () => {
    await emit(
      disputeEvent({
        topic: 'dispute_vote',
        milestoneIndex: 7,
        value: tuple([
          addressScVal(arbitratorA),
          nativeToScVal(true, { type: 'bool' }),
        ]),
      }),
    );

    expect(disputeRepo.rows).toHaveLength(0);
    expect(disputeRepo.save).not.toHaveBeenCalled();
  });

  it('skips a dispute event whose topic carries no milestone index', async () => {
    await emit(
      disputeEvent({
        topic: 'dispute_raised',
        value: tuple([
          addressScVal(investor),
          nativeToScVal(1_800_000_000n, { type: 'u64' }),
        ]),
      }),
    );

    expect(disputeRepo.rows).toHaveLength(0);
  });

  it('leaves the trade deal status untouched for dispute events', async () => {
    await emit(
      disputeEvent({
        topic: 'dispute_raised',
        milestoneIndex: 5,
        value: tuple([
          addressScVal(investor),
          nativeToScVal(1_800_000_000n, { type: 'u64' }),
        ]),
      }),
    );

    expect(tradeDealRepo.save).not.toHaveBeenCalled();
  });
});
