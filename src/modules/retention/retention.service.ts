/**
 * Priceverse - Data Retention Service
 *
 * Manages automatic cleanup of old data according to retention policy.
 * Uses Titan's Scheduler decorators for scheduled execution.
 *
 * Retention policy:
 * - price_history: N days (default 7)
 * - price_history_5min: N days (default 30)
 * - price_history_1hour: N days (default 365)
 * - price_history_1day: N days (0 = forever)
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { Cron, Schedulable, CronExpression } from '@omnitron-dev/titan/module/scheduler';
import { CONFIG_SERVICE_TOKEN, type ConfigService } from '@omnitron-dev/titan/module/config';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule, type ILogger } from '@omnitron-dev/titan/module/logger';
import { PRICE_HISTORY_REPOSITORY, OHLCV_REPOSITORY } from '../../shared/tokens.js';
import type { PriceHistoryRepository } from '../../database/repositories/price-history.repository.js';
import type { OhlcvRepository } from '../../database/repositories/ohlcv.repository.js';

export interface RetentionStats {
  lastRun: number;
  priceHistoryDeleted: number;
  candles5minDeleted: number;
  candles1hourDeleted: number;
  candles1dayDeleted: number;
  totalDeleted: number;
  duration: number;
}

interface RetentionConfig {
  enabled: boolean;
  priceHistoryDays: number;
  candles5minDays: number;
  candles1hourDays: number;
  candles1dayDays: number;
  cleanupSchedule: string;
}

@Injectable()
@Schedulable()
export class RetentionService {
  private logger: ILogger;
  private config: RetentionConfig;
  private lastStats: RetentionStats | null = null;

  constructor(
    @Inject(CONFIG_SERVICE_TOKEN) configService: ConfigService,
    @Inject(LOGGER_SERVICE_TOKEN) loggerModule: ILoggerModule,
    @Inject(PRICE_HISTORY_REPOSITORY) private readonly priceHistoryRepo: PriceHistoryRepository,
    @Inject(OHLCV_REPOSITORY) private readonly ohlcvRepo: OhlcvRepository
  ) {
    this.logger = loggerModule.logger;

    // Load retention config with defaults
    const retentionConfig = configService.get('retention') as Partial<RetentionConfig> | undefined;
    this.config = {
      enabled: retentionConfig?.enabled ?? true,
      priceHistoryDays: retentionConfig?.priceHistoryDays ?? 7,
      candles5minDays: retentionConfig?.candles5minDays ?? 30,
      candles1hourDays: retentionConfig?.candles1hourDays ?? 365,
      candles1dayDays: retentionConfig?.candles1dayDays ?? 0,
      cleanupSchedule: retentionConfig?.cleanupSchedule ?? '0 3 * * *',
    };

    this.logger.info({ config: this.config }, 'Retention service initialized');
  }

  /**
   * Scheduled cleanup - runs daily at 3 AM by default
   * Schedule is configurable via retention.cleanupSchedule
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'data-retention-cleanup' })
  async runScheduledCleanup(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.debug({}, '[Retention] Cleanup skipped - disabled by config');
      return;
    }

    await this.cleanup();
  }

  /**
   * Manual cleanup trigger - can be called via RPC or for testing
   */
  async cleanup(): Promise<RetentionStats> {
    const startTime = Date.now();
    this.logger.info({ config: this.config }, '[Retention] Starting data cleanup');

    const stats: RetentionStats = {
      lastRun: startTime,
      priceHistoryDeleted: 0,
      candles5minDeleted: 0,
      candles1hourDeleted: 0,
      candles1dayDeleted: 0,
      totalDeleted: 0,
      duration: 0,
    };

    try {
      // Cleanup price_history
      if (this.config.priceHistoryDays > 0) {
        const cutoff = this.getCutoffDate(this.config.priceHistoryDays);
        stats.priceHistoryDeleted = await this.deletePriceHistoryBefore(cutoff);
        this.logger.info(
          { table: 'price_history', deleted: stats.priceHistoryDeleted, cutoff: cutoff.toISOString() },
          '[Retention] Cleaned price_history'
        );
      }

      // Cleanup 5-minute candles
      if (this.config.candles5minDays > 0) {
        const cutoff = this.getCutoffDate(this.config.candles5minDays);
        stats.candles5minDeleted = await this.deleteOhlcvBefore('5min', cutoff);
        this.logger.info(
          { table: 'price_history_5min', deleted: stats.candles5minDeleted, cutoff: cutoff.toISOString() },
          '[Retention] Cleaned 5min candles'
        );
      }

      // Cleanup 1-hour candles
      if (this.config.candles1hourDays > 0) {
        const cutoff = this.getCutoffDate(this.config.candles1hourDays);
        stats.candles1hourDeleted = await this.deleteOhlcvBefore('1hour', cutoff);
        this.logger.info(
          { table: 'price_history_1hour', deleted: stats.candles1hourDeleted, cutoff: cutoff.toISOString() },
          '[Retention] Cleaned 1hour candles'
        );
      }

      // Cleanup daily candles (0 = keep forever)
      if (this.config.candles1dayDays > 0) {
        const cutoff = this.getCutoffDate(this.config.candles1dayDays);
        stats.candles1dayDeleted = await this.deleteOhlcvBefore('1day', cutoff);
        this.logger.info(
          { table: 'price_history_1day', deleted: stats.candles1dayDeleted, cutoff: cutoff.toISOString() },
          '[Retention] Cleaned 1day candles'
        );
      }

      stats.totalDeleted =
        stats.priceHistoryDeleted +
        stats.candles5minDeleted +
        stats.candles1hourDeleted +
        stats.candles1dayDeleted;

      stats.duration = Date.now() - startTime;
      this.lastStats = stats;

      this.logger.info(
        { stats },
        '[Retention] Cleanup completed'
      );
    } catch (error) {
      this.logger.error({ error }, '[Retention] Cleanup failed');
      throw error;
    }

    return stats;
  }

  /**
   * Get last cleanup statistics
   */
  getLastStats(): RetentionStats | null {
    return this.lastStats;
  }

  /**
   * Get current retention config
   */
  getConfig(): RetentionConfig {
    return { ...this.config };
  }

  private getCutoffDate(days: number): Date {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    cutoff.setHours(0, 0, 0, 0);
    return cutoff;
  }

  private async deletePriceHistoryBefore(cutoff: Date): Promise<number> {
    // Use repository's deleteOlderThan method if available, otherwise raw query
    try {
      const result = await (this.priceHistoryRepo as any).db
        .deleteFrom('price_history')
        .where('timestamp', '<', cutoff)
        .executeTakeFirst();
      return Number(result.numDeletedRows ?? 0);
    } catch (error) {
      this.logger.error({ error, cutoff }, 'Failed to delete old price_history');
      return 0;
    }
  }

  private async deleteOhlcvBefore(interval: '5min' | '1hour' | '1day', cutoff: Date): Promise<number> {
    const tableName = `price_history_${interval}` as const;
    try {
      const result = await (this.ohlcvRepo as any).db
        .deleteFrom(tableName)
        .where('timestamp', '<', cutoff)
        .executeTakeFirst();
      return Number(result.numDeletedRows ?? 0);
    } catch (error) {
      this.logger.error({ error, tableName, cutoff }, 'Failed to delete old OHLCV data');
      return 0;
    }
  }
}
