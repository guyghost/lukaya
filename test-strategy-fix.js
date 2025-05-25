#!/usr/bin/env bun

// Simple test script to verify the RSI strategy fix
import { StrategyFactory } from "./src/adapters/strategies/index.js";
import { StrategyType } from "./src/shared/enums/index.js";

async function testStrategyCreation() {
  console.log("🧪 Testing RSI strategy creation fix...");
  
  const factory = new StrategyFactory();
  
  // Test configuration that was failing before
  const config = {
    rsiPeriod: 8,
    divergenceWindow: 5,
    symbol: "BTC-USD",
    positionSize: 0.015,
    overboughtLevel: 70,
    oversoldLevel: 30,
    maxSlippagePercent: 1.5,
    minLiquidityRatio: 10.0,
    riskPerTrade: 0.01,
    stopLossPercent: 0.02,
    accountSize: 10000,
    maxCapitalPerTrade: 0.25,
    limitOrderBuffer: 0.0005,
    useLimitOrders: false
  };

  try {
    console.log("Creating RSI strategy with StrategyType.RSI_DIVERGENCE...");
    
    // This should now work with our fix
    const strategy = await factory.createStrategy(StrategyType.RSI_DIVERGENCE, config);
    
    console.log("✅ SUCCESS! RSI strategy created successfully");
    console.log(`Strategy ID: ${strategy.getId()}`);
    console.log(`Strategy Name: ${strategy.getName()}`);
    
    // Test the strategy configuration
    const strategyConfig = strategy.getConfig();
    console.log(`Parameters: rsiPeriod=${strategyConfig.parameters.rsiPeriod}, symbol=${strategyConfig.parameters.symbol}`);
    
  } catch (error) {
    console.error("❌ FAILED! Error creating RSI strategy:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

// Run the test
testStrategyCreation().catch(console.error);
