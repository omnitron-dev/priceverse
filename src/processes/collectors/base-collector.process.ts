/**
 * Priceverse - Base Collector Process
 * Abstract base class for exchange WebSocket collectors using PM module
 */

import { Process, Public, HealthCheck, OnShutdown, CircuitBreaker } from '@omnitron-dev/titan/module/pm';
import type { IHealthStatus } from '@omnitron-dev/titan/module/pm';
import type { RedisService } from '@omnitron-dev/titan/module/redis';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import WebSocket from 'ws';
import type { Trade } from '../../shared/types.js';

export interface ICollectorStats {
  exchange: string;
  connected: boolean;
  tradesReceived: number;
  errors: number;
  lastTradeTime: number | null;
  reconnectAttempts: number;
}

export interface ICollectorDependencies {
  redis: RedisService;
  logger: ILogger;
  maxReconnectAttempts?: number;
}

/**
 * Base Collector Process
 *
 * Each exchange collector extends this class and implements:
 * - exchangeName: Exchange identifier (binance, kraken, etc.)
 * - wsUrl: WebSocket endpoint URL
 * - symbolMap: Internal pair → exchange symbol mapping
 * - parseMessage: Parse exchange-specific message format
 * - buildSubscribeMessage: Build subscription message
 */
@Process({
  name: 'base-collector',
  version: '1.0.0',
})
export abstract class BaseCollectorProcess {
  protected ws: WebSocket | null = null;
  protected isConnected = false;
  protected isRunning = false;
  protected tradesReceived = 0;
  protected errorsCount = 0;
  protected reconnectAttempts = 0;
  protected lastTradeTime: number | null = null;
  protected maxReconnectAttempts = 10;

  protected redis!: RedisService;
  protected logger!: ILogger;

  abstract get exchangeName(): string;
  abstract get wsUrl(): string;
  abstract get symbolMap(): Map<string, string>;

  abstract parseMessage(data: unknown): Trade | null;
  abstract buildSubscribeMessage(symbols: string[]): unknown;

  /**
   * Initialize the collector with dependencies
   */
  async init(deps: ICollectorDependencies): Promise<void> {
    this.redis = deps.redis;
    this.logger = deps.logger;
    this.maxReconnectAttempts = deps.maxReconnectAttempts ?? 10;

    this.isRunning = true;
    await this.connect();

    this.logger.info({ exchange: this.exchangeName }, 'Collector process initialized');
  }

  @Public()
  getStats(): ICollectorStats {
    return {
      exchange: this.exchangeName,
      connected: this.isConnected,
      tradesReceived: this.tradesReceived,
      errors: this.errorsCount,
      lastTradeTime: this.lastTradeTime,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  @Public()
  @CircuitBreaker({ threshold: 5, timeout: 60000, fallback: 'handleReconnectFallback' })
  async reconnect(): Promise<boolean> {
    this.disconnect();
    await this.connect();
    return this.isConnected;
  }

  async handleReconnectFallback(): Promise<boolean> {
    this.logger.warn({ exchange: this.exchangeName }, 'Circuit breaker open, reconnect blocked');
    return false;
  }

  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    const now = Date.now();
    const tradeFlowOk = this.lastTradeTime && (now - this.lastTradeTime) < 60000;

    const checks = [
      {
        name: 'websocket',
        status: this.isConnected ? 'pass' as const : 'fail' as const,
        message: this.isConnected ? 'Connected' : 'Disconnected',
      },
      {
        name: 'trade_flow',
        status: tradeFlowOk ? 'pass' as const : 'warn' as const,
        message: this.lastTradeTime
          ? `Last trade ${now - this.lastTradeTime}ms ago`
          : 'No trades received',
      },
      {
        name: 'error_rate',
        status: this.errorsCount < 10 ? 'pass' as const : this.errorsCount < 50 ? 'warn' as const : 'fail' as const,
        message: `${this.errorsCount} errors`,
      },
    ];

    const hasFailure = checks.some(c => c.status === 'fail');
    const hasWarning = checks.some(c => c.status === 'warn');

    return {
      status: hasFailure ? 'unhealthy' : hasWarning ? 'degraded' : 'healthy',
      checks,
      timestamp: now,
    };
  }

  @OnShutdown()
  async shutdown(): Promise<void> {
    this.logger.info({ exchange: this.exchangeName }, 'Collector shutting down');
    this.isRunning = false;
    this.disconnect();
  }

  protected async connect(): Promise<void> {
    if (!this.isRunning) return;

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.logger.info({ exchange: this.exchangeName }, 'WebSocket connected');
        this.subscribe();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', () => {
        this.isConnected = false;
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

  protected subscribe(): void {
    if (!this.ws || !this.isConnected) return;

    const symbols = Array.from(this.symbolMap.values());
    const message = this.buildSubscribeMessage(symbols);

    if (message) {
      this.ws.send(JSON.stringify(message));
      this.logger.info(
        { exchange: this.exchangeName, symbols: symbols.length },
        'Subscribed to symbols'
      );
    }
  }

  protected async handleMessage(data: WebSocket.RawData): Promise<void> {
    try {
      const dataStr = typeof data === 'string' ? data : data.toString();
      const parsed = JSON.parse(dataStr);
      const trade = this.parseMessage(parsed);

      if (trade) {
        this.tradesReceived++;
        this.lastTradeTime = Date.now();
        await this.publishTrade(trade);
      }
    } catch (error) {
      // Log at debug level - many messages are control frames, not trades
      this.logger.debug({ error, exchange: this.exchangeName }, 'Message parse skipped (non-trade)');
    }
  }

  protected async publishTrade(trade: Trade): Promise<void> {
    const streamKey = `stream:trades:${this.exchangeName}`;

    await this.redis.xadd(streamKey, '*', {
      pair: trade.pair,
      price: trade.price,
      volume: trade.volume,
      timestamp: trade.timestamp.toString(),
      trade_id: trade.tradeId,
    });
  }

  protected disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  protected scheduleReconnect(): void {
    if (!this.isRunning) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(
        { exchange: this.exchangeName, attempts: this.maxReconnectAttempts },
        'Max reconnect attempts reached'
      );
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.logger.info(
      { exchange: this.exchangeName, delay, attempt: this.reconnectAttempts },
      'Scheduling reconnect'
    );

    setTimeout(() => this.connect(), delay);
  }

  protected reverseLookup(symbol: string): string | null {
    for (const [pair, sym] of this.symbolMap.entries()) {
      if (sym === symbol || sym.toUpperCase() === symbol.toUpperCase()) {
        return pair;
      }
    }
    return null;
  }
}
