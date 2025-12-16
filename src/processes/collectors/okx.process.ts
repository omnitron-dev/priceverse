/**
 * Priceverse - OKX Collector Process
 */

import { Process } from '@omnitron-dev/titan/module/pm';
import { BaseCollectorProcess } from './base-collector.process.js';
import type { Trade } from '../../shared/types.js';

interface OkxTradeMessage {
  arg?: { channel: string; instId: string };
  data?: Array<{
    instId: string;
    px: string;
    sz: string;
    ts: string;
    tradeId: string;
  }>;
}

@Process({
  name: 'okx-collector',
  version: '1.0.0',
  description: 'OKX WebSocket trade collector',
})
export default class OkxCollectorProcess extends BaseCollectorProcess {
  private readonly _symbolMap = new Map([
    ['btc-usd', 'BTC-USDT'],
    ['eth-usd', 'ETH-USDT'],
    ['xmr-usd', 'XMR-USDT'],
  ]);

  get exchangeName(): string {
    return 'okx';
  }

  get wsUrl(): string {
    return 'wss://ws.okx.com:8443/ws/v5/public';
  }

  get symbolMap(): Map<string, string> {
    return this._symbolMap;
  }

  parseMessage(data: unknown): Trade | null {
    const msg = data as OkxTradeMessage;
    if (!msg.data || !msg.arg || msg.arg.channel !== 'trades') return null;

    const tradeData = msg.data[0];
    if (!tradeData) return null;

    const pair = this.reverseLookup(tradeData.instId);
    if (!pair) return null;

    return {
      exchange: this.exchangeName,
      pair,
      price: tradeData.px,
      volume: tradeData.sz,
      timestamp: parseInt(tradeData.ts, 10),
      tradeId: tradeData.tradeId,
    };
  }

  buildSubscribeMessage(symbols: string[]): unknown {
    return {
      op: 'subscribe',
      args: symbols.map(s => ({
        channel: 'trades',
        instId: s,
      })),
    };
  }
}
