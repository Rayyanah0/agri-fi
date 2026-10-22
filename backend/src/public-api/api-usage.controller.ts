import { BadRequestException, Controller, Get, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiKeyGuard } from '../common/guards';
import { ApiKeyThrottlerGuard } from '../common/throttler/api-key-throttler.guard';
import { ApiUsageService } from './api-usage.service';
import { ApiUsageInterceptor } from './api-usage.interceptor';

@UseGuards(ApiKeyGuard, ApiKeyThrottlerGuard)
@UseInterceptors(ApiUsageInterceptor)
@Controller('v1/public/usage')
export class ApiUsageController {
  constructor(private readonly usageService: ApiUsageService) {}

  @Get()
  getUsage(@Req() request: { apiKey: { ownerId: string } }) {
    return this.usageService.getUsage(request.apiKey.ownerId);
  }

  @Get('monthly')
  getMonthlyStatement(
    @Req() request: { apiKey: { ownerId: string } },
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const parsedYear = Number(year);
    const parsedMonth = Number(month);
    if (!year || !month || !Number.isInteger(parsedYear) || !Number.isInteger(parsedMonth)) {
      throw new BadRequestException('year and month query parameters are required integers');
    }
    return this.usageService.getMonthlyStatement(request.apiKey.ownerId, parsedYear, parsedMonth);
  }
}