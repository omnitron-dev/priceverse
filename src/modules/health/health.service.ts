/**
 * Priceverse - Health Service
 * Provides health check functionality using PM processes and Titan's DatabaseHealthIndicator
 */

import { Injectable, Inject, Optional } from '@omnitron-dev/titan/decorators';
import { CONFIG_SERVICE_TOKEN, type ConfigService } from '@omnitron-dev/titan/module/config';
import { Redis } from 'ioredis';
import {
  DatabaseHealthIndicator,
  DATABASE_HEALTH_INDICATOR,
  type DatabaseHealthCheckResult,
  type DatabaseMetrics,
} from '@omnitron-dev/titan/module/database';
import type { HealthResponse, HealthCheck } from '../../shared/types.js';
import { APP_VERSION } from '../../shared/version.js';
import {
  BINANCE_COLLECTOR,
  KRAKEN_COLLECTOR,
  COINBASE_COLLECTOR,
  OKX_COLLECTOR,
  BYBIT_COLLECTOR,
  KUCOIN_COLLECTOR,
} from '../pm/tokens.js';
import type { ICollectorStats } from '../../processes/collectors/base-collector.process.js';

// Extended health response with database metrics
export interface ExtendedHealthResponse extends HealthResponse {
  database?: {
    connected: boolean;
    connectionsCount: number;
    pool?: {
      total: number;
      active: number;
      idle: number;
      waiting: number;
    };
    migrations?: {
      upToDate: boolean;
      pendingCount: number;
      currentVersion?: string;
    };
    metrics?: DatabaseMetrics;
  };
}

interface CollectorProcess {
  getStats(): ICollectorStats;
}

@Injectable()
export class HealthService {
  private startTime = Date.now();
  private collectors: Array<{ name: string; collector: CollectorProcess }> = [];
  private redisClient: Redis | null = null;
  private redisConfig: { host: string; port: number; password?: string; db: number };

  constructor(
    @Inject(CONFIG_SERVICE_TOKEN) private readonly config: ConfigService,
    @Inject(DATABASE_HEALTH_INDICATOR) private readonly dbHealth: DatabaseHealthIndicator,
    @Optional() @Inject(BINANCE_COLLECTOR) binance?: CollectorProcess,
    @Optional() @Inject(KRAKEN_COLLECTOR) kraken?: CollectorProcess,
    @Optional() @Inject(COINBASE_COLLECTOR) coinbase?: CollectorProcess,
    @Optional() @Inject(OKX_COLLECTOR) okx?: CollectorProcess,
    @Optional() @Inject(BYBIT_COLLECTOR) bybit?: CollectorProcess,
    @Optional() @Inject(KUCOIN_COLLECTOR) kucoin?: CollectorProcess
  ) {
    // Build collector list
    if (binance) this.collectors.push({ name: 'binance', collector: binance });
    if (kraken) this.collectors.push({ name: 'kraken', collector: kraken });
    if (coinbase) this.collectors.push({ name: 'coinbase', collector: coinbase });
    if (okx) this.collectors.push({ name: 'okx', collector: okx });
    if (bybit) this.collectors.push({ name: 'bybit', collector: bybit });
    if (kucoin) this.collectors.push({ name: 'kucoin', collector: kucoin });

    // Get Redis config
    const redisConf = this.config.get('redis') as { host: string; port: number; password?: string; db: number } | undefined;
    this.redisConfig = {
      host: redisConf?.host ?? 'localhost',
      port: redisConf?.port ?? 6379,
      password: redisConf?.password,
      db: redisConf?.db ?? 0,
    };
  }

  /**
   * Get or create Redis client for health checks
   */
  private getRedisClient(): Redis {
    if (!this.redisClient || this.redisClient.status === 'end') {
      this.redisClient = new Redis({
        host: this.redisConfig.host,
        port: this.redisConfig.port,
        password: this.redisConfig.password,
        db: this.redisConfig.db,
        lazyConnect: false,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null, // Don't retry for health checks
      });
    }
    return this.redisClient;
  }

