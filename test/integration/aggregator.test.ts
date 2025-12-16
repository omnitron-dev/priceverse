/**
 * Integration tests for Aggregator Module
 * Tests OHLCV Aggregator Service with mocked dependencies
 *
 * Note: StreamAggregatorService was removed in v2.0.0 refactoring.
 * Stream aggregation is now handled by PM process (see processes/aggregators/).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createOhlcvAggregatorService,
  createMockLoggerModule,
  createMockOhlcvRepository,
  OhlcvAggregatorService,
} from './test-helpers.js';

describe('Aggregator Module Integration Tests', () => {
  let mockLoggerModule: ReturnType<typeof createMockLoggerModule>;
  let mockOhlcvRepo: ReturnType<typeof createMockOhlcvRepository>;
  let ohlcvService: OhlcvAggregatorService;

  beforeEach(() => {
    mockLoggerModule = createMockLoggerModule();
    mockOhlcvRepo = createMockOhlcvRepository();

    ohlcvService = createOhlcvAggregatorService({
      loggerModule: mockLoggerModule,
      ohlcvRepo: mockOhlcvRepo,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('OHLCV Aggregator Service', () => {
    it('should get candles with pagination', async () => {
      const mockCandles = [
        {
          id: 1,
          pair: 'btc-usd',
          timestamp: new Date(),
          open: '50000',
          high: '51000',
          low: '49000',
          close: '50500',
          volume: '100',
          vwap: '50250',
          trade_count: 1000,
        },
      ];

      mockOhlcvRepo.getCandles.mockResolvedValue({
        candles: mockCandles,
        total: 100,
      });

      const result = await ohlcvService.getCandles('btc-usd', '5min', 10, 0);

      expect(result.candles).toHaveLength(1);
      expect(result.total).toBe(100);
      expect(mockOhlcvRepo.getCandles).toHaveBeenCalledWith('5min', 'btc-usd', 10, 0);
    });

    it('should get candles with cursor pagination', async () => {
      const mockCandles = [
        {
          id: 1,
          pair: 'btc-usd',
          timestamp: new Date(),
          open: '50000',
          high: '51000',
          low: '49000',
          close: '50500',
          volume: '100',
          vwap: '50250',
          trade_count: 1000,
        },
      ];

      mockOhlcvRepo.getCandlesWithCursor.mockResolvedValue({
        candles: mockCandles,
        nextCursor: 'next123',
        previousCursor: null,
        hasMore: true,
      });

      const result = await ohlcvService.getCandlesWithCursor('btc-usd', '5min', {
        limit: 10,
      });

      expect(result.candles).toHaveLength(1);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe('next123');
    });

    it('should get latest candle', async () => {
      const mockCandle = {
        id: 1,
        pair: 'btc-usd',
        timestamp: new Date(),
        open: '50000',
        high: '51000',
        low: '49000',
        close: '50500',
        volume: '100',
        vwap: '50250',
        trade_count: 1000,
      };

      mockOhlcvRepo.getLatestCandle.mockResolvedValue(mockCandle);

      const result = await ohlcvService.getLatestCandle('btc-usd', '5min');

      expect(result).toBeDefined();
      expect(result!.close).toBe('50500');
      expect(mockOhlcvRepo.getLatestCandle).toHaveBeenCalledWith('5min', 'btc-usd');
    });

    it('should return null for missing latest candle', async () => {
      mockOhlcvRepo.getLatestCandle.mockResolvedValue(null);

      const result = await ohlcvService.getLatestCandle('btc-usd', '5min');

      expect(result).toBeNull();
    });

    it('should get candle count', async () => {
      mockOhlcvRepo.getCandleCount.mockResolvedValue(500);

      const result = await ohlcvService.getCandleCount('btc-usd', '1hour');

      expect(result).toBe(500);
      expect(mockOhlcvRepo.getCandleCount).toHaveBeenCalledWith('1hour', 'btc-usd');
    });

    it('should handle empty candle data', async () => {
      mockOhlcvRepo.getCandles.mockResolvedValue({
        candles: [],
        total: 0,
      });

      const result = await ohlcvService.getCandles('btc-usd', '5min', 10, 0);

      expect(result.candles).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should support all intervals', async () => {
      mockOhlcvRepo.getCandles.mockResolvedValue({
        candles: [],
        total: 0,
      });

      const intervals: Array<'5min' | '1hour' | '1day'> = ['5min', '1hour', '1day'];

      for (const interval of intervals) {
        await ohlcvService.getCandles('btc-usd', interval, 10, 0);
        expect(mockOhlcvRepo.getCandles).toHaveBeenCalledWith(interval, 'btc-usd', 10, 0);
      }
    });

    it('should support all trading pairs', async () => {
      mockOhlcvRepo.getCandles.mockResolvedValue({
        candles: [],
        total: 0,
      });

      const pairs = ['btc-usd', 'eth-usd', 'xmr-usd', 'btc-rub', 'eth-rub', 'xmr-rub'];

      for (const pair of pairs) {
        await ohlcvService.getCandles(pair as any, '5min', 10, 0);
        expect(mockOhlcvRepo.getCandles).toHaveBeenCalledWith('5min', pair, 10, 0);
      }
    });

    it('should handle cursor pagination with from/to dates', async () => {
      const from = new Date('2024-12-01T00:00:00Z');
      const to = new Date('2024-12-14T00:00:00Z');

      mockOhlcvRepo.getCandlesWithCursor.mockResolvedValue({
        candles: [],
        nextCursor: null,
        previousCursor: null,
        hasMore: false,
      });

      await ohlcvService.getCandlesWithCursor('btc-usd', '1day', {
        limit: 100,
        from,
        to,
      });

      // Verify called with correct interval and options object containing our params
      expect(mockOhlcvRepo.getCandlesWithCursor).toHaveBeenCalledWith(
        '1day',
        expect.objectContaining({
          from,
          to,
          limit: 100,
          pair: 'btc-usd',
        })
      );
    });

    it('should handle cursor pagination with cursor', async () => {
      const cursor = 'abc123';

      mockOhlcvRepo.getCandlesWithCursor.mockResolvedValue({
        candles: [],
        nextCursor: null,
        previousCursor: 'prev123',
        hasMore: false,
      });

      const result = await ohlcvService.getCandlesWithCursor('btc-usd', '5min', {
        limit: 50,
        cursor,
      });

      expect(result.previousCursor).toBe('prev123');
      // Verify called with correct interval and options object
      expect(mockOhlcvRepo.getCandlesWithCursor).toHaveBeenCalledWith(
        '5min',
        expect.objectContaining({
          cursor,
          limit: 50,
          pair: 'btc-usd',
        })
      );
    });
  });

  describe('Module Integration', () => {
    it('should wire services correctly', () => {
      expect(ohlcvService).toBeDefined();
      expect(typeof ohlcvService.getCandles).toBe('function');
      expect(typeof ohlcvService.getCandlesWithCursor).toBe('function');
      expect(typeof ohlcvService.getLatestCandle).toBe('function');
      expect(typeof ohlcvService.getCandleCount).toBe('function');
    });

    it('should use injected dependencies', async () => {
      mockOhlcvRepo.getCandles.mockResolvedValue({
        candles: [],
        total: 0,
      });

      await ohlcvService.getCandles('btc-usd', '5min', 10, 0);

      expect(mockOhlcvRepo.getCandles).toHaveBeenCalled();
    });
  });
});
