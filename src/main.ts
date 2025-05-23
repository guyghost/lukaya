#!/usr/bin/env bun

/**
 * Lukaya Trading Bot avec implémentation de la règle 3-5-7
 * 
 * La règle 3-5-7 est une stratégie de prise de profit progressive qui optimise 
 * le ratio risque/rendement et maximise les revenus tout en réduisant le risque global :
 * 
 * - À 3% de profit : fermeture de 30% de la position
 * - À 5% de profit : fermeture de 50% de la position restante
 * - À 7% de profit : fermeture du reste de la position
 * 
 * Le stop loss est fixé à 3% pour maintenir un ratio risque/rendement de 1:1 avec 
 * le premier niveau de prise de profit.
 */

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
  
  // Prepare configurations for the specialized actors - Paramètres optimisés pour générer plus de signaux
  // Configuration de risque optimisée pour la stratégie 3-5-7
  const riskConfig: Partial<RiskManagerConfig> = {
    maxRiskPerTrade: Math.min(config.trading.riskPerTrade * 1.5, 0.05), // Risque modéré pour préserver le capital
    stopLossPercent: 0.03, // Stop loss à 3% pour un ratio risque/rendement de 1:1 avec premier niveau de TP
    accountSize: config.trading.defaultAccountSize,
    maxLeverage: Math.min(config.trading.maxLeverage * 1.2, 5), // Levier raisonnable pour limiter le risque
    maxOpenPositions: 7, // Nombre modéré de positions simultanées
    maxPositionSize: config.trading.maxCapitalPerTrade * 1.0, // Taille de position standard
    maxDailyLoss: 0.07, // Perte quotidienne maximale plus restrictive (7%)
    diversificationWeight: 0.5 // Meilleure diversification pour réduire le risque global
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
  
  // Configuration de prise de profit selon la règle 3-5-7
  const takeProfitConfig: Partial<TakeProfitConfig> = {
    enabled: true,
    profitTiers: [
      { profitPercentage: 3, closePercentage: 30 }, // Premier niveau: 3% de profit -> fermer 30%
      { profitPercentage: 5, closePercentage: 50 }, // Deuxième niveau: 5% de profit -> fermer 50% du reste
      { profitPercentage: 7, closePercentage: 100 } // Troisième niveau: 7% de profit -> fermer le reste
    ],
    cooldownPeriod: 1 * 60 * 1000, // 1 minute pour des réactions encore plus rapides
    priceTolerance: 0.5, // Tolérance de prix très réduite pour être ultra-réactif
    trailingMode: false, // Désactiver le mode trailing pour appliquer strictement la règle 3-5-7
    minOrderSizePercent: 1.0 // Taille minimale d'ordre réduite pour s'assurer que tous les ordres passent
  };
  
  // Intervalles optimisés pour la stratégie 3-5-7
  const takeProfitIntegratorConfig: Partial<TakeProfitIntegratorConfig> = {
    priceCheckInterval: 5 * 1000, // 5 secondes (très fréquent pour ne pas rater les objectifs 3-5-7%)
    positionCheckInterval: 30 * 1000 // 30 secondes (très fréquent)
  };
  
  // Configuration optimisée pour le superviseur de marché avec règle 3-5-7
  const marketSupervisorConfig = {
    maxMarkets: 75, // Support pour de multiples marchés
    pollingInterval: 2000, // Polling ultra-rapide (2 secondes)
    priceChangeThreshold: 0.1, // Très sensible aux changements de prix (0.1% pour détecter les mouvements rapides)
    healthCheckInterval: 10000, // Vérifications de santé très fréquentes (10 secondes)
    autoRestart: true, // Redémarrage automatique maintenu
    aggressiveMode: true, // Mode agressif maintenu
    maxDataAge: 10000 // Données considérées périmées après 10 secondes
  };

  // Initialize trading bot service with separate ports using factory function and enhanced monitoring
  logger.debug("[MAIN] Setting up trading bot service with market supervisor architecture and enhanced monitoring...");
  
  // Activer davantage de logs pour le débogage
  process.env.DEBUG = "true";
  process.env.LOG_LEVEL = "debug";
  
  const tradingBot = createTradingBotService(
    marketDataPort, 
    tradingPort,
    { 
      pollInterval: 2000, // Polling ultra-rapide (2 secondes)
      positionAnalysisInterval: 15000, // Analyse des positions toutes les 15 secondes pour la règle 3-5-7
      maxFundsPerOrder: config.trading.maxFundsPerOrder * 1.4, // Augmenté de 40%
      debugMode: true, // Activer le mode debug
      forceSignalGeneration: true, // Forcer la génération de signaux plus fréquemment
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
  
  // Ajout de paires de trading additionnelles pour augmenter les opportunités de trading
  const additionalPairs = [
    { symbol: "BTC-USD", shortPeriod: 5, longPeriod: 15 },
    { symbol: "ETH-USD", shortPeriod: 5, longPeriod: 15 },
    { symbol: "SUI-USD", shortPeriod: 5, longPeriod: 15 },
    { symbol: "AIXBT-USD", shortPeriod: 7, longPeriod: 21 },
    { symbol: "KAITO-USD", shortPeriod: 6, longPeriod: 18 },
    { symbol: "DYDX-USD", shortPeriod: 8, longPeriod: 24 },
    { symbol: "XRP-USD", shortPeriod: 4, longPeriod: 12 }
  ];
  
  // Ajouter les stratégies configurées
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
  
  // Ajouter des stratégies supplémentaires pour plus d'opportunités de trading
  for (const pair of additionalPairs) {
    try {
      logger.info(`Adding strategy: Simple Moving Average (${pair.shortPeriod}/${pair.longPeriod})`);
      const strategy = createSimpleMAStrategy({
        symbol: pair.symbol,
        shortPeriod: pair.shortPeriod,
        longPeriod: pair.longPeriod,
        positionSize: 0.1,
        useBollinger: true,
        bollingerPeriod: 18,
        bollingerStdDev: 2.0,
        useMACD: true,
        macdFastPeriod: 8,
        macdSlowPeriod: 16,
        macdSignalPeriod: 9,
        useRSI: true,
        rsiPeriod: 12,
        rsiOversold: 45,
        rsiOverbought: 55
      });
      tradingBot.addStrategy(strategy);
    } catch (error) {
      logger.error(`[MAIN] Failed to initialize additional strategy for ${pair.symbol}`, error as Error);
    }
  }
  
  try {
    // Verify account access and balances
    logger.debug("[MAIN] Checking account access...");
    const accountBalance = await tradingPort.getAccountBalance();
    logger.info("[MAIN] Account balances:", accountBalance);
    
    // Initialize metrics systems
    logger.debug("[MAIN] Initializing advanced metrics and risk tracking with règle 3-5-7...");
    
    // Log initial risk parameters for reference - Règle 3-5-7
    logger.info("[MAIN] Paramètres de risque optimisés avec la règle 3-5-7", {
      strategy: "Règle 3-5-7 (3%/5%/7%)",
      stopLoss: "3%", // 3% pour équilibrer avec premier niveau
      maxRiskPerTrade: riskConfig.maxRiskPerTrade,
      maxPositionSize: riskConfig.maxPositionSize,
      maxLeverage: riskConfig.maxLeverage,
      takeProfitLevels: takeProfitConfig.profitTiers?.map(t => 
        `${t.profitPercentage}%/${t.closePercentage}%`).join(' → ')
    });
    
    // Start the trading bot
    logger.info("[MAIN] Démarrage du bot de trading avec la stratégie règle 3-5-7...");
    tradingBot.start();
    
    // Schedule initial position analysis after 1 minute
    setTimeout(() => {
      logger.info("[MAIN] Running initial position viability analysis...");
      logger.debug("[MAIN] Récupération des données du marché pour l'analyse initiale...");
      tradingBot.analyzeOpenPositions();
      logger.info("[MAIN] Analyse initiale terminée - résultats disponibles dans les logs ci-dessus");
    }, 60 * 1000);
    
    // Schedule periodic risk reports with 3-5-7 rule monitoring
    const riskReportInterval = 10 * 60 * 1000; // Every 10 minutes (plus fréquent)
    setInterval(() => {
      if (!tradingBot) return;
      
      const riskReport = riskTracker.getRiskReport();
      logger.info("[MAIN] Trading status (Règle 3-5-7):", {
        timestamp: new Date().toISOString(),
        strategy: "3-5-7 Take Profit Rule",
        riskExposure: riskReport.exposure,
        leverageUtilization: riskReport.leverage,
        stopLoss: "3%", // Stop loss aligné avec premier niveau de TP
        takeProfitLevels: "3%/5%/7%",
        highRiskPositions: riskReport.highRiskPositions
      });
      
      // Force position analysis after each risk report
      logger.debug("[MAIN] Récupération des données du marché pour l'analyse périodique...");
      tradingBot.analyzeOpenPositions();
      logger.info("[MAIN] Analyse périodique terminée - positions mises à jour selon règle 3-5-7");
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
    logger.debug("[MAIN] Récupération des données du marché pour l'analyse finale...");
    tradingBot.analyzeOpenPositions();
    logger.info("[MAIN] Analyse finale terminée - positions clôturées selon besoin");
    
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