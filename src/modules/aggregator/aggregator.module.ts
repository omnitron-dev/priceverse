/**
 * Priceverse - Aggregator Module
 * Provides OHLCV query service for ChartsService
 *
 * Note: VWAP aggregation is handled by PM StreamAggregatorProcess
 * OHLCV aggregation is handled by PM OhlcvAggregatorProcess + OhlcvSchedulerService
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { OhlcvAggregatorService } from './services/ohlcv-aggregator.service.js';
import { OHLCV_AGGREGATOR_TOKEN } from '../../shared/tokens.js';

@Module({
  providers: [
    { provide: OHLCV_AGGREGATOR_TOKEN, useClass: OhlcvAggregatorService },
  ],
  exports: [OHLCV_AGGREGATOR_TOKEN],
})
export class AggregatorModule {}
