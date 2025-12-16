/**
 * Priceverse - Binance Collector Process
 */

import { Process } from '@omnitron-dev/titan/module/pm';
import { BaseCollectorProcess } from './base-collector.process.js';
import type { Trade } from '../../shared/types.js';

interface BinanceTradeMessage {
  stream?: string;
  data?: {
    e: string;
    s: string;
    p: string;
    q: string;
    T: number;
    t: number;
  };
}

@Process({
  name: 'binance-collector',
  version: '1.0.0',
  description: 'Binance WebSocket trade collector',
})
export default class BinanceCollectorProcess extends BaseCollectorProcess {
  private readonly _symbolMap = new Map([
    ['btc-usd', 'BTCUSDT'],
    ['eth-usd', 'ETHUSDT'],
    ['xmr-usd', 'XMRUSDT'],
  ]);

  get exchangeName(): string {
    return 'binance';
  }

  get wsUrl(): string {
    const streams = Array.from(this._symbolMap.values())
      .map(s => `${s.toLowerCase()}@trade`)
      .join('/');
    return `wss://stream.binance.com:9443/stream?streams=${streams}`;
  }

  get symbolMap(): Map<string, string> {
    return this._symbolMap;
  }

  parseMessage(data: unknown): Trade | null {
    const msg = data as BinanceTradeMessage;
    if (!msg.data || msg.data.e !== 'trade') return null;

    const trade = msg.data;
    const pair = this.reverseLookup(trade.s);
    if (!pair) return null;

    return {
      exchange: this.exchangeName,
      pair,
      price: trade.p,
      volume: trade.q,
      timestamp: trade.T,
      tradeId: trade.t.toString(),
    };
  }

  buildSubscribeMessage(_symbols: string[]): unknown {
    // Binance uses URL params for subscription
    return null;
  }
}
