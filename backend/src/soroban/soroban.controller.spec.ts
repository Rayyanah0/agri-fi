import { ConflictException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';

// `src/common/guards/index.ts` re-exports `AdminGuard` from
// `../../auth/guards/admin.guard`, a file that does not exist on `main`, so the
// barrel throws when it is loaded. Guard behaviour is covered by their own
// specs, so the barrel is stubbed here instead of dragging that export in.
jest.mock('../common/guards', () => ({
  RolesGuard: class RolesGuard {},
  MfaGuard: class MfaGuard {},
}));

import { SorobanController } from './soroban.controller';
import { SorobanService } from './soroban.service';
import { ContractDispute } from './entities/contract-dispute.entity';

const CONTRACT_ID = 'CAMPAIGNDISPUTE123';

const mockSorobanService = {
  raiseCampaignDispute: jest.fn(),
  submitDisputeEvidence: jest.fn(),
  resolveCampaignDispute: jest.fn(),
  getCampaignDispute: jest.fn(),
  getDisputeVotingWindow: jest.fn(),
  getArbitratorPool: jest.fn(),
};

describe('SorobanController dispute endpoints (#1004)', () => {
  let controller: SorobanController;
  let disputeRepo: { find: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    disputeRepo = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SorobanController],
      providers: [
        { provide: SorobanService, useValue: mockSorobanService },
        { provide: getRepositoryToken(ContractDispute), useValue: disputeRepo },
      ],
    }).compile();

    controller = module.get(SorobanController);
  });

  it('raises a dispute and returns the transaction hash', async () => {
    mockSorobanService.raiseCampaignDispute.mockResolvedValue('tx-raise');

    await expect(
      controller.raiseDispute(CONTRACT_ID, { milestoneIndex: 2 }),
    ).resolves.toEqual({ txHash: 'tx-raise' });
    expect(mockSorobanService.raiseCampaignDispute).toHaveBeenCalledWith(
      CONTRACT_ID,
      2,
    );
  });

  it('submits evidence for a milestone', async () => {
    mockSorobanService.submitDisputeEvidence.mockResolvedValue('tx-evidence');

    const result = await controller.submitDisputeEvidence(CONTRACT_ID, {
      milestoneIndex: 1,
      uri: 'https://docs.example/inspection.pdf',
    });

    expect(result).toEqual({ txHash: 'tx-evidence' });
    expect(mockSorobanService.submitDisputeEvidence).toHaveBeenCalledWith(
      CONTRACT_ID,
      1,
      'https://docs.example/inspection.pdf',
    );
  });

  it('maps contract error 15 to a 409 DISPUTE_ACTIVE', async () => {
    mockSorobanService.raiseCampaignDispute.mockRejectedValue(
      new Error('HostError: contract error code: 15'),
    );

    const error = await controller
      .raiseDispute(CONTRACT_ID, { milestoneIndex: 0 })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({
      code: 'DISPUTE_ACTIVE',
      milestoneIndex: 0,
    });
  });

  it('maps VOTING_NOT_OVER on resolve so the caller knows to retry after the window', async () => {
    mockSorobanService.resolveCampaignDispute.mockRejectedValue(
      new Error('contract error code: 20'),
    );

    const error = await controller
      .resolveDispute(CONTRACT_ID, { milestoneIndex: 4 })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({
      code: 'VOTING_NOT_OVER',
      milestoneIndex: 4,
    });
  });

  it('rethrows a failure that is not a mapped contract error', async () => {
    const original = new Error('soroban rpc unreachable');
    mockSorobanService.resolveCampaignDispute.mockRejectedValue(original);

    await expect(
      controller.resolveDispute(CONTRACT_ID, { milestoneIndex: 0 }),
    ).rejects.toBe(original);
  });

  it('returns 404 when no dispute exists on-chain for the milestone', async () => {
    mockSorobanService.getCampaignDispute.mockResolvedValue(null);

    await expect(
      controller.getCampaignDispute(CONTRACT_ID, '3'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockSorobanService.getCampaignDispute).toHaveBeenCalledWith(
      CONTRACT_ID,
      3,
    );
  });

  it('rejects a non-numeric milestone index before touching the chain', async () => {
    await expect(
      controller.getCampaignDispute(CONTRACT_ID, 'not-a-number'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockSorobanService.getCampaignDispute).not.toHaveBeenCalled();
  });

  it('returns the on-chain dispute record when present', async () => {
    const record = {
      milestone_index: 3,
      phase: 'Open',
      voting_deadline: 1800000000n,
    };
    mockSorobanService.getCampaignDispute.mockResolvedValue(record);

    await expect(
      controller.getCampaignDispute(CONTRACT_ID, '3'),
    ).resolves.toEqual(record);
  });

  it('exposes the arbitration configuration used when a dispute opens', async () => {
    mockSorobanService.getDisputeVotingWindow.mockResolvedValue(604800);
    mockSorobanService.getArbitratorPool.mockResolvedValue(['GARB1', 'GARB2']);

    await expect(controller.getDisputeConfig(CONTRACT_ID)).resolves.toEqual({
      votingWindowSecs: 604800,
      arbitratorPool: ['GARB1', 'GARB2'],
    });
  });

  it('lists the disputes the event listener indexed', async () => {
    const rows = [{ milestoneIndex: 0, phase: 'open' }];
    disputeRepo.find.mockResolvedValue(rows);

    const result = await controller.listIndexedDisputes(CONTRACT_ID);

    expect(result).toEqual({
      contractId: CONTRACT_ID,
      total: 1,
      disputes: rows,
    });
    expect(disputeRepo.find).toHaveBeenCalledWith({
      where: { contractId: CONTRACT_ID },
      order: { milestoneIndex: 'ASC' },
    });
  });
});
