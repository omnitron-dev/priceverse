/**
 * Test helpers for Priceverse integration tests
 * Provides utilities to create test instances with mocked dependencies
 *
 * Updated for PM-based architecture (v2.0.0)
 */

import { vi } from 'vitest';

// Import tokens
import {
  OHLCV_AGGREGATOR_TOKEN,
  CBR_RATE_SERVICE_TOKEN,
  PRICES_SERVICE_TOKEN,
  CHARTS_SERVICE_TOKEN,
  PRICE_HISTORY_REPOSITORY,
  METRICS_SERVICE_TOKEN,
} from '../../src/shared/tokens.js';

// Service imports - only import services that still exist
import { CbrRateService } from '../../src/modules/collector/services/cbr-rate.service.js';
import { OhlcvAggregatorService } from '../../src/modules/aggregator/services/ohlcv-aggregator.service.js';
import { PricesService } from '../../src/modules/prices/services/prices.service.js';
import { ChartsService } from '../../src/modules/charts/services/charts.service.js';

/**
 * Create a mock ILoggerModule that wraps logger methods
 */
export function createMockLoggerModule(mockLogger?: Partial<{
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  trace: ReturnType<typeof vi.fn>;
  fatal: ReturnType<typeof vi.fn>;
}>): { logger: any } {
  const defaultLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    ...mockLogger,
  };
  return { logger: defaultLogger };
}

/**
 * Create a mock Redis service
 */
export function createMockRedis() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    publish: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    on: vi.fn(),
    duplicate: vi.fn().mockReturnThis(),
    multi: vi.fn().mockReturnValue({
      zremrangebyscore: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    }),
    xgroup: vi.fn(),
    xreadgroup: vi.fn(),
    xadd: vi.fn(),
    xack: vi.fn(),
    zadd: vi.fn(),
    zrangebyscore: vi.fn(),
    zremrangebyscore: vi.fn(),
    zcount: vi.fn(),
  };
}

/**
 * Create a mock database with Kysely-like query builder
 */
export function createMockDatabase() {
  const mockBuilder = {
    selectFrom: vi.fn().mockReturnThis(),
    insertInto: vi.fn().mockReturnThis(),
    deleteFrom: vi.fn().mockReturnThis(),
    updateTable: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    selectAll: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflict: vi.fn().mockReturnThis(),
    doUpdateSet: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
    executeTakeFirst: vi.fn().mockResolvedValue(null),
    executeTakeFirstOrThrow: vi.fn(),
  };
  return mockBuilder;
}

/**
 * Create a mock PriceHistoryRepository
 */
export function createMockPriceHistoryRepository() {
  return {
    create: vi.fn().mockResolvedValue({ id: 1 }),
    findById: vi.fn().mockResolvedValue(null),
    findLatestByPair: vi.fn().mockResolvedValue(null),
    findByPairInRange: vi.fn().mockResolvedValue([]),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    delete: vi.fn().mockResolvedValue(true),
    getFirstPriceAfter: vi.fn().mockResolvedValue(null),
    getLastPriceBefore: vi.fn().mockResolvedValue(null),
    getLatestPrice: vi.fn().mockResolvedValue(null),
  };
}

/**
 * Create a mock OhlcvRepository
 */
export function createMockOhlcvRepository() {
  return {
    upsertCandle: vi.fn().mockResolvedValue({ id: 1 }),
    getCandles: vi.fn().mockResolvedValue({ candles: [], total: 0 }),
    getCandlesWithCursor: vi.fn().mockResolvedValue({
      candles: [],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    }),
    getLatestCandle: vi.fn().mockResolvedValue(null),
    getCandleCount: vi.fn().mockResolvedValue(0),
    getOpenClosePrice: vi.fn().mockResolvedValue(null),
  };
}

/**
 * Create a mock OhlcvAggregatorService
 */
export function createMockOhlcvAggregator() {
  return {
    getCandles: vi.fn().mockResolvedValue({ candles: [], total: 0 }),
    getCandlesWithCursor: vi.fn().mockResolvedValue({
      candles: [],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    }),
    getLatestCandle: vi.fn().mockResolvedValue(null),
    getCandleCount: vi.fn().mockResolvedValue(0),
    aggregate5Min: vi.fn().mockResolvedValue({ processed: 0 }),
    aggregate1Hour: vi.fn().mockResolvedValue({ processed: 0 }),
    aggregate1Day: vi.fn().mockResolvedValue({ processed: 0 }),
  };
}

