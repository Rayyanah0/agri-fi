import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WatchlistItem } from './entities/watchlist-item.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { WatchlistService } from './watchlist.service';
import { WatchlistAlertService } from './watchlist-alert.service';
import { WatchlistController } from './watchlist.controller';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Investor watchlist (#1003).
 *
 * `TradeDeal` is registered here only so the alert pass can read deal funding
 * progress; the marketplace listing reads `watchlist_item` straight from its own
 * module instead of importing this one. That keeps the dependency graph a
 * single line: NotificationsModule is already pulled in by AuthModule, and
 * AuthModule transitively reaches TradeDealsModule, so importing this module
 * from the marketplace would close a circular module ring.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WatchlistItem, TradeDeal]),
    NotificationsModule,
  ],
  controllers: [WatchlistController],
  providers: [WatchlistService, WatchlistAlertService],
})
export class WatchlistModule {}
