/**
 * Priceverse - PM Process Tokens
 *
 * Tokens for DI injection of PM processes.
 * Separated to avoid circular dependencies.
 */

import { createToken, type Token } from '@omnitron-dev/titan/nexus';

import type BinanceCollectorProcess from '../../processes/collectors/binance.process.js';
import type KrakenCollectorProcess from '../../processes/collectors/kraken.process.js';
import type CoinbaseCollectorProcess from '../../processes/collectors/coinbase.process.js';
import type OkxCollectorProcess from '../../processes/collectors/okx.process.js';
import type BybitCollectorProcess from '../../processes/collectors/bybit.process.js';
import type KucoinCollectorProcess from '../../processes/collectors/kucoin.process.js';
import type StreamAggregatorProcess from '../../processes/aggregators/stream-aggregator.process.js';
import type OhlcvAggregatorProcess from '../../processes/aggregators/ohlcv-aggregator.process.js';

// Collector tokens
export const BINANCE_COLLECTOR: Token<BinanceCollectorProcess> = createToken<BinanceCollectorProcess>('BinanceCollector');
export const KRAKEN_COLLECTOR: Token<KrakenCollectorProcess> = createToken<KrakenCollectorProcess>('KrakenCollector');
export const COINBASE_COLLECTOR: Token<CoinbaseCollectorProcess> = createToken<CoinbaseCollectorProcess>('CoinbaseCollector');
export const OKX_COLLECTOR: Token<OkxCollectorProcess> = createToken<OkxCollectorProcess>('OkxCollector');
export const BYBIT_COLLECTOR: Token<BybitCollectorProcess> = createToken<BybitCollectorProcess>('BybitCollector');
export const KUCOIN_COLLECTOR: Token<KucoinCollectorProcess> = createToken<KucoinCollectorProcess>('KucoinCollector');

// Aggregator tokens
export const STREAM_AGGREGATOR: Token<StreamAggregatorProcess> = createToken<StreamAggregatorProcess>('StreamAggregator');
export const OHLCV_AGGREGATOR: Token<OhlcvAggregatorProcess> = createToken<OhlcvAggregatorProcess>('OhlcvAggregator');
