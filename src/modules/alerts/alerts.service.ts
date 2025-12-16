/**
 * Priceverse - Alert Service
 *
 * Monitors system health and sends alerts for critical failures.
 * Supports webhook notifications and email alerts.
 *
 * Alert types:
 * - Exchange disconnected for too long
 * - Aggregation failures
 * - CBR rate service issues
 * - Database connection issues
 */

import { Injectable, Inject, Optional, PostConstruct, PreDestroy } from '@omnitron-dev/titan/decorators';
import { Interval, Schedulable } from '@omnitron-dev/titan/module/scheduler';
import { CONFIG_SERVICE_TOKEN, type ConfigService } from '@omnitron-dev/titan/module/config';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule, type ILogger } from '@omnitron-dev/titan/module/logger';
import { CBR_RATE_SERVICE_TOKEN } from '../../shared/tokens.js';
import type { CbrRateService } from '../collector/services/cbr-rate.service.js';
import {
  BINANCE_COLLECTOR,
  KRAKEN_COLLECTOR,
  COINBASE_COLLECTOR,
  OKX_COLLECTOR,
  BYBIT_COLLECTOR,
  KUCOIN_COLLECTOR,
  STREAM_AGGREGATOR,
} from '../pm/tokens.js';
import type { BaseCollectorProcess } from '../../processes/collectors/base-collector.process.js';
import type StreamAggregatorProcess from '../../processes/aggregators/stream-aggregator.process.js';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  type: string;
  message: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  resolved?: boolean;
  resolvedAt?: number;
}

interface AlertConfig {
  enabled: boolean;
  webhookUrl?: string;
  email?: {
    enabled: boolean;
    to: string[];
    from: string;
  };
  thresholds: {
    exchangeDisconnectedSeconds: number;
    aggregationFailures: number;
    cbrRateStaleHours: number;
  };
}

@Injectable()
@Schedulable()
export class AlertsService {
  private logger: ILogger;
  private config: AlertConfig;
  private activeAlerts: Map<string, Alert> = new Map();
  private alertHistory: Alert[] = [];
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  private collectors: Array<{ name: string; collector: BaseCollectorProcess }> = [];

  constructor(
    @Inject(CONFIG_SERVICE_TOKEN) configService: ConfigService,
    @Inject(LOGGER_SERVICE_TOKEN) loggerModule: ILoggerModule,
    @Optional() @Inject(CBR_RATE_SERVICE_TOKEN) private readonly cbrRateService?: CbrRateService,
    @Optional() @Inject(STREAM_AGGREGATOR) private readonly streamAggregator?: StreamAggregatorProcess,
    @Optional() @Inject(BINANCE_COLLECTOR) binance?: BaseCollectorProcess,
    @Optional() @Inject(KRAKEN_COLLECTOR) kraken?: BaseCollectorProcess,
    @Optional() @Inject(COINBASE_COLLECTOR) coinbase?: BaseCollectorProcess,
    @Optional() @Inject(OKX_COLLECTOR) okx?: BaseCollectorProcess,
    @Optional() @Inject(BYBIT_COLLECTOR) bybit?: BaseCollectorProcess,
    @Optional() @Inject(KUCOIN_COLLECTOR) kucoin?: BaseCollectorProcess
  ) {
    this.logger = loggerModule.logger;

    // Build collector list
    if (binance) this.collectors.push({ name: 'binance', collector: binance });
    if (kraken) this.collectors.push({ name: 'kraken', collector: kraken });
    if (coinbase) this.collectors.push({ name: 'coinbase', collector: coinbase });
    if (okx) this.collectors.push({ name: 'okx', collector: okx });
    if (bybit) this.collectors.push({ name: 'bybit', collector: bybit });
    if (kucoin) this.collectors.push({ name: 'kucoin', collector: kucoin });

    // Load alert config with defaults
    const alertConfig = configService.get('alerts') as Partial<AlertConfig> | undefined;
    this.config = {
      enabled: alertConfig?.enabled ?? false,
      webhookUrl: alertConfig?.webhookUrl,
      email: alertConfig?.email ?? { enabled: false, to: [], from: 'priceverse@localhost' },
      thresholds: {
        exchangeDisconnectedSeconds: alertConfig?.thresholds?.exchangeDisconnectedSeconds ?? 300,
        aggregationFailures: alertConfig?.thresholds?.aggregationFailures ?? 5,
        cbrRateStaleHours: alertConfig?.thresholds?.cbrRateStaleHours ?? 3,
      },
    };

    this.logger.info({ config: this.config }, 'Alert service initialized');
  }

