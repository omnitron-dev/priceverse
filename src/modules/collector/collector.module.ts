/**
 * Priceverse - Collector Module
 * Provides CBR rate service for currency conversion
 *
 * Note: Exchange collectors are handled by PM processes in PmModule
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { CONFIG_SERVICE_TOKEN, type ConfigService } from '@omnitron-dev/titan/module/config';
import { CbrRateService } from './services/cbr-rate.service.js';
import { CBR_RATE_SERVICE_TOKEN } from '../../shared/tokens.js';
import { SUPPORTED_EXCHANGES, type SupportedExchange } from '../../shared/types.js';

@Module({
  providers: [
    // Provide EnabledExchanges from config (defaults to all supported exchanges)
    {
      provide: 'EnabledExchanges',
      useFactory: async (config: ConfigService): Promise<readonly SupportedExchange[]> => {
        const exchangesConfig = config.get('exchanges') as { enabled?: string[] } | undefined;
        if (!exchangesConfig?.enabled) {
          return SUPPORTED_EXCHANGES;
        }
        return exchangesConfig.enabled.filter(
          (e): e is SupportedExchange => SUPPORTED_EXCHANGES.includes(e as SupportedExchange)
        );
      },
      inject: [CONFIG_SERVICE_TOKEN],
    },
    { provide: CBR_RATE_SERVICE_TOKEN, useClass: CbrRateService },
  ],
  exports: [CBR_RATE_SERVICE_TOKEN, 'EnabledExchanges'],
})
export class CollectorModule {}
