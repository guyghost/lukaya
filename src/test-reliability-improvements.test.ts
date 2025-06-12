import { createContextualLogger } from "./infrastructure/logging/enhanced-logger";
import { orderCache, areOrdersDuplicates } from "./shared/utils/order-deduplication";
import { strategyHealthMonitor } from "./shared/utils/strategy-health-monitor";
import { OrderParams, OrderSide, OrderType } from "./domain/models/market.model";

const logger = createContextualLogger('ReliabilityTestSuite');

/**
 * Test the order deduplication system
 */
function testOrderDeduplication() {
  logger.info("🧪 Testing Order Deduplication System");
  
  // Create test orders
  const order1: OrderParams = {
    symbol: "ETH-USD",
    side: OrderSide.BUY,
    type: OrderType.MARKET,
    size: 0.5,
    price: 3000
  };
  
  const order2: OrderParams = {
    symbol: "ETH-USD",
    side: OrderSide.BUY,
    type: OrderType.MARKET,
    size: 0.5,
    price: 3000
  };
  
  const order3: OrderParams = {
    symbol: "ETH-USD",
    side: OrderSide.SELL,
    type: OrderType.MARKET,
    size: 0.5,
    price: 3000
  };
  
  // Test duplicate detection
  logger.info("Testing duplicate detection...");
  console.log("Order 1 vs Order 2 (should be duplicate):", areOrdersDuplicates(order1, order2));
  console.log("Order 1 vs Order 3 (should NOT be duplicate):", areOrdersDuplicates(order1, order3));
  
  // Test cache functionality
  logger.info("Testing cache functionality...");
  orderCache.clear();
  
  console.log("First order should not be duplicate:", orderCache.isDuplicate(order1));
  orderCache.addOrder(order1);
  console.log("Second identical order should be duplicate:", orderCache.isDuplicate(order2));
  console.log("Different order should not be duplicate:", orderCache.isDuplicate(order3));
  
  logger.info("✅ Order Deduplication Tests Completed");
}

/**
 * Test the strategy health monitoring system
 */
function testStrategyHealthMonitor() {
  logger.info("🧪 Testing Strategy Health Monitor");
  
  const strategyId = "test-strategy-1";
  
  // Test initial state
  logger.info("Testing initial health state...");
  const initialHealth = strategyHealthMonitor.getHealthStatus(strategyId);
  console.log("Initial health score:", initialHealth.healthScore);
  console.log("Initial is healthy:", initialHealth.isHealthy);
  
  // Test success recording
  logger.info("Recording successes...");
  for (let i = 0; i < 5; i++) {
    strategyHealthMonitor.recordSuccess(strategyId);
  }
  
  let health = strategyHealthMonitor.getHealthStatus(strategyId);
  console.log("Health after 5 successes:", health.healthScore, "Success rate:", (health.successfulOrders / health.totalOrders * 100).toFixed(2) + "%");
  
  // Test error recording
  logger.info("Recording errors...");
  for (let i = 0; i < 3; i++) {
    strategyHealthMonitor.recordError(strategyId, `Test error ${i + 1}`);
  }
  
  health = strategyHealthMonitor.getHealthStatus(strategyId);
  console.log("Health after 3 errors:", health.healthScore, "Consecutive errors:", health.consecutiveErrors);
  console.log("Needs intervention:", strategyHealthMonitor.needsIntervention(strategyId));
  console.log("Can auto-recover:", strategyHealthMonitor.canAutoRecover(strategyId));
  
  // Test recovery
  logger.info("Testing recovery...");
  strategyHealthMonitor.recordRecovery(strategyId);
  health = strategyHealthMonitor.getHealthStatus(strategyId);
  console.log("Health after recovery:", health.healthScore, "Recovery count:", health.recoveryCount);
  
  logger.info("✅ Strategy Health Monitor Tests Completed");
}

/**
 * Test "Order is fully filled" error handling simulation
 */
