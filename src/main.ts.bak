#!/usr/bin/env bun

import { loadConfig, getNetworkFromString } from "./config/config";
import { createDydxClient } from "./adapters/secondary/dydx-client.adapter";
import { createTradingBotService } from "./application/services";
import { createSimpleMAStrategy } from "./adapters/primary/simple-ma.strategy";
import { initializeLogger, getLogger } from "./infrastructure/logger";
import { metrics, riskTracker } from "./infrastructure/metrics";
import { RiskManagerConfig } from "./application/actors/risk-manager/risk-manager.model";
import { StrategyManagerConfig } from "./application/actors/strategy-manager/strategy-manager.model";
import { PerformanceTrackerConfig } from "./application/actors/performance-tracker/performance-tracker.model";
import { TakeProfitConfig } from "./application/actors/take-profit-manager/take-profit-manager.model";
import { TakeProfitIntegratorConfig } from "./application/integrators/take-profit-integrator";

const main = async (): Promise<void> => {
  // Load configuration
  const config = loadConfig();
  
  // Initialize logger
  initializeLogger(config);
  const logger = getLogger();
  
  logger.info("[MAIN] Starting Lukaya trading bot...", { 
    network: config.network,
    version: "2.1.0", // Version mise à jour avec les nouveaux paramètres de risque
    mode: "high-risk", // Mode à haut risque pour maximiser les retours potentiels
    buildDate: new Date().toISOString()
  });
  
  // Initialize dYdX client using the factory function
  logger.debug("[MAIN] Initializing dYdX client...");
  const { marketDataPort, tradingPort } = createDydxClient({
    network: getNetworkFromString(config.network),
    mnemonic: config.dydx.mnemonic,
  });
  
  // Prepare configurations for the specialized actors - Paramètres encore plus agressifs
  const riskConfig: Partial<RiskManagerConfig> = {
    maxRiskPerTrade: Math.min(config.trading.riskPerTrade * 2.5, 0.12), // Augmentation de 150% avec plafond à 12%
    stopLossPercent: config.trading.stopLossPercent * 1.8, // Augmentation de 80% (perte beaucoup plus grande avant de sortir)
    accountSize: config.trading.defaultAccountSize,
    maxLeverage: Math.min(config.trading.maxLeverage * 2.0, 12), // Doublé avec plafond à 12x
    maxOpenPositions: 10, // Augmenté jusqu'à 10 positions simultanées
    maxPositionSize: config.trading.maxCapitalPerTrade * 1.5, // Augmentation de 50%
    maxDailyLoss: 0.15, // Augmente la perte quotidienne maximale à 15%
    diversificationWeight: 0.3 // Réduit pour permettre plus de concentration
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
      { profitPercentage: 20, closePercentage: 15 }, // Encore plus de profit requis avant la première sortie
      { profitPercentage: 40, closePercentage: 25 }, // Plus de patience pour laisser courir les profits
      { profitPercentage: 60, closePercentage: 30 }, // Niveaux beaucoup plus ambitieux
      { profitPercentage: 100, closePercentage: 100 } // Objectif final très ambitieux (100% de profit)
    ],
    cooldownPeriod: 3 * 60 * 1000, // 3 minutes (encore réduit pour des réactions plus rapides)
    priceTolerance: 1.2, // Tolérance de prix augmentée à 1.2%
    trailingMode: true, // Activer le mode trailing pour capturer plus de hausse
    minOrderSizePercent: 2 // Taille minimale d'ordre plus petite pour plus de flexibilité
  };
  
  const takeProfitIntegratorConfig: Partial<TakeProfitIntegratorConfig> = {
    priceCheckInterval: 30 * 1000, // 30 secondes
    positionCheckInterval: 2 * 60 * 1000 // 2 minutes
  };
  
  // Configuration plus agressive pour le superviseur de marché
  const marketSupervisorConfig = {
    maxMarkets: 75, // Augmenté à 75 marchés pour plus d'opportunités
    pollingInterval: Math.floor(config.trading.pollInterval * 0.7), // Polling 30% plus rapide
    priceChangeThreshold: 0.35, // Plus sensible aux changements de prix (0.35% au lieu de 0.5%)
    healthCheckInterval: 30000, // Vérification de santé toutes les 30 secondes
    autoRestart: true, // Redémarrage automatique des acteurs défaillants
    aggressiveMode: true // Nouveau flag pour activer le mode agressif
  };

  // Initialize trading bot service with separate ports using factory function
  logger.debug("[MAIN] Setting up trading bot service with market supervisor architecture...");
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
  logger.info("[MAIN] Configuring trading strategies...");
  for (const strategyConfig of config.strategies) {
    if (!strategyConfig.enabled) {
      logger.debug(`[MAIN] Skipping disabled strategy: ${strategyConfig.type}`);
      continue;
    }
    
    try {
      if (strategyConfig.type === "simple-ma") {
        logger.debug("[MAIN] Initializing Simple MA strategy", {
          type: "simple-ma",
          symbol: strategyConfig.parameters.symbol,
          timeframe: strategyConfig.parameters.timeframe,
          fastMA: strategyConfig.parameters.fastMA,
          slowMA: strategyConfig.parameters.slowMA
        });
        const strategy = createSimpleMAStrategy(strategyConfig.parameters as any);
        tradingBot.addStrategy(strategy);
        logger.info(`[MAIN] Added strategy: ${strategy.getName()}`);
      } else {
        logger.warn(`[MAIN] Unknown strategy type: ${strategyConfig.type}`);
      }
    } catch (error) {
      logger.error(`[MAIN] Failed to initialize strategy: ${strategyConfig.type}`, error as Error);
    }
  }
  
  try {
    // Verify account access and balances
    logger.debug("[MAIN] Checking account access...");
    const accountBalance = await tradingPort.getAccountBalance();
    logger.info("[MAIN] Account balances:", accountBalance);
    
    // Initialize metrics systems
    logger.debug("[MAIN] Initializing advanced metrics and risk tracking...");
    
    // Log initial risk parameters for reference
    logger.info("[MAIN] Risk parameters initialized in high-risk mode", {
      maxRiskPerTrade: riskConfig.maxRiskPerTrade,
      maxPositionSize: riskConfig.maxPositionSize,
      maxLeverage: riskConfig.maxLeverage,
      stopLossPercent: riskConfig.stopLossPercent,
      takeProfitTiers: takeProfitConfig.profitTiers?.map(t => 
        `${t.profitPercentage}%/${t.closePercentage}%`).join(',')
    });
    
    // Start the trading bot
    logger.info("[MAIN] Starting trading bot with aggressive risk parameters...");
    tradingBot.start();
    
    // Schedule initial position analysis after 1 minute
    setTimeout(() => {
      logger.info("[MAIN] Running initial position viability analysis...");
      tradingBot.analyzeOpenPositions();
    }, 60 * 1000);
    
    // Schedule periodic risk reports
    const riskReportInterval = 15 * 60 * 1000; // Every 15 minutes
    setInterval(() => {
      if (!tradingBot) return;
      
      const riskReport = riskTracker.getRiskReport();
      logger.info("[MAIN] High-risk trading status:", {
        timestamp: new Date().toISOString(),
        riskExposure: riskReport.exposure,
        leverageUtilization: riskReport.leverage,
        highRiskPositions: riskReport.highRiskPositions
      });
      
      // Force position analysis after each risk report
      tradingBot.analyzeOpenPositions();
    }, riskReportInterval);
    
    logger.info("[MAIN] Trading bot started successfully!");
  } catch (error) {
    logger.error("[MAIN] Failed to start trading bot", error as Error);
    process.exit(1);
  }
  
  // Handle process termination
  process.on("SIGINT", () => {
    logger.info("[MAIN] Shutting down trading bot...");
    tradingBot.stop();
    
    // Run final position analysis before shutdown
    logger.info("[MAIN] Running final position viability check before shutdown...");
    tradingBot.analyzeOpenPositions();
    
    // Allow some time for graceful shutdown
    setTimeout(() => {
      logger.info("[MAIN] Trading bot shutdown complete");
      process.exit(0);
    }, 3000); // Extended timeout to allow for final analysis
  });
  
  process.on("uncaughtException", (error) => {
    logger.error("[MAIN] Uncaught exception", error as Error);
    
    // Give some time for error to be logged
    setTimeout(() => {
      process.exit(1);
    }, 500);
  });
  
  process.on("unhandledRejection", (reason) => {
    logger.error("[MAIN] Unhandled promise rejection", reason instanceof Error ? reason : new Error(String(reason)));
    
    // Give some time for error to be logged
    setTimeout(() => {
      process.exit(1);
    }, 500);
  });
};

main().catch((error) => {
  // Fallback error handling if logger initialization fails
  console.error("[FATAL] Fatal error:", error);
  process.exit(1);
});