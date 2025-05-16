#!/usr/bin/env bun

import { loadConfig, getNetworkFromString } from "./config/config";
import { createDydxClient } from "./adapters/secondary/dydx-client.adapter";
import { createTradingBotService } from "./application/services";
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
    maxRiskPerTrade: Math.min(config.trading.riskPerTrade * 1.75, 0.08), // Augmentation de 75% avec plafond à 8%
    stopLossPercent: config.trading.stopLossPercent * 1.5, // Augmentation de 50% (perte plus grande avant de sortir)
    accountSize: config.trading.defaultAccountSize,
    maxLeverage: Math.min(config.trading.maxLeverage * 1.5, 10), // Augmentation de 50% avec plafond à 10x
    maxOpenPositions: 8, // Augmenté de 5 à 8
    maxPositionSize: config.trading.maxCapitalPerTrade * 1.3 // Augmentation de 30%
  };
  
  const strategyConfig: Partial<StrategyManagerConfig> = {
    autoAdjustWeights: true,
    maxActiveStrategies: 12, // Augmenté de 10 à 12
    conflictResolutionMode: 'performance_weighted',
    minPerformanceThreshold: 0.4 // Réduit le seuil minimal de performance (accepter des stratégies moins performantes)
  };
  
  const performanceConfig: Partial<PerformanceTrackerConfig> = {
    historyLength: 1000,
    trackOpenPositions: true,
    realTimeUpdates: true
  };
  
  const takeProfitConfig: Partial<TakeProfitConfig> = {
    enabled: true,
    profitTiers: [
      { profitPercentage: 15, closePercentage: 20 }, // Plus de profit requis avant de commencer à sortir
      { profitPercentage: 25, closePercentage: 30 }, // Sortir plus lentement pour laisser courir les profits
      { profitPercentage: 40, closePercentage: 50 }, // Niveaux plus ambitieux
      { profitPercentage: 70, closePercentage: 100 } // Objectif final plus ambitieux
    ],
    cooldownPeriod: 5 * 60 * 1000, // 5 minutes (réduit de 10 à 5 minutes)
    trailingMode: true // Activer le mode trailing pour capturer plus de hausse
  };
  
  const takeProfitIntegratorConfig: Partial<TakeProfitIntegratorConfig> = {
    priceCheckInterval: 30 * 1000, // 30 secondes
    positionCheckInterval: 2 * 60 * 1000 // 2 minutes
  };
  
  // Configuration pour le superviseur de marché
  const marketSupervisorConfig = {
    maxMarkets: 50, // Nombre maximum de marchés à surveiller
    pollingInterval: config.trading.pollInterval,
    priceChangeThreshold: 0.5 // 0.5% de changement de prix pour notification
  };

  // Initialize trading bot service with separate ports using factory function
  logger.debug("Setting up trading bot service with market supervisor architecture...");
  const tradingBot = createTradingBotService(
    marketDataPort, 
    tradingPort,
    { 
      pollInterval: config.trading.pollInterval,
      positionAnalysisInterval: config.trading.positionAnalysisInterval,
      maxFundsPerOrder: config.trading.maxFundsPerOrder * 1.4, // Augmenté de 40%
      riskConfig,
      strategyConfig,
      performanceConfig,
      takeProfitConfig,
      takeProfitIntegratorConfig,
      supervisorConfig: marketSupervisorConfig
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