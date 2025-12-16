/**
 * Priceverse - Alerts Module
 *
 * Provides system monitoring and alert notifications.
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { AlertsService } from './alerts.service.js';

@Module({
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
