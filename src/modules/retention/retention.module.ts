/**
 * Priceverse - Data Retention Module
 *
 * Provides automatic cleanup of old data according to retention policy.
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { RetentionService } from './retention.service.js';

@Module({
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
