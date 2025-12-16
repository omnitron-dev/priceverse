/**
 * Priceverse - PM Lifecycle Service
 *
 * Manages lifecycle of PM processes, ensuring proper shutdown via @PreDestroy.
 * This service is automatically disposed by Titan's container lifecycle.
 */

import { Injectable, Inject, Optional } from '@omnitron-dev/titan/decorators';
import { PreDestroy } from '@omnitron-dev/titan/decorators';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule, type ILogger } from '@omnitron-dev/titan/module/logger';

import type BinanceCollectorProcess from '../../processes/collectors/binance.process.js';
import type KrakenCollectorProcess from '../../processes/collectors/kraken.process.js';
import type CoinbaseCollectorProcess from '../../processes/collectors/coinbase.process.js';
import type OkxCollectorProcess from '../../processes/collectors/okx.process.js';
import type BybitCollectorProcess from '../../processes/collectors/bybit.process.js';
import type KucoinCollectorProcess from '../../processes/collectors/kucoin.process.js';
import type StreamAggregatorProcess from '../../processes/aggregators/stream-aggregator.process.js';
import type OhlcvAggregatorProcess from '../../processes/aggregators/ohlcv-aggregator.process.js';

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

interface ProcessWithShutdown {
  shutdown(): Promise<void>;
}

/**
 * PM Lifecycle Service
 *
 * Coordinates shutdown of all PM processes in the correct order:
 * 1. Aggregators (flush pending data)
 * 2. Collectors (close WebSocket connections)
 */
@Injectable()
export class PmLifecycleService {
  private logger: ILogger;
  private processes: Array<{ name: string; process: ProcessWithShutdown }> = [];

  constructor(
    @Inject(LOGGER_SERVICE_TOKEN) loggerModule: ILoggerModule,
    @Optional() @Inject(BINANCE_COLLECTOR) binance?: BinanceCollectorProcess,
    @Optional() @Inject(KRAKEN_COLLECTOR) kraken?: KrakenCollectorProcess,
    @Optional() @Inject(COINBASE_COLLECTOR) coinbase?: CoinbaseCollectorProcess,
    @Optional() @Inject(OKX_COLLECTOR) okx?: OkxCollectorProcess,
    @Optional() @Inject(BYBIT_COLLECTOR) bybit?: BybitCollectorProcess,
    @Optional() @Inject(KUCOIN_COLLECTOR) kucoin?: KucoinCollectorProcess,
    @Optional() @Inject(STREAM_AGGREGATOR) streamAggregator?: StreamAggregatorProcess,
    @Optional() @Inject(OHLCV_AGGREGATOR) ohlcvAggregator?: OhlcvAggregatorProcess
  ) {
    this.logger = loggerModule.logger;

    // Build process list in shutdown order: aggregators first, then collectors
    if (ohlcvAggregator) this.processes.push({ name: 'ohlcv-aggregator', process: ohlcvAggregator });
    if (streamAggregator) this.processes.push({ name: 'stream-aggregator', process: streamAggregator });
    if (binance) this.processes.push({ name: 'binance', process: binance });
    if (kraken) this.processes.push({ name: 'kraken', process: kraken });
    if (coinbase) this.processes.push({ name: 'coinbase', process: coinbase });
    if (okx) this.processes.push({ name: 'okx', process: okx });
    if (bybit) this.processes.push({ name: 'bybit', process: bybit });
    if (kucoin) this.processes.push({ name: 'kucoin', process: kucoin });

    this.logger.info({ processCount: this.processes.length }, 'PM Lifecycle service initialized');
  }

  /**
   * Get all registered processes
   */
  getProcesses(): Array<{ name: string; process: ProcessWithShutdown }> {
    return [...this.processes];
  }

  /**
   * Shutdown all processes in order
   * Called automatically by Titan's @PreDestroy
   */
  @PreDestroy()
  async shutdown(): Promise<void> {
    this.logger.info({ processCount: this.processes.length }, 'PM Lifecycle: Starting graceful shutdown');

    for (const { name, process } of this.processes) {
      try {
        this.logger.debug({ process: name }, 'Shutting down process');
        await process.shutdown();
        this.logger.info({ process: name }, 'Process shut down successfully');
      } catch (error) {
        this.logger.error({ process: name, error }, 'Process shutdown error');
      }
    }

    this.logger.info({}, 'PM Lifecycle: All processes shut down');
  }
}