/**
 * Create a mock MetricsService
 */
export function createMockMetricsService() {
  return {
    increment: vi.fn(),
    gauge: vi.fn(),
    histogram: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({}),
    recordCacheHit: vi.fn(),
    recordCacheMiss: vi.fn(),
    recordDbQuery: vi.fn(),
    recordRedisOperation: vi.fn(),
    recordRedisOp: vi.fn(),
  };
}

/**
 * Create a mock ConfigService
 */
export function createMockConfigService(overrides: Record<string, any> = {}) {
  const defaults = {
    cbr: {
      url: 'https://www.cbr.ru/scripts/XML_daily.asp',
      cacheTtl: 3600,
      retryAttempts: 3,
      retryDelay: 5000,
    },
    api: {
      rateLimit: { enabled: false, windowMs: 60000, maxRequests: 100 },
      cache: { priceTtl: 60, staleThreshold: 120000 },
      streaming: { idleTimeout: 60000, maxQueueSize: 1000 },
    },
    ...overrides,
  };

  return {
    get: vi.fn((key: string) => {
      const parts = key.split('.');
      let value: any = defaults;
      for (const part of parts) {
        value = value?.[part];
      }
      return value;
    }),
  };
}

/**
 * Create a CbrRateService instance with mocked dependencies
 */
export function createCbrRateService(mocks: {
  redis?: ReturnType<typeof createMockRedis>;
  config?: ReturnType<typeof createMockConfigService>;
  loggerModule?: ReturnType<typeof createMockLoggerModule>;
}) {
  const redis = mocks.redis ?? createMockRedis();
  const config = mocks.config ?? createMockConfigService();
  const loggerModule = mocks.loggerModule ?? createMockLoggerModule();

  return new CbrRateService(redis as any, config as any, loggerModule as any);
}

/**
 * Create a PricesService instance with mocked dependencies
 */
export function createPricesService(mocks: {
  redis?: ReturnType<typeof createMockRedis>;
  loggerModule?: ReturnType<typeof createMockLoggerModule>;
  priceHistoryRepo?: ReturnType<typeof createMockPriceHistoryRepository>;
  metrics?: ReturnType<typeof createMockMetricsService>;
}) {
  const redis = mocks.redis ?? createMockRedis();
  const loggerModule = mocks.loggerModule ?? createMockLoggerModule();
  const priceHistoryRepo = mocks.priceHistoryRepo ?? createMockPriceHistoryRepository();
  const metrics = mocks.metrics ?? createMockMetricsService();

  return new PricesService(redis as any, loggerModule as any, priceHistoryRepo as any, metrics as any);
}

/**
 * Create a ChartsService instance with mocked dependencies
 */
export function createChartsService(mocks: {
  ohlcvAggregator?: ReturnType<typeof createMockOhlcvAggregator>;
  loggerModule?: ReturnType<typeof createMockLoggerModule>;
}) {
  const ohlcvAggregator = mocks.ohlcvAggregator ?? createMockOhlcvAggregator();
  const loggerModule = mocks.loggerModule ?? createMockLoggerModule();

  return new ChartsService(ohlcvAggregator as any, loggerModule as any);
}

/**
 * Create an OhlcvAggregatorService instance with mocked dependencies
 */
export function createOhlcvAggregatorService(mocks: {
  loggerModule?: ReturnType<typeof createMockLoggerModule>;
  ohlcvRepo?: ReturnType<typeof createMockOhlcvRepository>;
}) {
  const loggerModule = mocks.loggerModule ?? createMockLoggerModule();
  const ohlcvRepo = mocks.ohlcvRepo ?? createMockOhlcvRepository();

  return new OhlcvAggregatorService(loggerModule as any, ohlcvRepo as any);
}

// Re-export tokens for convenience
export {
  OHLCV_AGGREGATOR_TOKEN,
  CBR_RATE_SERVICE_TOKEN,
  PRICES_SERVICE_TOKEN,
  CHARTS_SERVICE_TOKEN,
  PRICE_HISTORY_REPOSITORY,
  METRICS_SERVICE_TOKEN,
};

// Export service classes for type checking
export {
  CbrRateService,
  OhlcvAggregatorService,
  PricesService,
  ChartsService,
};
