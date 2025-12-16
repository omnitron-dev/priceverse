/**
 * Priceverse - OHLCV Aggregator Process
 * CPU-intensive OHLCV candle aggregation as a PM process
 */

import { Process, Public, HealthCheck, OnShutdown, Metric } from '@omnitron-dev/titan/module/pm';
import type { IHealthStatus } from '@omnitron-dev/titan/module/pm';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { PriceHistoryRepository, OhlcvRepository, CreateOhlcvCandleInput } from '../../database/index.js';
import type { PairSymbol } from '../../shared/types.js';
import { USD_PAIRS, RUB_PAIRS } from '../../shared/types.js';

export interface IOhlcvAggregatorDependencies {
  logger: ILogger;
  priceHistoryRepo: PriceHistoryRepository;
  ohlcvRepo: OhlcvRepository;
}

interface AggregationStats {
  '5min': { lastRun: number; processed: number };
  '1hour': { lastRun: number; processed: number };
  '1day': { lastRun: number; processed: number };
}

@Process({
  name: 'ohlcv-aggregator',
  version: '1.0.0',
  description: 'CPU-intensive OHLCV candle aggregation',
})
export default class OhlcvAggregatorProcess {
  private logger!: ILogger;
  private priceHistoryRepo!: PriceHistoryRepository;
  private ohlcvRepo!: OhlcvRepository;
  private stats: AggregationStats = {
    '5min': { lastRun: 0, processed: 0 },
    '1hour': { lastRun: 0, processed: 0 },
    '1day': { lastRun: 0, processed: 0 },
  };

  async init(deps: IOhlcvAggregatorDependencies): Promise<void> {
    this.logger = deps.logger;
    this.priceHistoryRepo = deps.priceHistoryRepo;
    this.ohlcvRepo = deps.ohlcvRepo;

    this.logger.info({}, 'OHLCV aggregator process initialized');
  }

  @Public()
  @Metric('ohlcv_stats')
  getStats(): AggregationStats {
    return { ...this.stats };
  }

  /**
   * Aggregate 5-minute candles
   * Should be called by scheduler every 5 minutes
   */
  @Public()
  async aggregate5Min(): Promise<{ success: boolean; processed: number }> {
    const now = new Date();
    const intervalMs = 5 * 60 * 1000;
    const periodStart = this.floorToInterval(now, intervalMs);
    const periodEnd = new Date(periodStart.getTime() + intervalMs);

    this.logger.debug({ periodStart, periodEnd }, 'Starting 5min aggregation');

    const processed = await this.aggregateInterval('5min', periodStart, periodEnd);

    this.stats['5min'] = { lastRun: Date.now(), processed };

    return { success: true, processed };
  }

  /**
   * Aggregate 1-hour candles
   * Should be called by scheduler every hour
   */
  @Public()
  async aggregate1Hour(): Promise<{ success: boolean; processed: number }> {
    const now = new Date();
    const intervalMs = 60 * 60 * 1000;
    const periodStart = this.floorToInterval(now, intervalMs);
    const periodEnd = new Date(periodStart.getTime() + intervalMs);

    this.logger.debug({ periodStart, periodEnd }, 'Starting 1hour aggregation');

    const processed = await this.aggregateInterval('1hour', periodStart, periodEnd);

    this.stats['1hour'] = { lastRun: Date.now(), processed };

    return { success: true, processed };
  }

  /**
   * Aggregate daily candles
   * Should be called by scheduler at midnight UTC
   */
  @Public()
  async aggregate1Day(): Promise<{ success: boolean; processed: number }> {
    const now = new Date();
    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)
    );
    const periodEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );

    this.logger.debug({ periodStart, periodEnd }, 'Starting 1day aggregation');

    const processed = await this.aggregateInterval('1day', periodStart, periodEnd);

    this.stats['1day'] = { lastRun: Date.now(), processed };

    return { success: true, processed };
  }

  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    const now = Date.now();

    const checks = [
      {
        name: '5min_aggregation',
        status: this.isRecentAggregation('5min', 10 * 60 * 1000) ? 'pass' as const : 'warn' as const,
        message: `Last run: ${this.stats['5min'].lastRun ? new Date(this.stats['5min'].lastRun).toISOString() : 'never'}`,
      },
      {
        name: '1hour_aggregation',
        status: this.isRecentAggregation('1hour', 2 * 60 * 60 * 1000) ? 'pass' as const : 'warn' as const,
        message: `Last run: ${this.stats['1hour'].lastRun ? new Date(this.stats['1hour'].lastRun).toISOString() : 'never'}`,
      },
      {
        name: '1day_aggregation',
        status: this.isRecentAggregation('1day', 25 * 60 * 60 * 1000) ? 'pass' as const : 'warn' as const,
        message: `Last run: ${this.stats['1day'].lastRun ? new Date(this.stats['1day'].lastRun).toISOString() : 'never'}`,
      },
    ];

    const hasFailure = false; // No failure states in these checks
    const hasWarning = checks.some(c => c.status === 'warn');

    return {
      status: hasFailure ? 'unhealthy' : hasWarning ? 'degraded' : 'healthy',
      checks,
      timestamp: now,
    };
  }

  @OnShutdown()
  async shutdown(): Promise<void> {
    this.logger.info({}, 'OHLCV aggregator shutting down');
  }

  private isRecentAggregation(interval: keyof AggregationStats, maxAge: number): boolean {
    const last = this.stats[interval].lastRun;
    return last ? Date.now() - last < maxAge : false;
  }

  private floorToInterval(date: Date, intervalMs: number): Date {
    return new Date(Math.floor(date.getTime() / intervalMs) * intervalMs);
  }

  private async aggregateInterval(
    interval: '5min' | '1hour' | '1day',
    periodStart: Date,
    periodEnd: Date
  ): Promise<number> {
    const allPairs = [...USD_PAIRS, ...RUB_PAIRS];
    let totalProcessed = 0;

    for (const pair of allPairs) {
      try {
        const prices = await this.priceHistoryRepo.findByPairInRange({
          pair: pair as PairSymbol,
          from: periodStart,
          to: periodEnd,
          orderBy: 'asc',
        });

        if (prices.length === 0) continue;

        // Calculate OHLCV
        const open = parseFloat(prices[0].price);
        const close = parseFloat(prices[prices.length - 1].price);
        let high = open;
        let low = open;
        let totalVolume = 0;
        let priceVolumeSum = 0;

        for (const p of prices) {
          const price = parseFloat(p.price);
          const volume = parseFloat(p.volume || '0');

          if (price > high) high = price;
          if (price < low) low = price;
          totalVolume += volume;
          priceVolumeSum += price * volume;
        }

        const vwap = totalVolume > 0 ? priceVolumeSum / totalVolume : (open + close) / 2;

        const candle: CreateOhlcvCandleInput = {
          pair: pair as PairSymbol,
          timestamp: periodStart,
          open: open.toFixed(8),
          high: high.toFixed(8),
          low: low.toFixed(8),
          close: close.toFixed(8),
          volume: totalVolume.toFixed(8),
          vwap: vwap.toFixed(8),
          trade_count: prices.length,
        };

        await this.ohlcvRepo.upsertCandle(interval, candle);
        totalProcessed++;
      } catch (error) {
        this.logger.error({ error, pair, interval }, 'Failed to aggregate candle');
      }
    }

    this.logger.info({ interval, processed: totalProcessed }, 'Aggregation complete');
    return totalProcessed;
  }
}
