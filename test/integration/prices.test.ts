/**
 * Integration tests for Prices Module
 * Tests Prices Service with mocked Redis and Repository
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createPricesService,
  createMockRedis,
  createMockLoggerModule,
  createMockPriceHistoryRepository,
  createMockMetricsService,
  PricesService,
} from './test-helpers.js';

describe('Prices Module Integration Tests', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockLoggerModule: ReturnType<typeof createMockLoggerModule>;
  let mockPriceHistoryRepo: ReturnType<typeof createMockPriceHistoryRepository>;
  let mockMetrics: ReturnType<typeof createMockMetricsService>;
  let pricesService: PricesService;

  beforeEach(() => {
    mockRedis = createMockRedis();
    mockLoggerModule = createMockLoggerModule();
    mockPriceHistoryRepo = createMockPriceHistoryRepository();
    mockMetrics = createMockMetricsService();

    pricesService = createPricesService({
      redis: mockRedis,
      loggerModule: mockLoggerModule,
      priceHistoryRepo: mockPriceHistoryRepo,
      metrics: mockMetrics,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('PricesService', () => {
    it('should get price from cache when available', async () => {
      const mockCachedPrice = JSON.stringify({
        price: '50000.12345678',
        timestamp: Date.now(),
      });

      mockRedis.get.mockResolvedValue(mockCachedPrice);

      const result = await pricesService.getPrice('btc-usd');

      expect(result).toEqual({
        pair: 'btc-usd',
        price: 50000.12345678,
        timestamp: expect.any(Number),
      });

      expect(mockRedis.get).toHaveBeenCalledWith('price:btc-usd');
      expect(mockPriceHistoryRepo.findLatestByPair).not.toHaveBeenCalled();
    });

    it('should fallback to database when cache is empty', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setex.mockResolvedValue('OK');
      mockPriceHistoryRepo.getLatestPrice.mockResolvedValue({
        id: 1,
        pair: 'btc-usd',
        price: '51000.00',
        timestamp: new Date(),
        method: 'vwap',
        sources: ['binance'],
        volume: '10.5',
      });

      const result = await pricesService.getPrice('btc-usd');

      expect(result.pair).toBe('btc-usd');
      expect(result.price).toBe(51000);

      expect(mockRedis.get).toHaveBeenCalled();
      expect(mockPriceHistoryRepo.getLatestPrice).toHaveBeenCalledWith('btc-usd');
    });

    it('should reject stale cached prices', async () => {
      const staleTimestamp = Date.now() - 200000; // 200 seconds ago (> 120s threshold)
      const staleCachedPrice = JSON.stringify({
        price: '50000.00',
        timestamp: staleTimestamp,
      });

      mockRedis.get.mockResolvedValue(staleCachedPrice);
      mockRedis.setex.mockResolvedValue('OK');
      mockPriceHistoryRepo.getLatestPrice.mockResolvedValue({
        id: 1,
        pair: 'btc-usd',
        price: '52000.00',
        timestamp: new Date(),
        method: 'vwap',
        sources: ['binance'],
        volume: '10.5',
      });

      const result = await pricesService.getPrice('btc-usd');

      // Should fetch from DB instead
      expect(mockPriceHistoryRepo.getLatestPrice).toHaveBeenCalled();
      expect(result.price).toBe(52000);
    });

    it('should throw error when price is unavailable', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPriceHistoryRepo.findLatestByPair.mockResolvedValue(null);

      await expect(pricesService.getPrice('btc-usd')).rejects.toThrow(
        'Price unavailable for pair btc-usd'
      );
    });

    it('should get multiple prices in parallel', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ price: '50000.00', timestamp: Date.now() })
      );

      const results = await pricesService.getMultiplePrices(['btc-usd', 'eth-usd', 'xmr-usd']);

      expect(results).toHaveLength(3);
      expect(results[0].pair).toBe('btc-usd');
      expect(results[1].pair).toBe('eth-usd');
      expect(results[2].pair).toBe('xmr-usd');

      // Should call cache for each pair
      expect(mockRedis.get).toHaveBeenCalledTimes(3);
    });

    it('should calculate price change over 24 hours', async () => {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

      mockPriceHistoryRepo.getFirstPriceAfter.mockResolvedValue({
        id: 1,
        pair: 'btc-usd',
        price: '48000.00',
        timestamp: startDate,
        method: 'vwap',
        sources: ['binance'],
        volume: '10.5',
      });

      mockPriceHistoryRepo.getLastPriceBefore.mockResolvedValue({
        id: 2,
        pair: 'btc-usd',
        price: '50000.00',
        timestamp: endDate,
        method: 'vwap',
        sources: ['binance'],
        volume: '10.5',
      });

      const result = await pricesService.getPriceChange('btc-usd', '24hours');

      expect(result).toMatchObject({
        pair: 'btc-usd',
        startPrice: 48000,
        endPrice: 50000,
      });
      expect(result.changePercent).toBeCloseTo(4.167, 1);
    });

    it('should calculate price change over 7 days', async () => {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

      mockPriceHistoryRepo.getFirstPriceAfter.mockResolvedValue({
        id: 1,
        pair: 'btc-usd',
        price: '45000.00',
        timestamp: startDate,
        method: 'vwap',
        sources: ['binance'],
        volume: '10.5',
      });

      mockPriceHistoryRepo.getLastPriceBefore.mockResolvedValue({
        id: 2,
        pair: 'btc-usd',
        price: '50000.00',
        timestamp: endDate,
        method: 'vwap',
        sources: ['binance'],
        volume: '10.5',
      });

      const result = await pricesService.getPriceChange('btc-usd', '7days');

      expect(result.changePercent).toBeCloseTo(11.11, 1);
    });

    it('should throw error for custom period without from parameter', async () => {
      await expect(
        pricesService.getPriceChange('btc-usd', 'custom')
      ).rejects.toThrow('Custom period requires');
    });

    it('should throw error for invalid time range', async () => {
      const from = '2024-12-01T00:00:00Z';
      const to = '2024-11-01T00:00:00Z'; // to is before from

      await expect(
        pricesService.getPriceChange('btc-usd', 'custom', from, to)
      ).rejects.toThrow('Start date must be before end date');
    });

    it('should throw error when no price data available', async () => {
      mockPriceHistoryRepo.getFirstPriceAfter.mockResolvedValue(null);
      mockPriceHistoryRepo.getLastPriceBefore.mockResolvedValue(null);

      await expect(
        pricesService.getPriceChange('btc-usd', '24hours')
      ).rejects.toThrow('No price data');
    });

    it('should handle concurrent price requests efficiently', async () => {
      // Setup proper cache response
      const cachedPrice = JSON.stringify({ price: '50000.00', timestamp: Date.now() });
      mockRedis.get.mockResolvedValue(cachedPrice);

      // Make 10 concurrent requests
      const requests = Array(10)
        .fill(null)
        .map(() => pricesService.getPrice('btc-usd'));

      const results = await Promise.all(requests);

      expect(results).toHaveLength(10);
      results.forEach((r) => expect(r.price).toBe(50000));
    });

    it('should handle price with very high precision', async () => {
      const timestamp = Date.now();
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          price: '0.00000001',
          timestamp,
        })
      );

      const result = await pricesService.getPrice('btc-usd');

      expect(result.price).toBe(0.00000001);
      expect(result.timestamp).toBe(timestamp);
    });

    it('should handle very large price values', async () => {
      const timestamp = Date.now();
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          price: '999999999.99999999',
          timestamp,
        })
      );

      const result = await pricesService.getPrice('btc-usd');

      expect(result.price).toBeCloseTo(999999999.99999999, 2);
    });
  });

  describe('Module Integration', () => {
    it('should wire services correctly', () => {
      expect(pricesService).toBeDefined();
      expect(typeof pricesService.getPrice).toBe('function');
      expect(typeof pricesService.getPriceChange).toBe('function');
      expect(typeof pricesService.getMultiplePrices).toBe('function');
    });

    it('should use injected dependencies', async () => {
      const timestamp = Date.now();
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ price: '50000.00', timestamp })
      );

      const result = await pricesService.getPrice('btc-usd');

      // Verify result
      expect(result.price).toBe(50000);

      // Verify dependencies are used
      expect(mockRedis.get).toHaveBeenCalledWith('price:btc-usd');
      expect(mockLoggerModule.logger.debug).toHaveBeenCalled();
    });
  });
});
