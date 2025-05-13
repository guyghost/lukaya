#!/usr/bin/env bun

import { loadConfig, getNetworkFromString } from "./config/config";
import { createDydxClient } from "./adapters/secondary/dydx-client.adapter";
import { createTradingBotService } from "./application/services/trading-bot.service";
import { createSimpleMAStrategy } from "./adapters/primary/simple-ma.strategy";
import { initializeLogger, getLogger } from "./infrastructure/logger";
import { RiskManagerConfig } from "./application/actors/risk-manager/risk-manager.model";
import { StrategyManagerConfig } from "./application/actors/strategy-manager/strategy-manager.model";
import { PerformanceTrackerConfig } from "./application/actors/performance-tracker/performance-tracker.model";
import { TakeProfitConfig } from "./application/actors/take-profit-manager/take-profit-manager.model";
import { TakeProfitIntegratorConfig } from "./application/integrators/take-profit-integrator";
import { OrderSide } from "./domain/models/market.model";

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
  
  // Prepare configurations for the specialized actors
  const riskConfig: Partial<RiskManagerConfig> = {
    maxRiskPerTrade: config.trading.riskPerTrade,
    stopLossPercent: config.trading.stopLossPercent,
    accountSize: config.trading.defaultAccountSize,
    maxLeverage: config.trading.maxLeverage,
    maxOpenPositions: 5,
    maxPositionSize: config.trading.maxCapitalPerTrade
  };
  
  const strategyConfig: Partial<StrategyManagerConfig> = {
    autoAdjustWeights: true,
    maxActiveStrategies: 10,
    conflictResolutionMode: 'performance_weighted'
  };
  
  const performanceConfig: Partial<PerformanceTrackerConfig> = {
    historyLength: 1000,
    trackOpenPositions: true,
    realTimeUpdates: true
  };
  
  const takeProfitConfig: Partial<TakeProfitConfig> = {
    enabled: true,
    profitTiers: [
      { profitPercentage: 10, closePercentage: 25 },
      { profitPercentage: 20, closePercentage: 33 },
      { profitPercentage: 30, closePercentage: 50 },
      { profitPercentage: 50, closePercentage: 100 }
    ],
    cooldownPeriod: 10 * 60 * 1000, // 10 minutes
    trailingMode: false
  };
  
  const takeProfitIntegratorConfig: Partial<TakeProfitIntegratorConfig> = {
    priceCheckInterval: 30 * 1000, // 30 secondes
    positionCheckInterval: 2 * 60 * 1000 // 2 minutes
  };

  // Initialize trading bot service with separate ports using factory function
  logger.debug("Setting up trading bot service...");
  const tradingBot = createTradingBotService(
    marketDataPort, 
    tradingPort,
    { 
      pollInterval: config.trading.pollInterval,
      positionAnalysisInterval: config.trading.positionAnalysisInterval,
      maxFundsPerOrder: config.trading.maxFundsPerOrder,
      riskConfig,
      strategyConfig,
      performanceConfig,
      takeProfitConfig,
      takeProfitIntegratorConfig
    }
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
    
    // Schedule initial position analysis after 1 minute
    setTimeout(() => {
      logger.info("Running initial position viability analysis...");
      tradingBot.analyzeOpenPositions();
    }, 60 * 1000);
    
    logger.info("Trading bot started successfully!");
  } catch (error) {
    logger.error("Failed to start trading bot", error as Error);
    process.exit(1);
  }
  
  // Handle process termination
  process.on("SIGINT", () => {
    logger.info("Shutting down trading bot...");
    tradingBot.stop();
    
    // Run final position analysis before shutdown
    logger.info("Running final position viability check before shutdown...");
    tradingBot.analyzeOpenPositions();
    
    // Allow some time for graceful shutdown
    setTimeout(() => {
      logger.info("Trading bot shutdown complete");
      process.exit(0);
    }, 3000); // Extended timeout to allow for final analysis
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