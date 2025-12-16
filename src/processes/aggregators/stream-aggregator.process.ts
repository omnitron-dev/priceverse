/**
 * Priceverse - Stream Aggregator Process
 * Real-time VWAP calculation as a PM process
 */

import { Process, Public, HealthCheck, OnShutdown, Metric } from '@omnitron-dev/titan/module/pm';
import type { IHealthStatus } from '@omnitron-dev/titan/module/pm';
import type { RedisService } from '@omnitron-dev/titan/module/redis';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { PriceHistoryRepository, CreatePriceHistoryInput } from '../../database/index.js';
import type { VwapResult, PairSymbol, TradeEntry } from '../../shared/types.js';
import { USD_PAIRS, SUPPORTED_EXCHANGES } from '../../shared/types.js';

const AGGREGATION_INTERVAL = 10_000; // 10 seconds
const WINDOW_SIZE = 30_000; // 30 second window
const BUFFER_KEY_PREFIX = 'buffer:trades:';
const MAX_CONSECUTIVE_ERRORS = 10;
const ERROR_RESET_INTERVAL = 60_000;

export interface IStreamAggregatorDependencies {
  redis: RedisService;
  logger: ILogger;
  priceHistoryRepo: PriceHistoryRepository;
  cbrRate: { getRate(): Promise<number> };
}

@Process({
  name: 'stream-aggregator',
  version: '1.0.0',
  description: 'Real-time VWAP calculation process',
})
export default class StreamAggregatorProcess {
  private isRunning = false;
  private consumerName: string;
  private aggregationTimer: ReturnType<typeof setInterval> | null = null;
  private consumptionPromise: Promise<void> | null = null;
  private consecutiveErrors = 0;
  private lastErrorTime = 0;
  private lastSuccessfulAggregation = 0;
  private aggregationCount = 0;

  private redis!: RedisService;
  private logger!: ILogger;
  private priceHistoryRepo!: PriceHistoryRepository;
  private cbrRate!: { getRate(): Promise<number> };

  constructor() {
    this.consumerName = `aggregator-${process.pid}`;
  }

  async init(deps: IStreamAggregatorDependencies): Promise<void> {
    this.redis = deps.redis;
    this.logger = deps.logger;
    this.priceHistoryRepo = deps.priceHistoryRepo;
    this.cbrRate = deps.cbrRate;

    this.isRunning = true;
    await this.createConsumerGroups();
    this.startConsumption();
    this.startAggregation();

    this.logger.info({ consumer: this.consumerName }, 'Stream aggregator process initialized');
  }

  @Public()
  @Metric('aggregation_stats')
  getStats(): {
    isRunning: boolean;
    consumerName: string;
    consecutiveErrors: number;
    lastSuccessfulAggregation: number;
    aggregationCount: number;
  } {
    return {
      isRunning: this.isRunning,
      consumerName: this.consumerName,
      consecutiveErrors: this.consecutiveErrors,
      lastSuccessfulAggregation: this.lastSuccessfulAggregation,
      aggregationCount: this.aggregationCount,
    };
  }

  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    const now = Date.now();
    const timeSinceLastAggregation = now - this.lastSuccessfulAggregation;

    const checks = [
      {
        name: 'running',
        status: this.isRunning ? 'pass' as const : 'fail' as const,
        message: this.isRunning ? 'Process running' : 'Process stopped',
      },
      {
        name: 'aggregation_frequency',
        status: timeSinceLastAggregation < AGGREGATION_INTERVAL * 3 ? 'pass' as const : 'warn' as const,
        message: `Last aggregation ${timeSinceLastAggregation}ms ago`,
      },
      {
        name: 'error_rate',
        status: this.consecutiveErrors < 5 ? 'pass' as const : this.consecutiveErrors < 10 ? 'warn' as const : 'fail' as const,
        message: `${this.consecutiveErrors} consecutive errors`,
      },
    ];

    const hasFailure = checks.some(c => c.status === 'fail');
    const hasWarning = checks.some(c => c.status === 'warn');

