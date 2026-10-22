import { Module, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TradeDealAuditSubscriber } from './subscribers/trade-deal-audit.subscriber';
import { DatabaseConfig } from './database.config';
import { ReplicaManagerService } from './replica-manager.service';

/**
 * DatabaseModule bootstraps TypeORM, registers the audit subscriber, and
 * wires the live DataSource into DatabaseConfig so the connection-pool
 * monitor can sample the driver's native pool after the app has booted (#742).
 */
@Module({
  providers: [TradeDealAuditSubscriber, DatabaseConfig, ReplicaManagerService],
  exports: [DatabaseConfig, ReplicaManagerService],
})
export class DatabaseModule implements OnModuleInit {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly dbConfig: DatabaseConfig,
  ) {}

  onModuleInit(): void {
    // Hand the initialised DataSource to DatabaseConfig so its
    // onApplicationBootstrap hook can monitor the native connection pool.
    this.dbConfig.setDataSource(this.dataSource);
  }
}
