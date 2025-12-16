/**
 * Priceverse - Rate Limiter Module
 *
 * Provides sliding window rate limiting for API endpoints.
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { RateLimitService } from './ratelimit.service.js';

@Module({
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