  @PostConstruct()
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info({}, '[Alerts] Service disabled by config');
      return;
    }

    this.logger.info({}, '[Alerts] Starting health monitoring');
  }

  /**
   * Scheduled health check - runs every 30 seconds
   */
  @Interval(30_000, { name: 'alert-health-check' })
  async checkHealth(): Promise<void> {
    if (!this.config.enabled) return;

    await this.checkExchanges();
    await this.checkAggregator();
    await this.checkCbrRate();
  }

  /**
   * Check exchange collector health
   */
  private async checkExchanges(): Promise<void> {
    const now = Date.now();
    const thresholdMs = this.config.thresholds.exchangeDisconnectedSeconds * 1000;

    for (const { name, collector } of this.collectors) {
      const stats = collector.getStats();
      const alertId = `exchange-disconnected-${name}`;

      if (!stats.connected) {
        // Check if disconnected for too long
        const disconnectedTime = stats.lastTradeTime
          ? now - stats.lastTradeTime
          : thresholdMs + 1; // Assume long disconnect if no trade time

        if (disconnectedTime > thresholdMs) {
          await this.raiseAlert({
            id: alertId,
            severity: 'warning',
            type: 'exchange_disconnected',
            message: `Exchange ${name} has been disconnected for ${Math.round(disconnectedTime / 1000)}s`,
            timestamp: now,
            metadata: {
              exchange: name,
              disconnectedSeconds: Math.round(disconnectedTime / 1000),
              reconnectAttempts: stats.reconnectAttempts,
              errors: stats.errors,
            },
          });
        }
      } else {
        // Exchange is connected - resolve any existing alert
        await this.resolveAlert(alertId);
      }
    }
  }

  /**
   * Check stream aggregator health
   */
  private async checkAggregator(): Promise<void> {
    if (!this.streamAggregator) return;

    const stats = this.streamAggregator.getStats();
    const alertId = 'aggregator-failures';

    if (stats.consecutiveErrors >= this.config.thresholds.aggregationFailures) {
      await this.raiseAlert({
        id: alertId,
        severity: 'critical',
        type: 'aggregation_failures',
        message: `Stream aggregator has ${stats.consecutiveErrors} consecutive errors`,
        timestamp: Date.now(),
        metadata: {
          consecutiveErrors: stats.consecutiveErrors,
          isRunning: stats.isRunning,
          lastSuccessfulAggregation: stats.lastSuccessfulAggregation,
          aggregationCount: stats.aggregationCount,
        },
      });
    } else if (stats.consecutiveErrors === 0) {
      await this.resolveAlert(alertId);
    }
  }

  /**
   * Check CBR rate service health
   */
  private async checkCbrRate(): Promise<void> {
    if (!this.cbrRateService) return;

    const alertId = 'cbr-rate-stale';
    const healthStatus = this.cbrRateService.getHealthStatus();

    if (healthStatus.status === 'unhealthy') {
      await this.raiseAlert({
        id: alertId,
        severity: 'warning',
        type: 'cbr_rate_unavailable',
        message: `CBR rate service: ${healthStatus.message}`,
        timestamp: Date.now(),
        metadata: {
          status: healthStatus.status,
          message: healthStatus.message,
        },
      });
    } else if (healthStatus.status === 'healthy') {
      await this.resolveAlert(alertId);
    }
  }

  /**
   * Raise a new alert or update existing one
   */
  async raiseAlert(alert: Alert): Promise<void> {
    const existing = this.activeAlerts.get(alert.id);

    // Don't spam duplicate alerts
    if (existing && existing.severity === alert.severity) {
      return;
    }

    this.activeAlerts.set(alert.id, alert);
    this.alertHistory.push(alert);

    // Keep history bounded
    if (this.alertHistory.length > 1000) {
      this.alertHistory = this.alertHistory.slice(-500);
    }

    this.logger.warn(
      { alert: { id: alert.id, severity: alert.severity, type: alert.type, message: alert.message } },
      '[Alerts] Alert raised'
    );

    // Send notifications
    await this.sendNotifications(alert);
  }

  /**
   * Resolve an active alert
   */
  async resolveAlert(alertId: string): Promise<void> {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) return;

    alert.resolved = true;
    alert.resolvedAt = Date.now();
    this.activeAlerts.delete(alertId);

    this.logger.info(
      { alertId, duration: alert.resolvedAt - alert.timestamp },
      '[Alerts] Alert resolved'
    );

    // Optionally notify about resolution
    if (this.config.webhookUrl && alert.severity === 'critical') {
      await this.sendWebhook({
        ...alert,
        message: `[RESOLVED] ${alert.message}`,
      });
    }
  }

  /**
   * Send notifications for an alert
   */
  private async sendNotifications(alert: Alert): Promise<void> {
    // Send webhook notification
    if (this.config.webhookUrl) {
      await this.sendWebhook(alert);
    }

    // Email notifications are placeholder - would need SMTP integration
    if (this.config.email?.enabled && this.config.email.to.length > 0) {
      this.logger.info(
        { to: this.config.email.to, alert: alert.id },
        '[Alerts] Email notification would be sent (not implemented)'
      );
    }
  }

  /**
   * Send webhook notification
   */
  private async sendWebhook(alert: Alert): Promise<void> {
    if (!this.config.webhookUrl) return;

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Priceverse/2.0.0',
        },
        body: JSON.stringify({
          alert,
          service: 'priceverse',
          environment: process.env.NODE_ENV ?? 'development',
        }),
      });

      if (!response.ok) {
        this.logger.warn(
          { status: response.status, alertId: alert.id },
          '[Alerts] Webhook request failed'
        );
      } else {
        this.logger.debug({ alertId: alert.id }, '[Alerts] Webhook notification sent');
      }
    } catch (error) {
      this.logger.error({ error, alertId: alert.id }, '[Alerts] Failed to send webhook');
    }
  }

  /**
   * Get all active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Get alert history
   */
  getAlertHistory(limit = 100): Alert[] {
    return this.alertHistory.slice(-limit);
  }

  /**
   * Get current config (for debugging)
   */
  getConfig(): AlertConfig {
    return { ...this.config };
  }

  @PreDestroy()
  async shutdown(): Promise<void> {
    this.logger.info({}, '[Alerts] Service shutting down');
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}
