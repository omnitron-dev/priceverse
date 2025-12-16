/**
 * Unit Tests - OHLCV Aggregator Service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OhlcvAggregatorService } from '../../../src/modules/aggregator/services/ohlcv-aggregator.service.js';

// Mock dependencies
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockLoggerModule = { logger: mockLogger };

const mockOhlcvRepo = {
  getCandles: vi.fn(),
  getCandlesWithCursor: vi.fn(),
  getLatestCandle: vi.fn(),
  getCandleCount: vi.fn(),
  getAggregateStats: vi.fn(),
  getOpenClosePrice: vi.fn(),
  upsertCandle: vi.fn(),
  deleteOlderThan: vi.fn(),
};

describe('OhlcvAggregatorService', () => {
  let service: OhlcvAggregatorService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OhlcvAggregatorService(mockLoggerModule as any, mockOhlcvRepo as any);
  });

  describe('floorToInterval', () => {
    it('should floor date to 5-minute interval', () => {
      const date = new Date('2024-01-01T12:07:30Z');
      const result = (service as any).floorToInterval(date, 5 * 60 * 1000);

      expect(result.toISOString()).toBe('2024-01-01T12:05:00.000Z');
    });

    it('should floor date to 1-hour interval', () => {
      const date = new Date('2024-01-01T12:45:30Z');
      const result = (service as any).floorToInterval(date, 60 * 60 * 1000);

      expect(result.toISOString()).toBe('2024-01-01T12:00:00.000Z');
    });

    it('should handle exact interval boundaries', () => {
      const date = new Date('2024-01-01T12:00:00Z');
      const result = (service as any).floorToInterval(date, 60 * 60 * 1000);

      expect(result.toISOString()).toBe('2024-01-01T12:00:00.000Z');
    });
  });

  describe('calculateOhlcv', () => {
    it('should calculate OHLCV from price history', async () => {
      const periodStart = new Date('2024-01-01T12:00:00Z');
      const periodEnd = new Date('2024-01-01T12:05:00Z');

      mockOhlcvRepo.getAggregateStats.mockResolvedValue({
        low: '44000.00000000',
        high: '46000.00000000',
        tradeCount: 10,
        priceVolumeSum: '448000.00000000',
        volumeSum: '10.00000000',
      });

      mockOhlcvRepo.getOpenClosePrice.mockResolvedValue({
        open: '44500.00000000',
        close: '45500.00000000',
      });

      const result = await (service as any).calculateOhlcv(
        'btc-usd',
        periodStart,
        periodEnd
      );

      expect(result).toBeDefined();
      expect(result.pair).toBe('btc-usd');
      expect(result.open).toBe('44500.00000000');
      expect(result.high).toBe('46000.00000000');
      expect(result.low).toBe('44000.00000000');
      expect(result.close).toBe('45500.00000000');
      expect(parseFloat(result.volume)).toBe(10);
      expect(result.vwap).toBe('44800.00000000');
      expect(result.tradeCount).toBe(10);
    });

    it('should return null when no trades in period', async () => {
      const periodStart = new Date('2024-01-01T12:00:00Z');
      const periodEnd = new Date('2024-01-01T12:05:00Z');

      mockOhlcvRepo.getAggregateStats.mockResolvedValue({
        tradeCount: 0,
      });

      const result = await (service as any).calculateOhlcv(
        'btc-usd',
        periodStart,
        periodEnd
      );

      expect(result).toBeNull();
    });

    it('should return null when no aggregate stats', async () => {
      const periodStart = new Date('2024-01-01T12:00:00Z');
      const periodEnd = new Date('2024-01-01T12:05:00Z');

      mockOhlcvRepo.getAggregateStats.mockResolvedValue(null);

      const result = await (service as any).calculateOhlcv(
        'btc-usd',
        periodStart,
        periodEnd
      );

      expect(result).toBeNull();
    });

    it('should return null when no open/close prices', async () => {
      const periodStart = new Date('2024-01-01T12:00:00Z');
      const periodEnd = new Date('2024-01-01T12:05:00Z');

      mockOhlcvRepo.getAggregateStats.mockResolvedValue({
        low: '44000.00000000',
        high: '46000.00000000',
        tradeCount: 10,
        priceVolumeSum: '448000.00000000',
        volumeSum: '10.00000000',
      });

      mockOhlcvRepo.getOpenClosePrice.mockResolvedValue(null);

      const result = await (service as any).calculateOhlcv(
        'btc-usd',
        periodStart,
        periodEnd
      );

      expect(result).toBeNull();
    });

    it('should calculate VWAP correctly', async () => {
      const periodStart = new Date('2024-01-01T12:00:00Z');
      const periodEnd = new Date('2024-01-01T12:05:00Z');

      mockOhlcvRepo.getAggregateStats.mockResolvedValue({
        low: '100.00000000',
        high: '100.00000000',
        tradeCount: 3,
        priceVolumeSum: '250.00000000', // 100*1 + 100*1.5 = 250
        volumeSum: '2.50000000', // 1 + 1.5 = 2.5
      });

      mockOhlcvRepo.getOpenClosePrice.mockResolvedValue({
        open: '100.00000000',
        close: '100.00000000',
      });

      const result = await (service as any).calculateOhlcv(
        'btc-usd',
        periodStart,
        periodEnd
      );

      expect(result.vwap).toBe('100.00000000');
    });

    it('should handle null VWAP when volume is zero', async () => {
      const periodStart = new Date('2024-01-01T12:00:00Z');
      const periodEnd = new Date('2024-01-01T12:05:00Z');

      mockOhlcvRepo.getAggregateStats.mockResolvedValue({
        low: '100.00000000',
        high: '100.00000000',
        tradeCount: 1,
        priceVolumeSum: null,
        volumeSum: '0',
      });

      mockOhlcvRepo.getOpenClosePrice.mockResolvedValue({
        open: '100.00000000',
        close: '100.00000000',
      });

      const result = await (service as any).calculateOhlcv(
        'btc-usd',
        periodStart,
        periodEnd
      );

      expect(result.vwap).toBeNull();
    });
  });

  describe('saveCandle', () => {
    it('should call upsertCandle on repository', async () => {
      const candle = {
        pair: 'btc-usd',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        open: '44000.00000000',
        high: '46000.00000000',
        low: '43500.00000000',
        close: '45000.00000000',
        volume: '10.00000000',
        vwap: '44800.00000000',
        tradeCount: 10,
      };

      mockOhlcvRepo.upsertCandle.mockResolvedValue(undefined);

      await (service as any).saveCandle('5min', candle);

      expect(mockOhlcvRepo.upsertCandle).toHaveBeenCalledWith('5min', {
        pair: 'btc-usd',
        timestamp: candle.timestamp,
        open: '44000.00000000',
        high: '46000.00000000',
        low: '43500.00000000',
        close: '45000.00000000',
        volume: '10.00000000',
        vwap: '44800.00000000',
        trade_count: 10,
      });
    });
  });

  describe('getCandles', () => {
    it('should return candles with pagination', async () => {
      const mockCandles = [
        {
          timestamp: new Date('2024-01-01T12:00:00Z'),
          open: '44000.00000000',
          high: '46000.00000000',
          low: '43500.00000000',
          close: '45000.00000000',
          volume: '10.00000000',
          vwap: '44800.00000000',
        },
      ];

      mockOhlcvRepo.getCandles.mockResolvedValue({
        candles: mockCandles,
        total: 100,
      });

      const result = await service.getCandles('btc-usd', '1hour', 10, 0);

      expect(result.total).toBe(100);
      expect(result.candles).toHaveLength(1);
      expect(result.candles[0].open).toBe(44000);
      expect(result.candles[0].high).toBe(46000);
      expect(result.candles[0].vwap).toBe(44800);
      expect(mockOhlcvRepo.getCandles).toHaveBeenCalledWith('1hour', 'btc-usd', 10, 0);
    });

    it('should handle null VWAP in results', async () => {
      const mockCandles = [
        {
          timestamp: new Date('2024-01-01T12:00:00Z'),
          open: '44000.00000000',
          high: '46000.00000000',
          low: '43500.00000000',
          close: '45000.00000000',
          volume: '10.00000000',
          vwap: null,
        },
      ];

      mockOhlcvRepo.getCandles.mockResolvedValue({
        candles: mockCandles,
        total: 1,
      });

      const result = await service.getCandles('btc-usd', '1hour', 10, 0);

      expect(result.candles[0].vwap).toBeNull();
    });

    it('should return empty result when no candles', async () => {
      mockOhlcvRepo.getCandles.mockResolvedValue({
        candles: [],
        total: 0,
      });

      const result = await service.getCandles('btc-usd', '1hour', 10, 0);

      expect(result.total).toBe(0);
      expect(result.candles).toHaveLength(0);
    });
  });

  describe('getCandlesWithCursor', () => {
    it('should return candles with cursor pagination', async () => {
      const mockCandles = [
        {
          timestamp: new Date('2024-01-01T12:00:00Z'),
          open: '44000.00000000',
          high: '46000.00000000',
          low: '43500.00000000',
          close: '45000.00000000',
          volume: '10.00000000',
          vwap: '44800.00000000',
        },
      ];

      mockOhlcvRepo.getCandlesWithCursor.mockResolvedValue({
        candles: mockCandles,
        nextCursor: 'next123',
        previousCursor: null,
        hasMore: true,
      });

      const result = await service.getCandlesWithCursor('btc-usd', '5min', { limit: 10 });

      expect(result.candles).toHaveLength(1);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe('next123');
      expect(mockOhlcvRepo.getCandlesWithCursor).toHaveBeenCalledWith('5min', {
        pair: 'btc-usd',
        limit: 10,
        cursor: undefined,
        from: undefined,
        to: undefined,
        orderBy: 'desc',
      });
    });

    it('should pass cursor when provided', async () => {
      mockOhlcvRepo.getCandlesWithCursor.mockResolvedValue({
        candles: [],
        nextCursor: null,
        previousCursor: 'prev123',
        hasMore: false,
      });

      await service.getCandlesWithCursor('btc-usd', '5min', {
        limit: 50,
        cursor: 'abc123',
      });

      expect(mockOhlcvRepo.getCandlesWithCursor).toHaveBeenCalledWith('5min', {
        pair: 'btc-usd',
        limit: 50,
        cursor: 'abc123',
        from: undefined,
        to: undefined,
        orderBy: 'desc',
      });
    });

    it('should pass date range when provided', async () => {
      const from = new Date('2024-12-01T00:00:00Z');
      const to = new Date('2024-12-14T00:00:00Z');

      mockOhlcvRepo.getCandlesWithCursor.mockResolvedValue({
        candles: [],
        nextCursor: null,
        previousCursor: null,
        hasMore: false,
      });

      await service.getCandlesWithCursor('btc-usd', '1day', {
        limit: 100,
        from,
        to,
      });

      expect(mockOhlcvRepo.getCandlesWithCursor).toHaveBeenCalledWith('1day', {
        pair: 'btc-usd',
        limit: 100,
        cursor: undefined,
        from,
        to,
        orderBy: 'desc',
      });
    });
  });

  describe('getLatestCandle', () => {
    it('should return latest candle from repository', async () => {
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

      const result = await service.getLatestCandle('btc-usd', '5min');

      expect(result).toBe(mockCandle);
      expect(mockOhlcvRepo.getLatestCandle).toHaveBeenCalledWith('5min', 'btc-usd');
    });

    it('should return null when no candle found', async () => {
      mockOhlcvRepo.getLatestCandle.mockResolvedValue(null);

      const result = await service.getLatestCandle('btc-usd', '5min');

      expect(result).toBeNull();
    });
  });

  describe('getCandleCount', () => {
    it('should return candle count from repository', async () => {
      mockOhlcvRepo.getCandleCount.mockResolvedValue(500);

      const result = await service.getCandleCount('btc-usd', '1hour');

      expect(result).toBe(500);
      expect(mockOhlcvRepo.getCandleCount).toHaveBeenCalledWith('1hour', 'btc-usd');
    });
  });

  describe('cleanupOldCandles', () => {
    it('should call deleteOlderThan on repository', async () => {
      mockOhlcvRepo.deleteOlderThan.mockResolvedValue(150);

      const result = await service.cleanupOldCandles('5min', 30);

      expect(result).toBe(150);
      expect(mockOhlcvRepo.deleteOlderThan).toHaveBeenCalledWith(
        '5min',
        expect.any(Date)
      );
    });
  });
});
