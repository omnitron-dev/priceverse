/**
 * Priceverse - Configuration Schema
 */

import { z } from 'zod';
import { APP_VERSION } from '../shared/version.js';

export const configSchema = z.object({
  // Application
  app: z.object({
    name: z.string().default('priceverse'),
    version: z.string().default(APP_VERSION),
    environment: z
      .enum(['development', 'staging', 'production'])
      .default('development'),
    port: z.number().default(3000),
    host: z.string().default('0.0.0.0'),
  }),

  // Database
  database: z.object({
    dialect: z.literal('postgres').default('postgres'),
    host: z.string().default('localhost'),
    port: z.number().default(5432),
    database: z.string().default('priceverse'),
    user: z.string().default('postgres'),
    password: z.string().default('postgres'),
    pool: z
      .object({
        min: z.number().default(2),
        max: z.number().default(20),
      })
      .optional(),
    ssl: z.boolean().default(false),
    // Production: set to true to validate SSL certificates
    sslRejectUnauthorized: z.boolean().default(true),
  }),

  // API Configuration
  api: z.object({
    // Rate limiting
    rateLimit: z.object({
      enabled: z.boolean().default(true),
      windowMs: z.number().default(60_000), // 1 minute
      maxRequests: z.number().default(100), // 100 requests per minute
    }),
    // Cache settings
    cache: z.object({
      priceTtl: z.number().default(60), // 60 seconds
      staleThreshold: z.number().default(120_000), // 2 minutes
    }),
    // Streaming settings
    streaming: z.object({
      idleTimeout: z.number().default(60_000), // 60 seconds
      maxQueueSize: z.number().default(1000),
    }),
  }),

  // Redis
  redis: z.object({
    host: z.string().default('localhost'),
    port: z.number().default(6379),
    password: z.string().optional(),
    db: z.number().default(0),
  }),

  // Exchanges
  exchanges: z.object({
    enabled: z
      .array(z.string())
      .default(['binance', 'kraken', 'coinbase', 'okx', 'bybit', 'kucoin']),
    maxReconnectAttempts: z.number().default(10),
    reconnectBaseDelay: z.number().default(1000),
    maxReconnectDelay: z.number().default(30_000), // 30 seconds max backoff
    tradeFlowTimeout: z.number().default(60_000), // 60 seconds without trades = warn
  }),

  // CBR Rate Service
  cbr: z.object({
    url: z.string().default('https://www.cbr.ru/scripts/XML_daily.asp'),
    cacheTtl: z.number().default(3600), // 1 hour
    retryAttempts: z.number().default(3),
    retryDelay: z.number().default(5000), // 5 seconds
  }),

  // Aggregation
  aggregation: z.object({
    interval: z.number().default(10_000), // 10 seconds
    windowSize: z.number().default(30_000), // 30 seconds
    pairs: z.array(z.string()).default(['btc-usd', 'xmr-usd', 'eth-usd']),
    maxConsecutiveErrors: z.number().default(10),
    errorResetInterval: z.number().default(60_000), // 1 minute
  }),

  // Data retention - auto-cleanup of old data
  retention: z.object({
    enabled: z.boolean().default(true),
    // Keep raw price_history for N days
    priceHistoryDays: z.number().default(7),
    // Keep 5-minute candles for N days
    candles5minDays: z.number().default(30),
    // Keep 1-hour candles for N days
    candles1hourDays: z.number().default(365),
    // Keep daily candles for N days (0 = forever)
    candles1dayDays: z.number().default(0),
    // Cleanup schedule (cron expression)
    cleanupSchedule: z.string().default('0 3 * * *'), // 3 AM daily
  }),

  // Alerts configuration
  alerts: z.object({
    enabled: z.boolean().default(false),
    // Webhook URL for alerts
    webhookUrl: z.string().optional(),
    // Email configuration
    email: z.object({
      enabled: z.boolean().default(false),
      to: z.array(z.string()).default([]),
      from: z.string().default('priceverse@localhost'),
    }),
    // Alert thresholds
    thresholds: z.object({
      // Alert when exchange is disconnected for N seconds
      exchangeDisconnectedSeconds: z.number().default(300), // 5 minutes
      // Alert when aggregation fails N times consecutively
      aggregationFailures: z.number().default(5),
      // Alert when CBR rate is stale for N hours
      cbrRateStaleHours: z.number().default(3),
    }),
  }),

  // Logging
  logging: z.object({
    level: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
      .default('info'),
    pretty: z.boolean().default(false),
  }),

  // Health
  health: z.object({
    enabled: z.boolean().default(true),
    path: z.string().default('/health'),
    timeout: z.number().default(5000),
  }),
});

export type AppConfig = z.infer<typeof configSchema>;
