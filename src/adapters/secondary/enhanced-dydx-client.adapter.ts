import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";
import { DydxClientConfig, createDydxClient } from "./dydx-client.adapter";
import {
  APIQueueManager,
  RequestPriority,
  RequestType,
  DEFAULT_API_QUEUE_CONFIG,
  APIQueueConfig,
} from "../../shared/utils/api-queue/api-queue-manager";
import {
  RateLimiter,
  DYDX_RATE_LIMITER_CONFIG,
  RateLimiterConfig,
} from "../../shared/utils/rate-limiter";
import {
  MarketData,
  Order,
  OrderParams,
} from "../../domain/models/market.model";
import { MarketDataPort } from "../../application/ports/market-data.port";
import { TradingPort } from "../../application/ports/trading.port";

const logger = createContextualLogger("EnhancedDydxClient");

/**
 * Enhanced configuration for dYdX client with queuing options
 */
export interface EnhancedDydxClientConfig extends DydxClientConfig {
  accountAddress?: string;
  queueConfig?: Partial<APIQueueConfig>;
  rateLimiterConfig?: Partial<RateLimiterConfig>;
  enableMonitoring?: boolean;
  monitoringIntervalMs?: number;
}

/**
 * Monitoring data for the enhanced client
 */
export interface ClientMonitoringData {
  queueStats: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    avgExecutionTime: number;
    queuedByPriority: Record<RequestPriority, number>;
    currentThroughput: number;
  };
  rateLimiterStats: {
    totalRequests: number;
    allowedRequests: number;
    blockedRequests: number;
    circuitBreakerActivations: number;
    avgWaitTime: number;
    tokensAvailable?: number;
  };
  apiHealth: {
    isHealthy: boolean;
    lastHealthCheck: number;
    consecutiveErrors: number;
    errorRate: number;
  };
}

/**
 * Enhanced dYdX client with intelligent API queue management
 */
export interface EnhancedDydxClient {
  marketDataPort: MarketDataPort & {
    // Batch operations
    batchGetMarketData(symbols: string[]): Promise<Map<string, MarketData>>;
  };

  tradingPort: TradingPort & {
    // Batch operations
    batchPlaceOrders(orders: OrderParams[]): Promise<Order[]>;
    batchCancelOrders(orderIds: string[]): Promise<boolean[]>;
  };

  // Monitoring methods
  getMonitoringData(): ClientMonitoringData;
  resetStatistics(): void;

  // Queue management
  clearQueues(): void;
  pauseRequests(): void;
  resumeRequests(): void;
}

/**
 * Create an enhanced dYdX client with intelligent queue management
 */