function testFullyFilledErrorHandling() {
  logger.info("🧪 Testing 'Order is fully filled' Error Handling");
  
  const testErrors = [
    "Order is fully filled",
    "Remaining amount: 0. Order: ...",
    "Order remaining amount is less than MinOrderBaseQuantums. Remaining amount: 0",
    "Broadcasting transaction failed: Order remaining amount is less than MinOrderBaseQuantums. Remaining amount: 0. Order: ... Order is fully filled",
    "Some other error"
  ];
  
  testErrors.forEach((errorMessage, index) => {
    const isFullyFilledError = errorMessage && (
      errorMessage.includes("Order is fully filled") ||
      errorMessage.includes("Remaining amount: 0") ||
      errorMessage.includes("Order remaining amount is less than MinOrderBaseQuantums")
    );
    
    console.log(`Error ${index + 1}: "${errorMessage}" -> Treated as fully filled: ${isFullyFilledError}`);
  });
  
  logger.info("✅ Fully Filled Error Handling Tests Completed");
}

/**
 * Simulate a complete error recovery scenario
 */
function testCompleteErrorRecoveryScenario() {
  logger.info("🧪 Testing Complete Error Recovery Scenario");
  
  const strategyId = "recovery-test-strategy";
  
  // Simulate normal operation
  logger.info("Phase 1: Normal operation");
  for (let i = 0; i < 10; i++) {
    strategyHealthMonitor.recordSuccess(strategyId);
  }
  
  let health = strategyHealthMonitor.getHealthStatus(strategyId);
  console.log("After normal operation - Health:", health.healthScore, "Is healthy:", health.isHealthy);
  
  // Simulate order failures (non-fully-filled errors)
  logger.info("Phase 2: Order failures");
  for (let i = 0; i < 4; i++) {
    strategyHealthMonitor.recordError(strategyId, `Network error ${i + 1}`);
  }
  
  health = strategyHealthMonitor.getHealthStatus(strategyId);
  console.log("After 4 failures - Health:", health.healthScore, "Needs intervention:", strategyHealthMonitor.needsIntervention(strategyId));
  
  // Simulate fully filled errors (should be treated as success)
  logger.info("Phase 3: Fully filled 'errors' (treated as success)");
  strategyHealthMonitor.recordSuccess(strategyId); // This simulates treating "fully filled" as success
  strategyHealthMonitor.recordSuccess(strategyId);
  
  health = strategyHealthMonitor.getHealthStatus(strategyId);
  console.log("After treating fully filled as success - Health:", health.healthScore, "Is healthy:", health.isHealthy);
  
  // Test auto-recovery
  logger.info("Phase 4: Auto-recovery");
  if (strategyHealthMonitor.canAutoRecover(strategyId)) {
    strategyHealthMonitor.recordRecovery(strategyId);
    health = strategyHealthMonitor.getHealthStatus(strategyId);
    console.log("After auto-recovery - Health:", health.healthScore, "Recovery count:", health.recoveryCount);
  }
  
  // Simulate return to normal operation
  logger.info("Phase 5: Return to normal operation");
  for (let i = 0; i < 5; i++) {
    strategyHealthMonitor.recordSuccess(strategyId);
  }
  
  health = strategyHealthMonitor.getHealthStatus(strategyId);
  console.log("Final state - Health:", health.healthScore, "Success rate:", (health.successfulOrders / health.totalOrders * 100).toFixed(2) + "%");
  
  logger.info("✅ Complete Error Recovery Scenario Tests Completed");
}

/**
 * Run all reliability tests
 */
export function runReliabilityTests() {
  logger.info("🚀 Starting Trading Bot Reliability Test Suite");
  
  try {
    testOrderDeduplication();
    console.log("---");
    
    testStrategyHealthMonitor();
    console.log("---");
    
    testFullyFilledErrorHandling();
    console.log("---");
    
    testCompleteErrorRecoveryScenario();
    
    logger.info("🎉 All Reliability Tests Completed Successfully!");
    
  } catch (error) {
    logger.error("❌ Test suite failed:", error as Error);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runReliabilityTests();
}
