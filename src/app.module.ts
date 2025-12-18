/**
 * Priceverse - Root Application Module (PM Architecture)
 *
 * Single-source-of-truth module using PM-based process management:
 * - PmModule: Collectors, Aggregators, API processes with supervision
 * - RPC Services: Prices, Charts, Health exposed via Netron
 * - Scheduler: OHLCV aggregation via @Cron/@Interval decorators
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { ConfigModule, CONFIG_SERVICE_TOKEN, type ConfigService } from '@omnitron-dev/titan/module/config';
import { LoggerModule, LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import {
  DatabaseModule,
  DATABASE_CONNECTION,
  type DatabaseModuleOptions,
} from '@omnitron-dev/titan/module/database';
import { RedisModule, type RedisModuleOptions } from '@omnitron-dev/titan/module/redis';
import { SchedulerModule } from '@omnitron-dev/titan/module/scheduler';

// PM Module - contains all process managers
import { PmModule, OhlcvSchedulerService } from './modules/pm/index.js';

// Shared tokens
import { CBR_RATE_SERVICE_TOKEN } from './shared/tokens.js';

// Application modules for RPC services
import { HealthModule } from './modules/health/index.js';
import { MetricsModule } from './modules/metrics/index.js';
import { PricesModule } from './modules/prices/index.js';
import { ChartsModule } from './modules/charts/index.js';
import { CollectorModule } from './modules/collector/index.js';
import { AggregatorModule } from './modules/aggregator/index.js';
import { RetentionModule } from './modules/retention/index.js';
import { AlertsModule } from './modules/alerts/index.js';
import { RateLimitModule } from './modules/ratelimit/index.js';

// Config and repositories
import { configSchema } from './config/config.schema.js';
import { PriceHistoryRepository, OhlcvRepository } from './database/index.js';
import { PRICE_HISTORY_REPOSITORY, OHLCV_REPOSITORY } from './shared/tokens.js';

@Module({
  imports: [
    // Titan Core Modules
    ConfigModule.forRoot({
      // Type assertion prevents TS2589 "Type instantiation is excessively deep" error
      // caused by complex nested Zod schemas with deep type inference
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      schema: configSchema as any,
      sources: [
        { type: 'file', path: 'config/default.json', optional: true },
        { type: 'env', prefix: 'PRICEVERSE_', separator: '__' },
      ],
    }),
    LoggerModule.forRoot(),
    DatabaseModule.forRootAsync({
      useFactory: async (...args: unknown[]): Promise<DatabaseModuleOptions> => {
        const config = args[0] as ConfigService;
        const loggerModule = args[1] as ILoggerModule;
        const logger = loggerModule?.logger;

        const dbConfig = config.get('database') as {
          dialect: 'postgres' | 'mysql' | 'sqlite';
          host: string;
          port: number;
          database: string;
          user: string;
          password: string;
          pool?: { min: number; max: number };
          ssl?: boolean;
          sslRejectUnauthorized?: boolean;
        } | undefined;

        if (!dbConfig) {
          logger?.info('[Database] No config found, using in-memory SQLite');
          return {
            connection: {
              dialect: 'sqlite',
              connection: ':memory:',
            },
            plugins: {
              builtIn: {
                timestamps: true,
              },
            },
            healthCheck: true,
          };
        }

        logger?.info(`[Database] Connecting to ${dbConfig.dialect}://${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);

        return {
          connection: {
            dialect: dbConfig.dialect,
            connection: {
              host: dbConfig.host,
              port: dbConfig.port,
              database: dbConfig.database,
              user: dbConfig.user,
              password: dbConfig.password,
              // Security: respect sslRejectUnauthorized config (default true in production)
              ssl: dbConfig.ssl ? { rejectUnauthorized: dbConfig.sslRejectUnauthorized ?? true } : undefined,
            },
            pool: dbConfig.pool ?? { min: 2, max: 20 },
          },
          plugins: {
            builtIn: {
              timestamps: true,
            },
          },
          healthCheck: true,
          migrations: {
            directory: './src/database/migrations',
          },
          autoMigrate: false,
        };
      },
      inject: [CONFIG_SERVICE_TOKEN, LOGGER_SERVICE_TOKEN],
    }),
    RedisModule.forRootAsync({
      isGlobal: true,
      useFactory: async (...args: unknown[]): Promise<RedisModuleOptions> => {
        const config = args[0] as ConfigService;
        const loggerModule = args[1] as ILoggerModule;
        const logger = loggerModule?.logger;

        const redisConfig = config.get('redis') as {
          host: string;
          port: number;
          password?: string;
          db: number;
        } | undefined;

        const host = redisConfig?.host ?? 'localhost';
        const port = redisConfig?.port ?? 6379;

        logger?.info(`[Redis] Connecting to redis://${host}:${port}`);

        return {
          config: {
            host,
            port,
            password: redisConfig?.password,
            db: redisConfig?.db ?? 0,
            lazyConnect: false,
          },
          readyLog: true,
          errorLog: true,
        };
      },
      inject: [CONFIG_SERVICE_TOKEN, LOGGER_SERVICE_TOKEN],
    }),
    SchedulerModule.forRoot(),

    // Application Modules (required for RPC services)
    MetricsModule,
    CollectorModule,
    AggregatorModule,
    PricesModule,
    ChartsModule,
    HealthModule,

    // PM Module - registers all process managers
    PmModule,

    // System maintenance modules
    RetentionModule, // Auto-cleanup of old data
    AlertsModule, // System health monitoring and alerts
    RateLimitModule, // API rate limiting
  ],
  providers: [
    // Repositories - using Kysely database interface
    {
      provide: PRICE_HISTORY_REPOSITORY,
      useFactory: (db: unknown) => new PriceHistoryRepository(db as PriceHistoryRepository['db']),
      inject: [DATABASE_CONNECTION],
    },
    {
      provide: OHLCV_REPOSITORY,
      useFactory: (db: unknown) => new OhlcvRepository(db as OhlcvRepository['db']),
      inject: [DATABASE_CONNECTION],
    },

    // OHLCV Scheduler - uses @Cron/@Interval decorators
    // CBR Rate Service is already registered by CollectorModule
    OhlcvSchedulerService,
  ],
  exports: [
    PRICE_HISTORY_REPOSITORY,
    OHLCV_REPOSITORY,
    CBR_RATE_SERVICE_TOKEN,
  ],
})
export class AppModule {}
