import { createContextualLogger } from "../infrastructure/logging/enhanced-logger";
import {
  createEnhancedDydxClient,
  EnhancedDydxClient,
  DEFAULT_ENHANCED_DYDX_CONFIG,
} from "../adapters/secondary/enhanced-dydx-client.adapter";
import { OrderSignal } from "../domain/trading.types";
import { Network } from "@dydxprotocol/v4-client-js";

const logger = createContextualLogger("EnhancedClientExample");

/**
 * Example usage of the Enhanced dYdX Client with intelligent API queue management
 */
async function main() {
  logger.info("Starting Enhanced dYdX Client Example");

  // Create the enhanced client with custom configuration
  const client = await createEnhancedDydxClient({
    network: Network.testnet(),
    accountAddress: process.env.DYDX_ADDRESS || "",
    mnemonic: process.env.DYDX_MNEMONIC || "",
    ...DEFAULT_ENHANCED_DYDX_CONFIG,
    queueConfig: {
      ...DEFAULT_ENHANCED_DYDX_CONFIG.queueConfig,
      maxConcurrentRequests: 5, // Allow more concurrent requests for this example
      minRequestDelay: 100, // Start with 100ms delay
    },
  });

  try {
    // Connect to the network
    await client.connect();
    logger.info("Connected to dYdX network");

    // Example 1: Subscribe to multiple markets
    logger.info("=== Example 1: Subscribing to multiple markets ===");
    const markets = ["BTC-USD", "ETH-USD", "SOL-USD", "AVAX-USD", "MATIC-USD"];

    // This will be smoothly distributed by the queue manager
    await Promise.all(
      markets.map(symbol => client.subscribeToMarket(symbol))
    );
    logger.info("Subscribed to all markets");

    // Example 2: Batch fetch market data
    logger.info("=== Example 2: Batch fetching market data ===");
    const marketData = await client.batchGetMarketData(markets);

    marketData.forEach((data, symbol) => {
      logger.info(`Market data for ${symbol}:`, {
        price: data.price,
        volume24h: data.volume24h,
        change24h: data.priceChange24h,
      });
    });

    // Example 3: Simulate high-frequency data requests
    logger.info("=== Example 3: High-frequency data requests ===");
    const requests = [];

    // Generate 20 rapid requests
    for (let i = 0; i < 20; i++) {
      const symbol = markets[i % markets.length];
      requests.push(
        client.getLatestMarketData(symbol).then(data => ({
          symbol,
          price: data.price,
          timestamp: Date.now(),
        }))
      );
    }

    // The queue manager will smooth these out automatically
    const results = await Promise.all(requests);
    logger.info(`Completed ${results.length} rapid requests without hitting rate limits`);

    // Example 4: Mixed priority operations
    logger.info("=== Example 4: Mixed priority operations ===");

    // Critical: Place an order (highest priority)
    const orderSignal: OrderSignal = {
      symbol: "BTC-USD",
      type: "LIMIT",
      side: "BUY",
      size: 0.001,
      price: 40000,
      timestamp: Date.now(),
      confidence: 0.95,
    };

    // These will be executed based on priority
    const mixedOps = Promise.all([
      // Critical operation
      client.placeOrder(orderSignal).catch(err =>
        logger.error("Order placement failed", err)
      ),

      // High priority: Get positions
      client.getPositions(),

      // Normal priority: Get market data
      client.getLatestMarketData("BTC-USD"),

      // Low priority: Get historical data
      client.getHistoricalMarketData("ETH-USD", 100),
    ]);

    await mixedOps;
    logger.info("Completed mixed priority operations");

    // Example 5: Monitor client performance
    logger.info("=== Example 5: Client monitoring ===");
    const monitoringData = client.getMonitoringData();

    logger.info("Queue Statistics:", {
      totalRequests: monitoringData.queueStats.totalRequests,
      successRate: (
        (monitoringData.queueStats.successfulRequests /
         monitoringData.queueStats.totalRequests) * 100
      ).toFixed(2) + "%",
      avgExecutionTime: monitoringData.queueStats.avgExecutionTime.toFixed(2) + "ms",
      currentThroughput: monitoringData.queueStats.currentThroughput.toFixed(2) + " req/s",
    });

    logger.info("Rate Limiter Statistics:", {
      allowedRequests: monitoringData.rateLimiterStats.allowedRequests,
      blockedRequests: monitoringData.rateLimiterStats.blockedRequests,
      tokensAvailable: monitoringData.rateLimiterStats.tokensAvailable,
      avgWaitTime: monitoringData.rateLimiterStats.avgWaitTime.toFixed(2) + "ms",
    });

    logger.info("API Health:", {
      isHealthy: monitoringData.apiHealth.isHealthy,
      errorRate: monitoringData.apiHealth.errorRate.toFixed(3) + " errors/s",
      consecutiveErrors: monitoringData.apiHealth.consecutiveErrors,
    });

    // Example 6: Simulate rate limit scenario
    logger.info("=== Example 6: Rate limit handling ===");

    // Pause to reset token bucket
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Generate a burst of requests that would normally trigger rate limits
    const burstRequests = [];
    for (let i = 0; i < 30; i++) {
      burstRequests.push(
        client.getAccountInfo()
          .then(() => ({ success: true, index: i }))
          .catch(err => ({ success: false, index: i, error: err.message }))
      );
    }

    const burstResults = await Promise.all(burstRequests);
    const successCount = burstResults.filter(r => r.success).length;

    logger.info(`Burst test: ${successCount}/${burstResults.length} requests succeeded`);
    logger.info("The queue manager automatically handled rate limiting by:");
    logger.info("- Smoothing request distribution");
    logger.info("- Using token bucket for burst allowance");
    logger.info("- Applying adaptive delays based on API response");

    // Example 7: Demonstrate pause/resume functionality
    logger.info("=== Example 7: Pause/Resume functionality ===");

    // Pause requests
    client.pauseRequests();
    logger.info("Client paused - new requests will be rejected");

    try {
      await client.getLatestMarketData("BTC-USD");
    } catch (error) {
      logger.info("Request rejected as expected:", error.message);
    }

    // Resume requests
    client.resumeRequests();
    logger.info("Client resumed - requests allowed again");

    const resumedData = await client.getLatestMarketData("BTC-USD");
    logger.info("Request succeeded after resume:", {
      symbol: resumedData.symbol,
      price: resumedData.price,
    });

    // Final statistics
    logger.info("=== Final Statistics ===");
    const finalStats = client.getMonitoringData();

    logger.info("Session Summary:", {
      totalRequests: finalStats.queueStats.totalRequests,
      successfulRequests: finalStats.queueStats.successfulRequests,
      failedRequests: finalStats.queueStats.failedRequests,
      rateLimitBlocks: finalStats.rateLimiterStats.blockedRequests,
      circuitBreakerActivations: finalStats.rateLimiterStats.circuitBreakerActivations,
    });

  } catch (error) {
    logger.error("Example failed:", error);
  } finally {
    // Clean up
    await client.disconnect();
    logger.info("Disconnected from dYdX network");
  }
}

// Run the example
main().catch(error => {
  logger.error("Fatal error:", error);
  process.exit(1);
});
