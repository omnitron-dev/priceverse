/**
 * Priceverse - Bybit Collector Process
 */

import { Process } from '@omnitron-dev/titan/module/pm';
import { BaseCollectorProcess } from './base-collector.process.js';
import type { Trade } from '../../shared/types.js';

interface BybitTradeMessage {
  topic?: string;
  data?: Array<{
    s: string;   // symbol
    p: string;   // price
    v: string;   // volume
    T: number;   // timestamp
    i: string;   // trade id
  }>;
}

@Process({
  name: 'bybit-collector',
  version: '1.0.0',
  description: 'Bybit WebSocket trade collector',
})
export default class BybitCollectorProcess extends BaseCollectorProcess {
  private readonly _symbolMap = new Map([
    ['btc-usd', 'BTCUSDT'],
    ['eth-usd', 'ETHUSDT'],
    ['xmr-usd', 'XMRUSDT'],
  ]);

  get exchangeName(): string {
    return 'bybit';
  }

  get wsUrl(): string {
    return 'wss://stream.bybit.com/v5/public/spot';
  }

  get symbolMap(): Map<string, string> {
    return this._symbolMap;
  }

  parseMessage(data: unknown): Trade | null {
    const msg = data as BybitTradeMessage;
    if (!msg.topic?.startsWith('publicTrade') || !msg.data?.length) return null;

    const tradeData = msg.data[0];
    if (!tradeData) return null;

    const pair = this.reverseLookup(tradeData.s);
    if (!pair) return null;

    return {
      exchange: this.exchangeName,
      pair,
      price: tradeData.p,
      volume: tradeData.v,
      timestamp: tradeData.T,
      tradeId: tradeData.i,
    };
  }

  buildSubscribeMessage(symbols: string[]): unknown {
    return {
      op: 'subscribe',
      args: symbols.map(s => `publicTrade.${s}`),
    };
  }
}