    return {
      status: hasFailure ? 'unhealthy' : hasWarning ? 'degraded' : 'healthy',
      checks,
      timestamp: now,
    };
  }

  @OnShutdown()
  async shutdown(): Promise<void> {
    this.logger.info({ consumer: this.consumerName }, 'Stream aggregator shutting down');
    this.isRunning = false;

    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
      this.aggregationTimer = null;
    }

    if (this.consumptionPromise) {
      try {
        await this.consumptionPromise;
      } catch (error) {
        // Log but don't fail - we're shutting down anyway
        this.logger.debug({ error }, 'Shutdown: consumption promise rejected (expected during shutdown)');
      }
      this.consumptionPromise = null;
    }
  }

  private async createConsumerGroups(): Promise<void> {
    for (const exchange of SUPPORTED_EXCHANGES) {
      const streamKey = `stream:trades:${exchange}`;
      try {
        await this.redis.xgroup('CREATE', streamKey, 'aggregator-group', '0', 'MKSTREAM');
        this.logger.debug({ exchange, streamKey }, 'Consumer group created');
      } catch (error) {
        // BUSYGROUP means group already exists - this is expected on restart
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('BUSYGROUP')) {
          this.logger.debug({ exchange }, 'Consumer group already exists');
        } else {
          // Log unexpected errors but continue - other groups may succeed
          this.logger.warn({ error, exchange, streamKey }, 'Failed to create consumer group');
        }
      }
    }
  }

  private startConsumption(): void {
    this.consumptionPromise = this.consumeStreams().catch((error) => {
      this.logger.error({ error }, 'Fatal consumption error');
      this.isRunning = false;
    });
  }

  private async consumeStreams(): Promise<void> {
    while (this.isRunning) {
      try {
        for (const exchange of SUPPORTED_EXCHANGES) {
          if (!this.isRunning) break;

          const streamKey = `stream:trades:${exchange}`;
          const messages = await this.redis.xreadgroup(
            'aggregator-group',
            this.consumerName,
            100,
            1000,
            [{ key: streamKey, id: '>' }]
          );

          if (messages && messages.length > 0) {
            await this.processBatch(exchange, messages);
          }
        }

        // Reset error count on successful iteration
        if (this.consecutiveErrors > 0 && Date.now() - this.lastErrorTime > ERROR_RESET_INTERVAL) {
          this.consecutiveErrors = 0;
        }
      } catch (error) {
        this.consecutiveErrors++;
        this.lastErrorTime = Date.now();

        this.logger.error(
          { error, consecutiveErrors: this.consecutiveErrors },
          'Stream consumption error'
        );

        // Circuit breaker
        if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          this.logger.error({}, 'Circuit breaker triggered');
          this.isRunning = false;
          throw new Error(`Stream consumption failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`);
        }

        // Exponential backoff
        const backoffMs = Math.min(1000 * Math.pow(2, this.consecutiveErrors - 1), 30_000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  private async processBatch(
    exchange: string,
    messages: Array<[string, Array<[string, Record<string, string>]>]>
  ): Promise<void> {
    for (const [streamKey, entries] of messages) {
      for (const [id, fields] of entries) {
        const trade: TradeEntry = {
          price: parseFloat(fields.price),
          volume: parseFloat(fields.volume),
          timestamp: parseInt(fields.timestamp, 10),
          exchange,
        };

        const pair = fields.pair;
        const bufferKey = `${BUFFER_KEY_PREFIX}${pair}`;

        await this.redis.zadd(bufferKey, trade.timestamp, JSON.stringify(trade));
        await this.redis.xack(streamKey, 'aggregator-group', id);
      }
    }
  }

  private startAggregation(): void {
    this.aggregationTimer = setInterval(() => this.aggregate(), AGGREGATION_INTERVAL);
  }

  private async aggregate(): Promise<void> {
    for (const pair of USD_PAIRS) {
      try {
        const vwap = await this.calculateVwap(pair);
        if (vwap) {
          await this.savePrices(vwap);
          await this.cachePrice(vwap);
          this.aggregationCount++;
        }
      } catch (error) {
        this.logger.error({ error, pair }, 'Aggregation error');
      }
    }
    this.lastSuccessfulAggregation = Date.now();
  }

  private async calculateVwap(pair: string): Promise<VwapResult | null> {
    const bufferKey = `${BUFFER_KEY_PREFIX}${pair}`;
    const now = Date.now();
    const windowStart = now - WINDOW_SIZE;

    const trades = await this.redis.zrangebyscore(bufferKey, windowStart, now);
    if (trades.length === 0) return null;

    let totalPriceVolume = 0;
    let totalVolume = 0;
    const sources = new Set<string>();

    for (const tradeStr of trades) {
      const trade: TradeEntry = JSON.parse(tradeStr);
      totalPriceVolume += trade.price * trade.volume;
      totalVolume += trade.volume;
      sources.add(trade.exchange);
    }

    const vwapPrice = totalPriceVolume / totalVolume;

    // Cleanup old trades
    await this.redis.zremrangebyscore(bufferKey, 0, windowStart);

    return {
      pair,
      price: vwapPrice,
      volume: totalVolume,
      sources: Array.from(sources),
      timestamp: now,
    };
  }

  private async savePrices(vwap: VwapResult): Promise<void> {
    // Save USD price
    const usdInput: CreatePriceHistoryInput = {
      pair: vwap.pair as PairSymbol,
      price: vwap.price.toFixed(8),
      timestamp: new Date(vwap.timestamp),
      method: 'vwap',
      sources: vwap.sources,
      volume: vwap.volume.toFixed(8),
    };
    await this.priceHistoryRepo.create(usdInput);

    // Convert and save RUB price
    const usdRubRate = await this.cbrRate.getRate();
    if (usdRubRate > 0) {
      const rubPair = vwap.pair.replace('-usd', '-rub') as PairSymbol;
      const rubPrice = vwap.price * usdRubRate;

      const rubInput: CreatePriceHistoryInput = {
        pair: rubPair,
        price: rubPrice.toFixed(8),
        timestamp: new Date(vwap.timestamp),
        method: 'vwap',
        sources: [...vwap.sources, 'cbr'],
        volume: vwap.volume.toFixed(8),
      };
      await this.priceHistoryRepo.create(rubInput);

      // Cache RUB price
      await this.cachePrice({
        ...vwap,
        pair: rubPair,
        price: rubPrice,
        sources: [...vwap.sources, 'cbr'],
      });
    }
  }

  private async cachePrice(vwap: VwapResult): Promise<void> {
    const cacheKey = `price:${vwap.pair}`;
    const cacheValue = JSON.stringify({
      price: vwap.price.toFixed(8),
      timestamp: vwap.timestamp,
      sources: vwap.sources,
    });

    await this.redis.setex(cacheKey, 60, cacheValue);
    await this.redis.publish(cacheKey, cacheValue);
  }
}
