/**
 * Integration tests for Charts Module
 * Tests Charts Service with mocked OHLCV Aggregator
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createChartsService,
  createMockOhlcvAggregator,
  createMockLoggerModule,
  ChartsService,
} from './test-helpers.js';

describe('Charts Module Integration Tests', () => {
  let mockOhlcvAggregator: ReturnType<typeof createMockOhlcvAggregator>;
  let mockLoggerModule: ReturnType<typeof createMockLoggerModule>;
  let chartsService: ChartsService;

  beforeEach(() => {
    mockOhlcvAggregator = createMockOhlcvAggregator();
    mockLoggerModule = createMockLoggerModule();

    chartsService = createChartsService({
      ohlcvAggregator: mockOhlcvAggregator,
      loggerModule: mockLoggerModule,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('ChartsService', () => {
    it('should get chart data for 24 hours period with 5min interval', async () => {
      const now = new Date();
      const timestamp1 = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago
      const timestamp2 = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1 hour ago

      const mockCandles = [
        {
          timestamp: timestamp1.toISOString(),
          open: '49000',
          high: '51000',
          low: '48500',
          close: '50000',
          volume: '10.5',
          vwap: '49750',
        },
        {
          timestamp: timestamp2.toISOString(),
          open: '50000',
          high: '51500',
          low: '49800',
          close: '51000',
          volume: '8.2',
          vwap: '50500',
        },
      ];

      mockOhlcvAggregator.getCandlesWithCursor.mockResolvedValue({
        candles: mockCandles,
        nextCursor: null,
        previousCursor: null,
        hasMore: false,
      });

      const result = await chartsService.getChartData('btc-usd', '24hours', '5min');

      expect(result.dates).toHaveLength(2);
      expect(result.series).toHaveLength(2);
      expect(result.ohlcv).toBeDefined();
      expect(result.ohlcv!.open).toEqual([49000, 50000]);
      expect(result.ohlcv!.high).toEqual([51000, 51500]);
      expect(result.ohlcv!.low).toEqual([48500, 49800]);
      expect(result.ohlcv!.close).toEqual([50000, 51000]);
      expect(result.ohlcv!.volume).toEqual([10.5, 8.2]);

      // Series should contain close prices
      expect(result.series).toEqual([50000, 51000]);

      expect(mockOhlcvAggregator.getCandlesWithCursor).toHaveBeenCalledWith(
        'btc-usd',
        '5min',
        expect.objectContaining({
          limit: 1000,
        })
      );
    });

    it('should get chart data for 7 days period with 1hour interval', async () => {
      const now = new Date();
      const timestamp1 = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 2 days ago
      const timestamp2 = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago

      const mockCandles = [
        {
          timestamp: timestamp1.toISOString(),
          open: '45000',
          high: '46000',
          low: '44500',
          close: '45800',
          volume: '120.5',
          vwap: '45500',
        },
        {
          timestamp: timestamp2.toISOString(),
          open: '45800',
          high: '47000',
          low: '45500',
          close: '46500',
          volume: '95.3',
          vwap: '46200',
        },
      ];

      mockOhlcvAggregator.getCandlesWithCursor.mockResolvedValue({
        candles: mockCandles,
        nextCursor: null,
        previousCursor: null,
        hasMore: false,
      });

      const result = await chartsService.getChartData('btc-usd', '7days', '1hour');

      expect(result.dates).toHaveLength(2);
      expect(result.series).toEqual([45800, 46500]);
    });

    it('should get chart data for 30 days period with 1day interval', async () => {
      const now = new Date();
      const timestamp1 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000); // 14 days ago
      const timestamp2 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

      const mockCandles = [
        {
          timestamp: timestamp1.toISOString(),
          open: '40000',
          high: '42000',
          low: '39500',
          close: '41000',
          volume: '500.5',
          vwap: '40500',
        },
        {
          timestamp: timestamp2.toISOString(),
          open: '41000',
          high: '45000',
          low: '40500',
          close: '44000',
          volume: '450.3',
          vwap: '42500',
        },
      ];

      mockOhlcvAggregator.getCandlesWithCursor.mockResolvedValue({
        candles: mockCandles,
        nextCursor: null,
        previousCursor: null,
        hasMore: false,
      });

      const result = await chartsService.getChartData('btc-usd', '30days', '1day');

      expect(result.dates).toHaveLength(2);
      expect(result.series).toEqual([41000, 44000]);
    });

    it('should handle custom period with explicit dates', async () => {
      const from = '2024-11-01T00:00:00Z';
      const to = '2024-12-01T00:00:00Z';

      const mockCandles = [
        {
          timestamp: '2024-11-15T00:00:00Z',
          open: '45000',
          high: '47000',
          low: '44000',
          close: '46000',
          volume: '100',
          vwap: '45500',
        },
      ];

      mockOhlcvAggregator.getCandlesWithCursor.mockResolvedValue({
        candles: mockCandles,
        nextCursor: null,
        previousCursor: null,
        hasMore: false,
      });

      const result = await chartsService.getChartData('btc-usd', 'custom', '1day', from, to);

      expect(result.dates).toHaveLength(1);
      expect(result.series).toEqual([46000]);
    });

    it('should handle empty candle data', async () => {
      mockOhlcvAggregator.getCandlesWithCursor.mockResolvedValue({
        candles: [],
        nextCursor: null,
        previousCursor: null,
        hasMore: false,
      });

      const result = await chartsService.getChartData('btc-usd', '24hours', '5min');

      expect(result.dates).toHaveLength(0);
      expect(result.series).toHaveLength(0);
      expect(result.ohlcv!.open).toHaveLength(0);
    });

    it('should sort candles by timestamp ascending', async () => {
      const now = new Date();
      const timestamp1 = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1 hour ago (newer)
      const timestamp2 = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago (older)

      // Provide candles in wrong order
      const mockCandles = [
        {
          timestamp: timestamp1.toISOString(), // newer first
          open: '50000',
          high: '51000',
          low: '49000',
          close: '50500',
          volume: '10',
          vwap: '50000',
        },
        {
          timestamp: timestamp2.toISOString(), // older second
          open: '49000',
          high: '50000',
          low: '48000',
          close: '49500',
          volume: '12',
          vwap: '49000',
        },
      ];

      mockOhlcvAggregator.getCandlesWithCursor.mockResolvedValue({
        candles: mockCandles,
        nextCursor: null,
        previousCursor: null,
        hasMore: false,
      });

      const result = await chartsService.getChartData('btc-usd', '24hours', '5min');

      // Should be sorted oldest first
      expect(result.series[0]).toBe(49500); // older candle's close
      expect(result.series[1]).toBe(50500); // newer candle's close
    });

    it('should get OHLCV data with pagination', async () => {
      const mockCandles = [
        {
          timestamp: new Date().toISOString(),
          open: '50000',
          high: '51000',
          low: '49000',
          close: '50500',
          volume: '10',
          vwap: '50000',
        },
      ];

      mockOhlcvAggregator.getCandles.mockResolvedValue({
        candles: mockCandles,
        total: 100,
      });

      const result = await chartsService.getOhlcv('btc-usd', '5min', 10, 0);

      expect(result.candles).toHaveLength(1);
      expect(result.pagination.total).toBe(100);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.offset).toBe(0);

      expect(mockOhlcvAggregator.getCandles).toHaveBeenCalledWith('btc-usd', '5min', 10, 0);
    });

    it('should handle pagination with offset', async () => {
      mockOhlcvAggregator.getCandles.mockResolvedValue({
        candles: [],
        total: 100,
      });

      const result = await chartsService.getOhlcv('btc-usd', '1hour', 10, 50);

      expect(result.pagination.offset).toBe(50);
      expect(mockOhlcvAggregator.getCandles).toHaveBeenCalledWith('btc-usd', '1hour', 10, 50);
    });

    it('should support different trading pairs', async () => {
      mockOhlcvAggregator.getCandlesWithCursor.mockResolvedValue({
        candles: [
          {
            timestamp: new Date().toISOString(),
            open: '2000',
            high: '2100',
            low: '1950',
            close: '2050',
            volume: '500',
            vwap: '2025',
          },
        ],
        nextCursor: null,
        previousCursor: null,
        hasMore: false,
      });

      const result = await chartsService.getChartData('eth-usd', '24hours', '5min');

      expect(result.series).toEqual([2050]);
      expect(mockOhlcvAggregator.getCandlesWithCursor).toHaveBeenCalledWith(
        'eth-usd',
        '5min',
        expect.any(Object)
      );
    });

    it('should support all chart intervals', async () => {
      mockOhlcvAggregator.getCandles.mockResolvedValue({
        candles: [],
        total: 0,
      });

      const intervals: Array<'5min' | '1hour' | '1day'> = ['5min', '1hour', '1day'];

      for (const interval of intervals) {
        await chartsService.getOhlcv('btc-usd', interval, 10, 0);
        expect(mockOhlcvAggregator.getCandles).toHaveBeenCalledWith('btc-usd', interval, 10, 0);
      }
    });

    it('should handle candles with null VWAP', async () => {
      mockOhlcvAggregator.getCandlesWithCursor.mockResolvedValue({
        candles: [
          {
            timestamp: new Date().toISOString(),
            open: '50000',
            high: '51000',
            low: '49000',
            close: '50500',
            volume: '10',
            vwap: null,
          },
        ],
        nextCursor: null,
        previousCursor: null,
        hasMore: false,
      });

      const result = await chartsService.getChartData('btc-usd', '24hours', '5min');

      expect(result.series).toEqual([50500]);
    });

    it('should throw error for custom period without from parameter', async () => {
      await expect(
        chartsService.getChartData('btc-usd', 'custom', '5min')
      ).rejects.toThrow('Custom period requires');
    });

    it('should throw error for invalid time range', async () => {
      const from = '2024-12-01T00:00:00Z';
      const to = '2024-11-01T00:00:00Z'; // to is before from

      await expect(
        chartsService.getChartData('btc-usd', 'custom', '5min', from, to)
      ).rejects.toThrow('Start date must be before end date');
    });
  });

  describe('Module Integration', () => {
    it('should wire services correctly', () => {
      expect(chartsService).toBeDefined();
      expect(typeof chartsService.getChartData).toBe('function');
      expect(typeof chartsService.getOhlcv).toBe('function');
    });

    it('should inject OHLCV Aggregator dependency', async () => {
      mockOhlcvAggregator.getCandlesWithCursor.mockResolvedValue({
        candles: [],
        nextCursor: null,
        previousCursor: null,
        hasMore: false,
      });

      await chartsService.getChartData('btc-usd', '24hours', '5min');

      expect(mockOhlcvAggregator.getCandlesWithCursor).toHaveBeenCalled();
      expect(mockLoggerModule.logger.debug).toHaveBeenCalled();
    });
  });
});
