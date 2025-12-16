/**
 * Priceverse - KuCoin Collector Process
 *
 * KuCoin WebSocket requires two-step connection:
 * 1. Fetch token from REST API (POST /api/v1/bullet-public)
 * 2. Connect to WebSocket with token as query parameter
 */

import { Process } from '@omnitron-dev/titan/module/pm';
import { BaseCollectorProcess } from './base-collector.process.js';
import WebSocket from 'ws';
import type { Trade } from '../../shared/types.js';

interface KucoinTradeMessage {
  type?: string;
  topic?: string;
  subject?: string;
  data?: {
    symbol: string;
    price: string;
    size: string;
    time: string;
    tradeId: string;
  };
}

interface KucoinBulletResponse {
  code: string;
  data: {
    token: string;
    instanceServers: Array<{
      endpoint: string;
      encrypt: boolean;
      protocol: string;
      pingInterval: number;
      pingTimeout: number;
    }>;
  };
}

@Process({
  name: 'kucoin-collector',
  version: '1.1.0',
  description: 'KuCoin WebSocket trade collector',
})
export default class KucoinCollectorProcess extends BaseCollectorProcess {
  private readonly _symbolMap = new Map([
    ['btc-usd', 'BTC-USDT'],
    ['eth-usd', 'ETH-USDT'],
    ['xmr-usd', 'XMR-USDT'],
  ]);

  private pingInterval: NodeJS.Timeout | null = null;
  private pingIntervalMs = 18000; // Default KuCoin ping interval
  private wsToken: string | null = null;
  private wsEndpoint: string | null = null;

  get exchangeName(): string {
    return 'kucoin';
  }

  get wsUrl(): string {
    // This getter is required by base class but KuCoin uses dynamic URL
    // The actual URL is constructed in connect() after fetching token
    return this.wsEndpoint
      ? `${this.wsEndpoint}?token=${this.wsToken}`
      : 'wss://ws-api-spot.kucoin.com';
  }

  get symbolMap(): Map<string, string> {
    return this._symbolMap;
  }

  /**
   * Fetch WebSocket connection token from KuCoin REST API
   */
  private async fetchConnectionToken(): Promise<{ endpoint: string; token: string; pingInterval: number }> {
    const response = await fetch('https://api.kucoin.com/api/v1/bullet-public', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`KuCoin bullet-public API returned ${response.status}`);
    }

    const data = (await response.json()) as KucoinBulletResponse;

    if (data.code !== '200000' || !data.data?.token || !data.data?.instanceServers?.length) {
      throw new Error(`KuCoin bullet-public API error: ${data.code}`);
    }

    const server = data.data.instanceServers[0];
    return {
      endpoint: server.endpoint,
      token: data.data.token,
      pingInterval: server.pingInterval,
    };
  }

  /**
   * Override connect to implement two-step KuCoin connection
   */
  protected override async connect(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Step 1: Fetch token from REST API
      this.logger.info({ exchange: this.exchangeName }, 'Fetching KuCoin WebSocket token...');
      const { endpoint, token, pingInterval } = await this.fetchConnectionToken();

      this.wsEndpoint = endpoint;
      this.wsToken = token;
      this.pingIntervalMs = pingInterval;

      // Step 2: Connect with token
      const wsUrl = `${endpoint}?token=${token}`;
      this.logger.info({ exchange: this.exchangeName, endpoint }, 'Connecting to KuCoin WebSocket...');

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.logger.info({ exchange: this.exchangeName }, 'WebSocket connected');
        // Don't subscribe immediately - wait for welcome message
      });

      this.ws.on('message', (data) => {
        this.handleKucoinMessage(data);
      });

      this.ws.on('close', () => {
        this.isConnected = false;
        this.stopPing();
        this.logger.warn({ exchange: this.exchangeName }, 'WebSocket disconnected');
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        this.errorsCount++;
        this.logger.error({ exchange: this.exchangeName, error }, 'WebSocket error');
      });
    } catch (error) {
      this.errorsCount++;
      this.logger.error({ exchange: this.exchangeName, error }, 'Connection failed');
      this.scheduleReconnect();
    }
  }

  /**
   * Handle KuCoin-specific messages including welcome and pong
   */
  private handleKucoinMessage(data: WebSocket.RawData): void {
    try {
      const dataStr = typeof data === 'string' ? data : data.toString();
      const parsed = JSON.parse(dataStr);

      // Handle welcome message - start ping and subscribe after receiving it
      if (parsed.type === 'welcome') {
        this.logger.info({ exchange: this.exchangeName, id: parsed.id }, 'Received welcome message');
        this.startPing();
        this.subscribe();
        return;
      }

      // Handle pong response
      if (parsed.type === 'pong') {
        this.logger.debug({ exchange: this.exchangeName }, 'Received pong');
        return;
      }

      // Handle ack for subscription
      if (parsed.type === 'ack') {
        this.logger.info({ exchange: this.exchangeName, id: parsed.id }, 'Subscription acknowledged');
        return;
      }

      // Handle trade messages
      const trade = this.parseMessage(parsed);
      if (trade) {
        this.tradesReceived++;
        this.lastTradeTime = Date.now();
        this.publishTrade(trade);
      }
    } catch {
      // Non-JSON or malformed messages - skip silently
    }
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPing(): void {
    this.stopPing();

    this.pingInterval = setInterval(() => {
      if (this.ws && this.isConnected) {
        const pingMessage = {
          id: Date.now().toString(),
          type: 'ping',
        };
        this.ws.send(JSON.stringify(pingMessage));
        this.logger.debug({ exchange: this.exchangeName }, 'Sent ping');
      }
    }, this.pingIntervalMs);
  }

  /**
   * Stop ping interval
   */
  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Override disconnect to also stop ping
   */
  protected override disconnect(): void {
    this.stopPing();
    super.disconnect();
  }

  parseMessage(data: unknown): Trade | null {
    const msg = data as KucoinTradeMessage;
    if (msg.type !== 'message' || msg.subject !== 'trade.l3match') return null;

    const tradeData = msg.data;
    if (!tradeData) return null;

    const pair = this.reverseLookup(tradeData.symbol);
    if (!pair) return null;

    return {
      exchange: this.exchangeName,
      pair,
      price: tradeData.price,
      volume: tradeData.size,
      timestamp: parseInt(tradeData.time, 10),
      tradeId: tradeData.tradeId,
    };
  }

  buildSubscribeMessage(symbols: string[]): unknown {
    return {
      id: Date.now().toString(),
      type: 'subscribe',
      topic: `/market/match:${symbols.join(',')}`,
      privateChannel: false,
      response: true,
    };
  }
}