  /**
   * Get comprehensive health status including database metrics
   */
  async getHealth(): Promise<ExtendedHealthResponse> {
    const startCheck = Date.now();
    const checks: Record<string, HealthCheck> = {};

    // Check database connectivity using Titan's DatabaseHealthIndicator
    const dbResult = await this.checkDatabase();
    checks.database = dbResult.check;

    // Check Redis connectivity
    checks.redis = await this.checkRedis();

    // Check exchange connections via PM collectors
    checks.exchanges = this.checkExchanges();

    // Determine overall health status
    const allUp = Object.values(checks).every((check) => check.status === 'up');
    const allDown = Object.values(checks).every((check) => check.status === 'down');

    const status = allUp ? 'healthy' : allDown ? 'unhealthy' : 'degraded';

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: APP_VERSION,
      checks,
      latency: Date.now() - startCheck,
      database: dbResult.details,
    };
  }

  /**
   * Check database health using DatabaseHealthIndicator
   */
  private async checkDatabase(): Promise<{
    check: HealthCheck;
    details?: ExtendedHealthResponse['database'];
  }> {
    const start = Date.now();
    try {
      const health: DatabaseHealthCheckResult = await this.dbHealth.check();

      const connectionNames = Object.keys(health.connections);
      const firstConnection = connectionNames.length > 0 ? health.connections[connectionNames[0]] : null;

      const details: ExtendedHealthResponse['database'] = {
        connected: health.status === 'healthy',
        connectionsCount: connectionNames.length,
        pool: firstConnection?.pool
          ? {
            total: firstConnection.pool.total,
            active: firstConnection.pool.active,
            idle: firstConnection.pool.idle,
            waiting: firstConnection.pool.waiting,
          }
          : undefined,
        migrations: health.migrations
          ? {
            upToDate: health.migrations.upToDate,
            pendingCount: health.migrations.pendingCount,
            currentVersion: health.migrations.currentVersion,
          }
          : undefined,
        metrics: health.metrics,
      };

      return {
        check: {
          status: health.status === 'healthy' ? 'up' : 'down',
          latency: Date.now() - start,
          message:
            health.status === 'healthy'
              ? `Database connected (${connectionNames.length} connection(s))`
              : firstConnection?.error ?? 'Database unhealthy',
        },
        details,
      };
    } catch (error) {
      return {
        check: {
          status: 'down',
          latency: Date.now() - start,
          message: error instanceof Error ? error.message : 'Database check failed',
        },
      };
    }
  }

  /**
   * Check Redis health using direct ioredis connection
   */
  private async checkRedis(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      const client = this.getRedisClient();
      const result = await client.ping();
      if (result === 'PONG') {
        return {
          status: 'up',
          latency: Date.now() - start,
        };
      }
      return {
        status: 'down',
        latency: Date.now() - start,
        message: 'Redis ping failed',
      };
    } catch (error) {
      return {
        status: 'down',
        latency: Date.now() - start,
        message: error instanceof Error ? error.message : 'Redis connection failed',
      };
    }
  }

  /**
   * Check exchange connections via PM collector processes
   */
  private checkExchanges(): HealthCheck {
    try {
      const stats = this.collectors.map(({ collector }) => collector.getStats());
      const connectedCount = stats.filter((s) => s.connected).length;
      const totalCount = stats.length;

      if (connectedCount === 0) {
        return {
          status: 'down',
          message: `No exchanges connected (0/${totalCount})`,
        };
      }

      return {
        status: 'up',
        message: `${connectedCount}/${totalCount} exchanges connected`,
      };
    } catch (error) {
      return {
        status: 'down',
        message: error instanceof Error ? error.message : 'Failed to check exchanges',
      };
    }
  }

  /**
   * Simple liveness check (always returns healthy if service is running)
   */
  async getLiveness(): Promise<{ status: 'up' }> {
    return { status: 'up' };
  }

  /**
   * Readiness check (checks if service is ready to handle requests)
   */
  async getReadiness(): Promise<HealthCheck> {
    const [dbCheck, redisCheck] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);
    const exchangesCheck = this.checkExchanges();

    const isReady =
      dbCheck.check.status === 'up' &&
      redisCheck.status === 'up' &&
      exchangesCheck.status === 'up';

    if (isReady) {
      return { status: 'up', message: 'Service is ready' };
    }

    const failures: string[] = [];
    if (dbCheck.check.status === 'down') failures.push('database');
    if (redisCheck.status === 'down') failures.push('redis');
    if (exchangesCheck.status === 'down') failures.push('exchanges');

    return {
      status: 'down',
      message: `Service not ready: ${failures.join(', ')} unavailable`,
    };
  }

  /**
   * Get database-specific health metrics
   */
  async getDatabaseHealth(): Promise<ExtendedHealthResponse['database'] | null> {
    const result = await this.checkDatabase();
    return result.details ?? null;
  }
}
