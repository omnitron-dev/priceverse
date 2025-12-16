/**
 * Priceverse - Coinbase Collector Process
 */

import { Process } from '@omnitron-dev/titan/module/pm';
import { BaseCollectorProcess } from './base-collector.process.js';
import type { Trade } from '../../shared/types.js';

interface CoinbaseMatchMessage {
  type: string;
  product_id: string;
  price: string;
  size: string;
  time: string;
  trade_id: number;
}

@Process({
  name: 'coinbase-collector',
  version: '1.0.0',
  description: 'Coinbase WebSocket trade collector',
})
export default class CoinbaseCollectorProcess extends BaseCollectorProcess {
  private readonly _symbolMap = new Map([
    ['btc-usd', 'BTC-USD'],
    ['eth-usd', 'ETH-USD'],
    // Coinbase doesn't support XMR
  ]);

  get exchangeName(): string {
    return 'coinbase';
  }

  get wsUrl(): string {
    return 'wss://ws-feed.exchange.coinbase.com';
  }

  get symbolMap(): Map<string, string> {
    return this._symbolMap;
  }

  parseMessage(data: unknown): Trade | null {
    const msg = data as CoinbaseMatchMessage;
    if (msg.type !== 'match') return null;

    const pair = this.reverseLookup(msg.product_id);
    if (!pair) return null;

    return {
      exchange: this.exchangeName,
      pair,
      price: msg.price,
      volume: msg.size,
      timestamp: new Date(msg.time).getTime(),
      tradeId: msg.trade_id.toString(),
    };
  }

  buildSubscribeMessage(symbols: string[]): unknown {
    return {
      type: 'subscribe',
      product_ids: symbols,
      channels: ['matches'],
    };
  }
}
