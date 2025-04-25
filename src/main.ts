#!/usr/bin/env bun

import { loadConfig, getNetworkFromString } from "./config/config";
import { createDydxClient } from "./adapters/secondary/dydx-client.adapter";
import { createTradingBotService } from "./application/services/trading-bot.service";
import { SimpleMAStrategy } from "./adapters/primary/simple-ma.strategy";

async function main() {
  console.log("Starting Lukaya trading bot...");
  
  // Load configuration
  const config = loadConfig();
  console.log(`Running on ${config.network}`);
  
  // Initialize dYdX client using the factory function
  const { marketDataPort, tradingPort } = createDydxClient({
    network: getNetworkFromString(config.network),
    mnemonic: config.dydx.mnemonic,
  });
  
  // Initialize trading bot service with separate ports using factory function
  const tradingBot = createTradingBotService(marketDataPort, tradingPort);
  
  // Initialize and add strategies
  for (const strategyConfig of config.strategies) {
    if (!strategyConfig.enabled) continue;
    
    if (strategyConfig.type === "simple-ma") {
      const strategy = new SimpleMAStrategy(strategyConfig.parameters as any);
      tradingBot.addStrategy(strategy);
      console.log(`Added strategy: ${strategy.getName()}`);
    } else {
      console.warn(`Unknown strategy type: ${strategyConfig.type}`);
    }
  }
  
  // Start the trading bot
  tradingBot.start();
  
  console.log("Trading bot started successfully!");
  
  // Handle process termination
  process.on("SIGINT", async () => {
    console.log("Shutting down trading bot...");
    tradingBot.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Failed to start trading bot:", error);
  process.exit(1);
});