export async function createEnhancedDydxClient(
  config: EnhancedDydxClientConfig,
): Promise<EnhancedDydxClient> {
  logger.info("Creating enhanced dYdX client with intelligent queuing");

  // Create the base client
  const baseClient = await createDydxClient(config);

  // Create rate limiter with enhanced config
  const rateLimiterConfig: RateLimiterConfig = {
    ...DYDX_RATE_LIMITER_CONFIG,
    ...config.rateLimiterConfig,
  };
  const rateLimiter = new RateLimiter(rateLimiterConfig);

  // Create API queue manager
  const queueConfig: APIQueueConfig = {
    ...DEFAULT_API_QUEUE_CONFIG,
    ...config.queueConfig,
  };
  const queueManager = new APIQueueManager(queueConfig, rateLimiter);

  // API health tracking
  let apiHealth = {
    isHealthy: true,
    lastHealthCheck: Date.now(),
    consecutiveErrors: 0,
    errorRate: 0,
    errorHistory: [] as { timestamp: number; error: string }[],
  };

  // Monitoring state
  let isPaused = false;
  let monitoringInterval: NodeJS.Timer | null = null;

  /**
   * Update API health based on request results
   */
  const updateApiHealth = (success: boolean, error?: Error): void => {
    const now = Date.now();

    if (success) {
      apiHealth.consecutiveErrors = 0;
    } else {
      apiHealth.consecutiveErrors++;
      if (error) {
        apiHealth.errorHistory.push({
          timestamp: now,
          error: error.message,
        });
      }
    }

    // Keep only recent errors (last 5 minutes)
    apiHealth.errorHistory = apiHealth.errorHistory.filter(
      (e) => now - e.timestamp < 300000,
    );

    // Calculate error rate
    const recentErrors = apiHealth.errorHistory.filter(
      (e) => now - e.timestamp < 60000,
    );
    apiHealth.errorRate = recentErrors.length / 60; // Errors per second

    // Update health status
    apiHealth.isHealthy =
      apiHealth.consecutiveErrors < 5 && apiHealth.errorRate < 0.5;
    apiHealth.lastHealthCheck = now;
  };

  /**
   * Wrap a function with queue management
   */
  const wrapWithQueue = <T>(
    fn: () => Promise<T>,
    type: RequestType,
    priority: RequestPriority,
    metadata?: Record<string, any>,
  ): Promise<T> => {
    if (isPaused) {
      return Promise.reject(new Error("Client is paused"));
    }

    return queueManager.enqueue(
      type,
      priority,
      async () => {
        try {
          const result = await fn();
          updateApiHealth(true);
          return result;
        } catch (error) {
          updateApiHealth(false, error as Error);
          throw error;
        }
      },
      metadata,
    );
  };

  /**
   * Start monitoring if enabled
   */
  const startMonitoring = (): void => {
    if (!config.enableMonitoring) return;

    const intervalMs = config.monitoringIntervalMs || 30000;
    monitoringInterval = setInterval(() => {
      const monitoringData = getMonitoringData();

      logger.info("API Client Monitoring", {
        queueThroughput: monitoringData.queueStats.currentThroughput,
        rateLimiterTokens: monitoringData.rateLimiterStats.tokensAvailable,
        apiHealthy: monitoringData.apiHealth.isHealthy,
        errorRate: monitoringData.apiHealth.errorRate,
      });

      // Auto-adjust queue config based on performance
      if (monitoringData.apiHealth.errorRate > 0.3) {
        // Slow down if error rate is high
        queueManager["config"].minRequestDelay *= 1.5;
        logger.warn("Increased request delay due to high error rate");
      } else if (monitoringData.apiHealth.errorRate < 0.05) {
        // Speed up if everything is working well
        queueManager["config"].minRequestDelay = Math.max(
          queueManager["config"].minRequestDelay * 0.9,
          100,
        );
      }
    }, intervalMs);
  };

  /**
   * Get monitoring data
   */
  const getMonitoringData = (): ClientMonitoringData => {
    const queueStats = queueManager.getStatistics();
    const rateLimiterStats = rateLimiter.getStats();

    return {
      queueStats,
      rateLimiterStats,
      apiHealth: { ...apiHealth },
    };
  };

  // Start monitoring
  startMonitoring();

  // Create enhanced marketDataPort
  const enhancedMarketDataPort = {
    subscribeToMarketData: (symbol: string) =>
      wrapWithQueue(
        () => baseClient.marketDataPort.subscribeToMarketData(symbol),
        RequestType.MARKET_DATA,
        RequestPriority.NORMAL,
        { symbol },
      ),

    unsubscribeFromMarketData: (symbol: string) =>
      baseClient.marketDataPort.unsubscribeFromMarketData(symbol),

    getLatestMarketData: (symbol: string) =>
      wrapWithQueue(
        () => baseClient.marketDataPort.getLatestMarketData(symbol),
        RequestType.MARKET_DATA,
        RequestPriority.NORMAL,
        { symbol },
      ),

    getHistoricalMarketData: (symbol: string, limit?: number) =>
      wrapWithQueue(
        () => baseClient.marketDataPort.getHistoricalMarketData(symbol, limit),
        RequestType.HISTORICAL_DATA,
        RequestPriority.LOW,
        { symbol, limit },
      ),

    // Batch operations for efficiency
    batchGetMarketData: async (
      symbols: string[],
    ): Promise<Map<string, MarketData>> => {
      logger.info(`Batch fetching market data for ${symbols.length} symbols`);

      const results = new Map<string, MarketData>();
      const errors: Array<{ symbol: string; error: Error }> = [];

      // Process in batches of 5 to avoid overwhelming the API
      const batchSize = 5;
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (symbol) => {
            try {
              const data =
                await enhancedMarketDataPort.getLatestMarketData(symbol);
              if (data) {
                results.set(symbol, data);
              }
            } catch (error) {
              errors.push({ symbol, error: error as Error });
              logger.error(
                `Failed to fetch market data for ${symbol}`,
                error as Error,
              );
            }
          }),
        );

        // Add a small delay between batches
        if (i + batchSize < symbols.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      if (errors.length > 0) {
        logger.warn(`Failed to fetch data for ${errors.length} symbols`);
      }

      return results;
    },
  };

  // Create enhanced tradingPort
  const enhancedTradingPort = {
    placeOrder: (orderParams: OrderParams) =>
      wrapWithQueue(
        () => baseClient.tradingPort.placeOrder(orderParams),
        RequestType.ORDER_PLACEMENT,
        RequestPriority.CRITICAL,
        { orderType: orderParams.type, symbol: orderParams.symbol },
      ),

    cancelOrder: (orderId: string) =>
      wrapWithQueue(
        () => baseClient.tradingPort.cancelOrder(orderId),
        RequestType.ORDER_PLACEMENT,
        RequestPriority.HIGH,
        { orderId },
      ),

    getOrder: (orderId: string) =>
      wrapWithQueue(
        () => baseClient.tradingPort.getOrder(orderId),
        RequestType.ORDER_STATUS,
        RequestPriority.NORMAL,
        { orderId },
      ),

    getOpenOrders: (symbol?: string) =>
      wrapWithQueue(
        () => baseClient.tradingPort.getOpenOrders(symbol),
        RequestType.ORDER_STATUS,
        RequestPriority.NORMAL,
        { symbol },
      ),

    getAccountBalance: () =>
      wrapWithQueue(
        () => baseClient.tradingPort.getAccountBalance(),
        RequestType.ACCOUNT_INFO,
        RequestPriority.NORMAL,
      ),

    // Batch operations
    batchPlaceOrders: async (orders: OrderParams[]): Promise<Order[]> => {
      logger.info(`Batch placing ${orders.length} orders`);
      const results: Order[] = [];

      for (const order of orders) {
        try {
          const placedOrder = await enhancedTradingPort.placeOrder(order);
          results.push(placedOrder);
        } catch (error) {
          logger.error(`Failed to place order`, error as Error);
        }
      }

      return results;
    },

    batchCancelOrders: async (orderIds: string[]): Promise<boolean[]> => {
      logger.info(`Batch canceling ${orderIds.length} orders`);
      const results: boolean[] = [];

      for (const orderId of orderIds) {
        try {
          const cancelled = await enhancedTradingPort.cancelOrder(orderId);
          results.push(cancelled);
        } catch (error) {
          logger.error(`Failed to cancel order ${orderId}`, error as Error);
          results.push(false);
        }
      }

      return results;
    },
  };

  // Create the enhanced client
  const enhancedClient: EnhancedDydxClient = {
    marketDataPort: enhancedMarketDataPort,
    tradingPort: enhancedTradingPort,

    // Monitoring and management methods
    getMonitoringData,

    resetStatistics: () => {
      rateLimiter.resetStats();
      apiHealth = {
        isHealthy: true,
        lastHealthCheck: Date.now(),
        consecutiveErrors: 0,
        errorRate: 0,
        errorHistory: [],
      };
      logger.info("Statistics reset");
    },

    clearQueues: () => {
      queueManager.clearQueues();
      logger.info("Request queues cleared");
    },

    pauseRequests: () => {
      isPaused = true;
      logger.info("Request processing paused");
    },

    resumeRequests: () => {
      isPaused = false;
      logger.info("Request processing resumed");
    },
  };

  logger.info("Enhanced dYdX client created successfully", {
    queueConfig: {
      maxConcurrentRequests: queueConfig.maxConcurrentRequests,
      minRequestDelay: queueConfig.minRequestDelay,
      enableBatching: queueConfig.enableBatching,
      enableAdaptiveRateLimit: queueConfig.enableAdaptiveRateLimit,
    },
    rateLimiterConfig: {
      maxRequests: rateLimiterConfig.maxRequests,
      windowMs: rateLimiterConfig.windowMs,
      enableTokenBucket: rateLimiterConfig.enableTokenBucket,
    },
  });

  return enhancedClient;
}

/**
 * Default configuration for enhanced dYdX client
 */
export const DEFAULT_ENHANCED_DYDX_CONFIG: Partial<EnhancedDydxClientConfig> = {
  queueConfig: {
    maxConcurrentRequests: 3,
    minRequestDelay: 200,
    maxQueueSizePerPriority: 100,
    enableBatching: true,
    batchWindowMs: 500,
    maxBatchSize: 10,
    enableAdaptiveRateLimit: true,
    smoothingFactor: 0.2,
  },
  rateLimiterConfig: {
    maxRequests: 10,
    windowMs: 60000,
    retryDelay: 1000,
    maxRetries: 5,
    backoffMultiplier: 2,
    circuitBreakerThreshold: 3,
    circuitBreakerTimeout: 30000,
    burstSize: 15,
    tokenRefillRate: 0.167,
    enableTokenBucket: true,
    enableDetailedStats: true,
  },
  enableMonitoring: true,
  monitoringIntervalMs: 30000,
};
