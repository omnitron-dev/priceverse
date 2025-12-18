/**
 * Priceverse - Application Entry Point
 *
 * High-performance cryptocurrency price aggregation platform using Titan PM architecture:
 * - ProcessManagerModule for isolated process management
 * - SchedulerModule with @Cron/@Interval for OHLCV aggregation
 * - Automatic graceful shutdown via Application lifecycle
 *
 * Run with: pnpm start (production) or pnpm dev (development)
 */

import { Application } from '@omnitron-dev/titan';
import { HttpTransport } from '@omnitron-dev/titan/netron/transport/http';
import { CONFIG_SERVICE_TOKEN, type ConfigService } from '@omnitron-dev/titan/module/config';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';

import { AppModule } from './app.module.js';
import { APP_VERSION } from './shared/version.js';

async function bootstrap() {
  const app = await Application.create(AppModule, {
    name: 'priceverse',
    version: APP_VERSION,
  });

  const loggerModule = await app.container.resolveAsync<ILoggerModule>(LOGGER_SERVICE_TOKEN);
  const logger = loggerModule.logger;
  const config = await app.container.resolveAsync<ConfigService>(CONFIG_SERVICE_TOKEN);

  const appConfig = config.get('app') as { port?: number; host?: string } | undefined;
  const port = appConfig?.port ?? 3000;
  const host = appConfig?.host ?? '0.0.0.0';

  // Register HTTP transport for Netron RPC
  if (app.netron) {
    app.netron.registerTransport('http', () => new HttpTransport());
    app.netron.registerTransportServer('http', {
      name: 'http',
      options: { port, host, cors: true, logging: true },
    });
  }

  // Start application with all PM processes, scheduler, and RPC services
  await app.start();

  logger.info({ host, port }, `Priceverse listening on http://${host}:${port}`);
  logger.info({ services: app.netron?.getServiceNames() ?? [] }, 'Services registered');

  const versionBanner = `PRICEVERSE v${APP_VERSION}`.padStart(32).padEnd(46);
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║${versionBanner}║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║ Collectors: 6 exchanges (PM processes)                       ║');
  console.log('║ Aggregators: VWAP + OHLCV (PM processes)                     ║');
  console.log('║ Scheduler: @Cron/@Interval for aggregation                   ║');
  console.log('║ RPC Services: Prices, Charts, Health via Netron              ║');
  console.log(`║ Server: http://${host}:${port}                                   ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
}

bootstrap().catch((error) => {
  const errorLog = {
    level: 60,
    time: new Date().toISOString(),
    pid: process.pid,
    name: 'priceverse',
    msg: 'Failed to start Priceverse',
    error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
  };
  console.log(JSON.stringify(errorLog));
  process.exit(1);
});
