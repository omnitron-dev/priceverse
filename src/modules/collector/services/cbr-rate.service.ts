/**
 * Priceverse - CBR USD/RUB Rate Service
 * Fetches official USD/RUB exchange rate from Central Bank of Russia
 *
 * Features:
 * - Retry logic with exponential backoff
 * - Explicit stale/unavailable state handling
 * - Health check integration
 * - Configurable parameters
 */

import { Injectable, Inject, PostConstruct } from '@omnitron-dev/titan/decorators';
import { RedisService } from '@omnitron-dev/titan/module/redis';
import { CONFIG_SERVICE_TOKEN, type ConfigService } from '@omnitron-dev/titan/module/config';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule, type ILogger } from '@omnitron-dev/titan/module/logger';
import { parseStringPromise } from 'xml2js';

const USD_CHAR_CODE = 'USD';
const CACHE_KEY = 'rate:usd-rub';

// Fallback rate if CBR is completely unavailable (use with caution)
const FALLBACK_RATE = 90.0;

interface CbrValute {
  CharCode: string[];
  Value: string[];
}

interface CbrResponse {
  ValCurs: {
    Valute: CbrValute[];
  };
}

export interface CbrRateStatus {
  rate: number;
  isStale: boolean;
  isFallback: boolean;
  lastFetchTime: number;
  lastError: string | null;
  consecutiveFailures: number;
}

@Injectable()
export class CbrRateService {
  private lastFetchTime = 0;
  private cachedRate = 0;
  private lastError: string | null = null;
  private consecutiveFailures = 0;
  private logger: ILogger;

  // Configurable parameters
  private cbrUrl: string;
  private cacheTtl: number;
  private retryAttempts: number;
  private retryDelay: number;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(CONFIG_SERVICE_TOKEN) config: ConfigService,
    @Inject(LOGGER_SERVICE_TOKEN) loggerModule: ILoggerModule
  ) {
    this.logger = loggerModule.logger;

    // Load config with defaults
    const cbrConfig = config.get('cbr') as {
      url?: string;
      cacheTtl?: number;
      retryAttempts?: number;
      retryDelay?: number;
    } | undefined;

    this.cbrUrl = cbrConfig?.url ?? 'https://www.cbr.ru/scripts/XML_daily.asp';
    this.cacheTtl = cbrConfig?.cacheTtl ?? 3600;
    this.retryAttempts = cbrConfig?.retryAttempts ?? 3;
    this.retryDelay = cbrConfig?.retryDelay ?? 5000;
  }

  @PostConstruct()
  async initialize(): Promise<void> {
    await this.fetchRateWithRetry();
  }

  /**
   * Fetch rate from CBR with retry logic
   */
  async fetchRateWithRetry(): Promise<boolean> {
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        await this.fetchRate();

        // Success - reset failure count
        this.consecutiveFailures = 0;
        this.lastError = null;
        return true;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.lastError = errorMessage;
        this.consecutiveFailures++;

        this.logger.warn(
          { attempt, maxAttempts: this.retryAttempts, error: errorMessage },
          '[CBR] Fetch attempt failed'
        );

        if (attempt < this.retryAttempts) {
          // Exponential backoff
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          await this.sleep(delay);
        }
      }
    }

    this.logger.error(
      { consecutiveFailures: this.consecutiveFailures },
      '[CBR] All fetch attempts failed'
    );
    return false;
  }

  /**
   * Fetch rate from CBR - single attempt
   */
  private async fetchRate(): Promise<void> {
    this.logger.info({ url: this.cbrUrl }, '[CBR] Fetching USD/RUB rate');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
      const response = await fetch(this.cbrUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Priceverse/2.0.0',
          Accept: 'application/xml',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const xmlText = await response.text();
      const parsed = (await parseStringPromise(xmlText)) as CbrResponse;

      if (!parsed?.ValCurs?.Valute) {
        throw new Error('Invalid XML structure: missing ValCurs.Valute');
      }

      const valutes = parsed.ValCurs.Valute;
      const usd = valutes.find((v) => v.CharCode?.[0] === USD_CHAR_CODE);

      if (!usd || !usd.Value?.[0]) {
        throw new Error('USD not found in CBR response');
      }

      const rateStr = usd.Value[0].replace(',', '.');
      const rate = parseFloat(rateStr);

      if (isNaN(rate) || rate <= 0) {
        throw new Error(`Invalid rate value: ${rateStr}`);
      }

      // Update cache
      await this.redis.setex(CACHE_KEY, this.cacheTtl, rate.toString());

      this.cachedRate = rate;
      this.lastFetchTime = Date.now();

      this.logger.info({ rate, cacheTtl: this.cacheTtl }, '[CBR] USD/RUB rate updated');
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Get current USD/RUB rate
   * Returns cached rate, or throws if unavailable and no fallback
   */
  async getRate(): Promise<number> {
    // Try Redis cache first
    try {
      const cached = await this.redis.get(CACHE_KEY);
      if (cached) {
        const rate = parseFloat(cached);
        if (!isNaN(rate) && rate > 0) {
          return rate;
        }
      }
    } catch (error) {
      this.logger.warn({ error }, '[CBR] Redis cache read failed');
    }

    // Return in-memory cache if available
    if (this.cachedRate > 0) {
      return this.cachedRate;
    }

    // Try to fetch fresh rate
    const success = await this.fetchRateWithRetry();
    if (success && this.cachedRate > 0) {
      return this.cachedRate;
    }

    // If rate is completely unavailable, log warning and return fallback
    // This allows the system to continue operating in degraded mode
    this.logger.warn(
      { fallbackRate: FALLBACK_RATE, consecutiveFailures: this.consecutiveFailures },
      '[CBR] Using fallback rate - CBR service unavailable'
    );

    return FALLBACK_RATE;
  }

  /**
   * Get rate with explicit status information
   */
  async getRateWithStatus(): Promise<CbrRateStatus> {
    const rate = await this.getRate();
    const staleThreshold = this.cacheTtl * 2 * 1000; // 2x cache TTL

    return {
      rate,
      isStale: Date.now() - this.lastFetchTime > staleThreshold,
      isFallback: this.cachedRate === 0 || this.cachedRate !== rate,
      lastFetchTime: this.lastFetchTime,
      lastError: this.lastError,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  /**
   * Check if rate is stale (older than 2x cache TTL)
   */
  isRateStale(): boolean {
    const staleThreshold = this.cacheTtl * 2 * 1000;
    return Date.now() - this.lastFetchTime > staleThreshold;
  }

  /**
   * Get health status for monitoring
   */
  getHealthStatus(): { status: 'healthy' | 'degraded' | 'unhealthy'; message: string } {
    if (this.cachedRate === 0) {
      return { status: 'unhealthy', message: 'No rate available' };
    }

    if (this.consecutiveFailures >= 3) {
      return { status: 'degraded', message: `${this.consecutiveFailures} consecutive failures` };
    }

    if (this.isRateStale()) {
      return { status: 'degraded', message: 'Rate is stale' };
    }

    return { status: 'healthy', message: `Rate: ${this.cachedRate}` };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
