import { CanActivate, ExecutionContext, Injectable, TooManyRequestsException } from '@nestjs/common';
import { ApiUsageService } from './api-usage.service';

@Injectable()
export class ApiUsageQuotaGuard implements CanActivate {
  constructor(private readonly usageService: ApiUsageService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const ownerId = request.apiKey?.ownerId;
    if (!ownerId) return true;

    const [quota, usage] = await Promise.all([
      this.usageService.getQuota(ownerId),
      this.usageService.getCurrentMonthCount(ownerId),
    ]);
    if (usage >= quota.monthlyQuota) {
      throw new TooManyRequestsException({
        message: 'Monthly API usage quota exceeded',
        tier: quota.tier,
        quota: quota.monthlyQuota,
        resetAt: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString(),
      });
    }
    return true;
  }
}