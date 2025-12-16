/**
 * Priceverse - Process Manager Module
 *
 * Integrates PM processes with Titan's DI and lifecycle management.
 * Processes are registered as providers and use @PostConstruct/@PreDestroy
 * for automatic lifecycle management.
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { ProcessManagerModule } from '@omnitron-dev/titan/module/pm';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import { RedisService } from '@omnitron-dev/titan/module/redis';
import { PriceHistoryRepository, OhlcvRepository } from '../../database/index.js';
import { PRICE_HISTORY_REPOSITORY, OHLCV_REPOSITORY, CBR_RATE_SERVICE_TOKEN } from '../../shared/tokens.js';

// Import process classes
import BinanceCollectorProcess from '../../processes/collectors/binance.process.js';
import KrakenCollectorProcess from '../../processes/collectors/kraken.process.js';
import CoinbaseCollectorProcess from '../../processes/collectors/coinbase.process.js';
import OkxCollectorProcess from '../../processes/collectors/okx.process.js';
import BybitCollectorProcess from '../../processes/collectors/bybit.process.js';
import KucoinCollectorProcess from '../../processes/collectors/kucoin.process.js';
import StreamAggregatorProcess from '../../processes/aggregators/stream-aggregator.process.js';
import OhlcvAggregatorProcess from '../../processes/aggregators/ohlcv-aggregator.process.js';

// Lifecycle service
import { PmLifecycleService } from './pm-lifecycle.service.js';

// Tokens from separate file to avoid circular dependencies
import {
  BINANCE_COLLECTOR,
  KRAKEN_COLLECTOR,
  COINBASE_COLLECTOR,
  OKX_COLLECTOR,
  BYBIT_COLLECTOR,
  KUCOIN_COLLECTOR,
  STREAM_AGGREGATOR,
  OHLCV_AGGREGATOR,
} from './tokens.js';

/**
 * Factory to create collector dependencies
 */
function createCollectorDeps(redis: RedisService, loggerModule: ILoggerModule) {
  return {
    redis,
    logger: loggerModule.logger,
    maxReconnectAttempts: 10,
  };
}

/**
 * Process Manager Module for Priceverse
 *
 * Registers all PM processes as providers with proper DI integration.
 * Uses factory pattern to inject dependencies and initialize processes.
 *
 * Lifecycle:
 * - Processes are initialized via async factory functions
 * - PmLifecycleService manages shutdown order via @PreDestroy
 */
@Module({
  imports: [
    ProcessManagerModule.forRoot({
      isolation: 'worker',
      transport: 'ipc',
      restartPolicy: {
        enabled: true,
        maxRestarts: 5,
        window: 60000,
      },
    }),
  ],
  providers: [
    // Collector processes
    {
      provide: BINANCE_COLLECTOR,
      useFactory: async (redis: RedisService, loggerModule: ILoggerModule) => {
        const process = new BinanceCollectorProcess();
        await process.init(createCollectorDeps(redis, loggerModule));
        return process;
      },
      inject: [RedisService, LOGGER_SERVICE_TOKEN],
    },
    {
      provide: KRAKEN_COLLECTOR,
      useFactory: async (redis: RedisService, loggerModule: ILoggerModule) => {
        const process = new KrakenCollectorProcess();
        await process.init(createCollectorDeps(redis, loggerModule));
        return process;
      },
      inject: [RedisService, LOGGER_SERVICE_TOKEN],
    },
    {
      provide: COINBASE_COLLECTOR,
      useFactory: async (redis: RedisService, loggerModule: ILoggerModule) => {
        const process = new CoinbaseCollectorProcess();
        await process.init(createCollectorDeps(redis, loggerModule));
        return process;
      },
      inject: [RedisService, LOGGER_SERVICE_TOKEN],
    },
    {
      provide: OKX_COLLECTOR,
      useFactory: async (redis: RedisService, loggerModule: ILoggerModule) => {
        const process = new OkxCollectorProcess();
        await process.init(createCollectorDeps(redis, loggerModule));
        return process;
      },
      inject: [RedisService, LOGGER_SERVICE_TOKEN],
    },
    {
      provide: BYBIT_COLLECTOR,
      useFactory: async (redis: RedisService, loggerModule: ILoggerModule) => {
        const process = new BybitCollectorProcess();
        await process.init(createCollectorDeps(redis, loggerModule));
        return process;
      },
      inject: [RedisService, LOGGER_SERVICE_TOKEN],
    },
    {
      provide: KUCOIN_COLLECTOR,
      useFactory: async (redis: RedisService, loggerModule: ILoggerModule) => {
        const process = new KucoinCollectorProcess();
        await process.init(createCollectorDeps(redis, loggerModule));
        return process;
      },
      inject: [RedisService, LOGGER_SERVICE_TOKEN],
    },

    // Stream Aggregator
    {
      provide: STREAM_AGGREGATOR,
      useFactory: async (
        redis: RedisService,
        loggerModule: ILoggerModule,
        priceHistoryRepo: PriceHistoryRepository,
        cbrRate: { getRate(): Promise<number> }
      ) => {
        const process = new StreamAggregatorProcess();
        await process.init({
          redis,
          logger: loggerModule.logger,
          priceHistoryRepo,
          cbrRate,
        });
        return process;
      },
      inject: [RedisService, LOGGER_SERVICE_TOKEN, PRICE_HISTORY_REPOSITORY, CBR_RATE_SERVICE_TOKEN],
    },

    // OHLCV Aggregator
    {
      provide: OHLCV_AGGREGATOR,
      useFactory: async (
        loggerModule: ILoggerModule,
        priceHistoryRepo: PriceHistoryRepository,
        ohlcvRepo: OhlcvRepository
      ) => {
        const process = new OhlcvAggregatorProcess();
        await process.init({
          logger: loggerModule.logger,
          priceHistoryRepo,
          ohlcvRepo,
        });
        return process;
      },
      inject: [LOGGER_SERVICE_TOKEN, PRICE_HISTORY_REPOSITORY, OHLCV_REPOSITORY],
    },

    // Lifecycle service - manages graceful shutdown
    PmLifecycleService,
  ],
  exports: [
    BINANCE_COLLECTOR,
    KRAKEN_COLLECTOR,
    COINBASE_COLLECTOR,
    OKX_COLLECTOR,
    BYBIT_COLLECTOR,
    KUCOIN_COLLECTOR,
    STREAM_AGGREGATOR,
    OHLCV_AGGREGATOR,
    PmLifecycleService,
  ],
})
export class PmModule {}
