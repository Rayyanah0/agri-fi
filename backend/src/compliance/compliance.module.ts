import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceReportService } from './compliance-report.service';
import { ComplianceController } from './compliance.controller';
import { ComplianceReport } from './entities/compliance-report.entity';
import { RegulatoryRule } from './entities/regulatory-rule.entity';
import { RegulatoryRuleExecution } from './entities/regulatory-rule-execution.entity';
import { RegulatoryRuleEngineService } from './regulatory-rule-engine.service';
import { RegulatoryRuleEngineController } from './regulatory-rule-engine.controller';
import { User } from '../auth/entities/user.entity';
import { Investment } from '../investments/entities/investment.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { SystemAuditLog } from '../audit/entities/system-audit-log.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ComplianceReport,
      RegulatoryRule,
      RegulatoryRuleExecution,
      User,
      Investment,
      TradeDeal,
      SystemAuditLog,
    ]),
    AuditModule,
  ],
  controllers: [ComplianceController, RegulatoryRuleEngineController],
  providers: [ComplianceReportService, RegulatoryRuleEngineService],
  exports: [ComplianceReportService, RegulatoryRuleEngineService],
})
export class ComplianceModule {}
