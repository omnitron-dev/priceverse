/**
 * Priceverse - Rate Limiter Service
 *
 * Provides sliding window rate limiting using Redis.
 * Supports per-client and global rate limits.
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { RedisService } from '@omnitron-dev/titan/module/redis';
import { CONFIG_SERVICE_TOKEN, type ConfigService } from '@omnitron-dev/titan/module/config';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule, type ILogger } from '@omnitron-dev/titan/module/logger';

const RATE_LIMIT_PREFIX = 'ratelimit:';

export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

export class RateLimitExceededError extends Error {
  constructor(
    public readonly remaining: number,
    public readonly resetTime: number,
    public readonly retryAfter: number
  ) {
    super(`Rate limit exceeded. Try again in ${Math.ceil(retryAfter / 1000)} seconds.`);
    this.name = 'RateLimitExceededError';
  }
}

@Injectable()
export class RateLimitService {
  private logger: ILogger;
  private config: RateLimitConfig;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(CONFIG_SERVICE_TOKEN) configService: ConfigService,
    @Inject(LOGGER_SERVICE_TOKEN) loggerModule: ILoggerModule
  ) {
    this.logger = loggerModule.logger;

    // Load rate limit config
    const apiConfig = configService.get('api') as {
      rateLimit?: Partial<RateLimitConfig>;
    } | undefined;

    this.config = {
      enabled: apiConfig?.rateLimit?.enabled ?? true,
      windowMs: apiConfig?.rateLimit?.windowMs ?? 60_000, // 1 minute
      maxRequests: apiConfig?.rateLimit?.maxRequests ?? 100, // 100 requests per minute
    };

    this.logger.info({ config: this.config }, 'Rate limiter initialized');
  }

  /**
   * Check if request is allowed under rate limit
   * Uses sliding window algorithm with Redis sorted sets
   *
   * @param clientId - Unique client identifier (IP, API key, etc.)
   * @param endpoint - Optional endpoint for per-endpoint limits
   */
  async checkLimit(clientId: string, endpoint?: string): Promise<RateLimitResult> {
    if (!this.config.enabled) {
      return {
        allowed: true,
        remaining: this.config.maxRequests,
        resetTime: Date.now() + this.config.windowMs,
      };
    }

    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    const key = endpoint
      ? `${RATE_LIMIT_PREFIX}${clientId}:${endpoint}`
      : `${RATE_LIMIT_PREFIX}${clientId}`;

    try {
      // Use a transaction to ensure atomicity
      const multi = this.redis.multi();

      // Remove old entries outside the window
      multi.zremrangebyscore(key, 0, windowStart);

      // Count current requests in window
      multi.zcard(key);

      // Add current request
      multi.zadd(key, now, `${now}:${Math.random().toString(36).slice(2)}`);

      // Set expiry on the key
      multi.expire(key, Math.ceil(this.config.windowMs / 1000) + 1);

      const results = await multi.exec();

      // results[1] contains [error, result] for the zcard command
      // The result is the count before adding current request
      const zcardResult = results?.[1];
      const currentCount = Array.isArray(zcardResult) ? (zcardResult[1] as number) ?? 0 : 0;
      const remaining = Math.max(0, this.config.maxRequests - currentCount - 1);
      const resetTime = now + this.config.windowMs;

      if (currentCount >= this.config.maxRequests) {
        // Rate limit exceeded
        const retryAfter = this.config.windowMs;

        return {
          allowed: false,
          remaining: 0,
          resetTime,
          retryAfter,
        };
      }

      return {
        allowed: true,
        remaining,
        resetTime,
      };
    } catch (error) {
      // On Redis error, allow the request but log
      this.logger.error({ error, clientId }, 'Rate limit check failed, allowing request');
      return {
        allowed: true,
        remaining: this.config.maxRequests,
        resetTime: Date.now() + this.config.windowMs,
      };
    }
  }

  /**
   * Check and throw if rate limit exceeded
   */
  async enforceLimit(clientId: string, endpoint?: string): Promise<RateLimitResult> {
    const result = await this.checkLimit(clientId, endpoint);

    if (!result.allowed) {
      throw new RateLimitExceededError(
        result.remaining,
        result.resetTime,
        result.retryAfter!
      );
    }

    return result;
  }

  /**
   * Get current rate limit status for a client
   */
  async getStatus(clientId: string, endpoint?: string): Promise<RateLimitResult> {
    if (!this.config.enabled) {
      return {
        allowed: true,
        remaining: this.config.maxRequests,
        resetTime: Date.now() + this.config.windowMs,
      };
    }

    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    const key = endpoint
      ? `${RATE_LIMIT_PREFIX}${clientId}:${endpoint}`
      : `${RATE_LIMIT_PREFIX}${clientId}`;

    try {
      // Count current requests in window
      const count = await this.redis.zcount(key, windowStart, now);
      const remaining = Math.max(0, this.config.maxRequests - count);

      return {
        allowed: remaining > 0,
        remaining,
        resetTime: now + this.config.windowMs,
      };
    } catch (error) {
      this.logger.error({ error, clientId }, 'Rate limit status check failed');
      return {
        allowed: true,
        remaining: this.config.maxRequests,
        resetTime: Date.now() + this.config.windowMs,
      };
    }
  }

  /**
   * Reset rate limit for a client (for admin use)
   */
  async resetLimit(clientId: string, endpoint?: string): Promise<void> {
    const key = endpoint
      ? `${RATE_LIMIT_PREFIX}${clientId}:${endpoint}`
      : `${RATE_LIMIT_PREFIX}${clientId}`;

    try {
      await this.redis.del(key);
      this.logger.info({ clientId, endpoint }, 'Rate limit reset');
    } catch (error) {
      this.logger.error({ error, clientId }, 'Failed to reset rate limit');
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): RateLimitConfig {
    return { ...this.config };
  }
}
