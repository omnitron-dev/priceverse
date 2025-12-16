/**
 * Priceverse - OHLCV Scheduler Service
 *
 * Uses Titan's Scheduler decorators (@Cron, @Interval) for OHLCV aggregation.
 * This service is automatically discovered and scheduled by SchedulerModule.
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { Cron, Interval, Schedulable, CronExpression } from '@omnitron-dev/titan/module/scheduler';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule, type ILogger } from '@omnitron-dev/titan/module/logger';
import { PreDestroy } from '@omnitron-dev/titan/decorators';

import OhlcvAggregatorProcess from '../../processes/aggregators/ohlcv-aggregator.process.js';
import { OHLCV_AGGREGATOR } from './tokens.js';

/**
 * OHLCV Scheduler Service
 *
 * Schedules OHLCV candle aggregation at various intervals using Titan's
 * built-in scheduler decorators. This replaces manual setInterval calls.
 */
@Injectable()
@Schedulable()
export class OhlcvSchedulerService {
  private logger: ILogger;

  constructor(
    @Inject(OHLCV_AGGREGATOR) private readonly ohlcvAggregator: OhlcvAggregatorProcess,
    @Inject(LOGGER_SERVICE_TOKEN) loggerModule: ILoggerModule
  ) {
    this.logger = loggerModule.logger;
  }

  /**
   * 5-minute candle aggregation
   * Runs every 5 minutes
   */
  @Interval(5 * 60 * 1000, { name: 'ohlcv-5min' })
  async aggregate5Min(): Promise<void> {
    try {
      const result = await this.ohlcvAggregator.aggregate5Min();
      this.logger.debug({ processed: result.processed }, 'OHLCV 5min aggregation completed');
    } catch (error) {
      this.logger.error({ error }, 'OHLCV 5min aggregation failed');
    }
  }

  /**
   * 1-hour candle aggregation
   * Runs every hour at minute 0
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'ohlcv-1hour' })
  async aggregate1Hour(): Promise<void> {
    try {
      const result = await this.ohlcvAggregator.aggregate1Hour();
      this.logger.debug({ processed: result.processed }, 'OHLCV 1hour aggregation completed');
    } catch (error) {
      this.logger.error({ error }, 'OHLCV 1hour aggregation failed');
    }
  }

  /**
   * Daily candle aggregation
   * Runs at midnight UTC
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'ohlcv-1day', timezone: 'UTC' })
  async aggregate1Day(): Promise<void> {
    try {
      const result = await this.ohlcvAggregator.aggregate1Day();
      this.logger.debug({ processed: result.processed }, 'OHLCV daily aggregation completed');
    } catch (error) {
      this.logger.error({ error }, 'OHLCV daily aggregation failed');
    }
  }

  @PreDestroy()
  async onDestroy(): Promise<void> {
    this.logger.info({}, 'OHLCV Scheduler service shutting down');
  }
}
