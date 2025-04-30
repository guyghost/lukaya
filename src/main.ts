#!/usr/bin/env bun

import { loadConfig, getNetworkFromString } from "./config/config";
import { createDydxClient } from "./adapters/secondary/dydx-client.adapter";
import { createTradingBotService } from "./application/services/trading-bot.service";
import { createSimpleMAStrategy } from "./adapters/primary/simple-ma.strategy";
import { initializeLogger, getLogger } from "./infrastructure/logger";

const main = async (): Promise<void> => {
  // Load configuration
  const config = loadConfig();
  
  // Initialize logger
  initializeLogger(config);
  const logger = getLogger();
  
  logger.info("Starting Lukaya trading bot...", { network: config.network });
  
  // Initialize dYdX client using the factory function
  logger.debug("Initializing dYdX client...");
  const { marketDataPort, tradingPort } = createDydxClient({
    network: getNetworkFromString(config.network),
    mnemonic: config.dydx.mnemonic,
  });
  
  // Initialize trading bot service with separate ports using factory function
  logger.debug("Setting up trading bot service...");
  const tradingBot = createTradingBotService(
    marketDataPort, 
    tradingPort,
    { pollInterval: config.trading.pollInterval }
  );
  
  // Initialize and add strategies
  logger.info("Configuring trading strategies...");
  for (const strategyConfig of config.strategies) {
    if (!strategyConfig.enabled) {
      logger.debug(`Skipping disabled strategy: ${strategyConfig.type}`);
      continue;
    }
    
    try {
      if (strategyConfig.type === "simple-ma") {
        logger.debug("Initializing Simple MA strategy with parameters", strategyConfig.parameters);
        const strategy = createSimpleMAStrategy(strategyConfig.parameters as any);
        tradingBot.addStrategy(strategy);
        logger.info(`Added strategy: ${strategy.getName()}`);
      } else {
        logger.warn(`Unknown strategy type: ${strategyConfig.type}`);
      }
    } catch (error) {
      logger.error(`Failed to initialize strategy: ${strategyConfig.type}`, error as Error);
    }
  }
  
  try {
    // Verify account access and balances
    logger.debug("Checking account access...");
    const accountBalance = await tradingPort.getAccountBalance();
    logger.info("Account balances:", accountBalance);
    
    // Start the trading bot
    logger.info("Starting trading bot...");
    tradingBot.start();
    
    logger.info("Trading bot started successfully!");
  } catch (error) {
    logger.error("Failed to start trading bot", error as Error);
    process.exit(1);
  }
  
  // Handle process termination
  process.on("SIGINT", () => {
    logger.info("Shutting down trading bot...");
    tradingBot.stop();
    
    // Allow some time for graceful shutdown
    setTimeout(() => {
      logger.info("Trading bot shutdown complete");
      process.exit(0);
    }, 1000);
  });
  
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", error as Error);
    
    // Give some time for error to be logged
    setTimeout(() => {
      process.exit(1);
    }, 500);
  });
  
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", reason instanceof Error ? reason : new Error(String(reason)));
    
    // Give some time for error to be logged
    setTimeout(() => {
      process.exit(1);
    }, 500);
  });
};

main().catch((error) => {
  // Fallback error handling if logger initialization fails
  console.error("Fatal error:", error);
  process.exit(1);
});