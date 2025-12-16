/**
 * Priceverse - Kraken Collector Process
 */

import { Process } from '@omnitron-dev/titan/module/pm';
import { BaseCollectorProcess } from './base-collector.process.js';
import type { Trade } from '../../shared/types.js';

@Process({
  name: 'kraken-collector',
  version: '1.0.0',
  description: 'Kraken WebSocket trade collector',
})
export default class KrakenCollectorProcess extends BaseCollectorProcess {
  private readonly _symbolMap = new Map([
    ['btc-usd', 'XBT/USD'],
    ['eth-usd', 'ETH/USD'],
    ['xmr-usd', 'XMR/USD'],
  ]);

  get exchangeName(): string {
    return 'kraken';
  }

  get wsUrl(): string {
    return 'wss://ws.kraken.com';
  }

  get symbolMap(): Map<string, string> {
    return this._symbolMap;
  }

  parseMessage(data: unknown): Trade | null {
    if (!Array.isArray(data) || data.length < 4) return null;

    const [, trades, , pairName] = data;

    if (!Array.isArray(trades) || !pairName) return null;

    const pair = this.reverseLookup(pairName as string);
    if (!pair) return null;

    // Return the most recent trade
    const lastTrade = trades[trades.length - 1];
    if (!Array.isArray(lastTrade) || lastTrade.length < 3) return null;

    const [price, volume, time] = lastTrade;

    return {
      exchange: this.exchangeName,
      pair,
      price: price as string,
      volume: volume as string,
      timestamp: Math.floor(parseFloat(time as string) * 1000),
      tradeId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
  }

  buildSubscribeMessage(symbols: string[]): unknown {
    return {
      event: 'subscribe',
      pair: symbols,
      subscription: { name: 'trade' },
    };
  }
}
