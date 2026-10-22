import { TooManyRequestsException } from '@nestjs/common';
import { ApiUsageQuotaGuard } from './api-usage-quota.guard';

describe('ApiUsageQuotaGuard', () => {
  const context = (ownerId?: string) => ({
    switchToHttp: () => ({ getRequest: () => ({ apiKey: ownerId ? { ownerId } : undefined }) }),
  }) as any;

  it('allows an authenticated partner below quota', async () => {
    const usage = {
      getQuota: jest.fn().mockResolvedValue({ tier: 'free', monthlyQuota: 100 }),
      getCurrentMonthCount: jest.fn().mockResolvedValue(99),
    };
    await expect(new ApiUsageQuotaGuard(usage as any).canActivate(context('partner-1'))).resolves.toBe(true);
  });

  it('rejects a partner whose monthly quota is exhausted', async () => {
    const usage = {
      getQuota: jest.fn().mockResolvedValue({ tier: 'standard', monthlyQuota: 100 }),
      getCurrentMonthCount: jest.fn().mockResolvedValue(100),
    };
    await expect(new ApiUsageQuotaGuard(usage as any).canActivate(context('partner-1')))
      .rejects.toBeInstanceOf(TooManyRequestsException);
  });

  it('does not apply monthly quotas without an API key identity', async () => {
    const usage = { getQuota: jest.fn(), getCurrentMonthCount: jest.fn() };
    await expect(new ApiUsageQuotaGuard(usage as any).canActivate(context())).resolves.toBe(true);
    expect(usage.getQuota).not.toHaveBeenCalled();
  });
});