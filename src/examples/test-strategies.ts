#!/usr/bin/env bun

import { createRsiDivergenceStrategy } from "../adapters/primary/rsi-divergence.strategy";
import { createVolumeAnalysisStrategy } from "../adapters/primary/volume-analysis.strategy";
import { createElliottWaveStrategy } from "../adapters/primary/elliott-wave.strategy";
import { createHarmonicPatternStrategy } from "../adapters/primary/harmonic-pattern.strategy";
import { getLogger, initializeLogger } from "../infrastructure/logger";
import { MarketData } from "../domain/models/market.model";

// Configure le logger
initializeLogger({
  logging: {
    level: "info",
    fileOutput: false
  }
});

const logger = getLogger();
logger.info("Démarrage du test des nouvelles stratégies de détection des signaux faibles");

// Configurations des stratégies
const rsiDivConfig = {
  rsiPeriod: 8,
  divergenceWindow: 5,
  symbol: "BTC-USD",
  positionSize: 0.015,
  overboughtLevel: 70,
  oversoldLevel: 30,
  maxSlippagePercent: 1.5,
  minLiquidityRatio: 6.0,
};

const volumeConfig = {
  volumeThreshold: 1.5,
  volumeMALength: 20,
  priceMALength: 10,
  symbol: "BTC-USD",
  positionSize: 0.015,
  volumeSpikeFactor: 2.5,
  priceSensitivity: 0.01,
  maxSlippagePercent: 1.5,
  minLiquidityRatio: 6.0,
};

const elliottConfig = {
  waveDetectionLength: 15,
  priceSensitivity: 3,
  symbol: "BTC-USD",
  positionSize: 0.015,
  zerolineBufferPercent: 0.5,
  maxSlippagePercent: 1.5,
  minLiquidityRatio: 6.0,
};

const harmonicConfig = {
  detectionLength: 20,
  fibRetracementTolerance: 0.03,
  symbol: "BTC-USD",
  positionSize: 0.015,
  patternConfirmationPercentage: 90,
  maxSlippagePercent: 1.5,
  minLiquidityRatio: 6.0,
};

// Créer les instances de stratégie
const strategies = [
  {
    name: "RSI Divergence",
    instance: createRsiDivergenceStrategy(rsiDivConfig)
  },
  {
    name: "Volume Analysis",
    instance: createVolumeAnalysisStrategy(volumeConfig)
  },
  {
    name: "Elliott Wave",
    instance: createElliottWaveStrategy(elliottConfig)
  },
  {
    name: "Harmonic Pattern",
    instance: createHarmonicPatternStrategy(harmonicConfig)
  }
];

// Générer des données de marché simulées
const generateMarketData = (basePrice: number, volatility: number, symbol: string): MarketData => {
  const randomFactor = (Math.random() - 0.5) * 2 * volatility;
  const price = basePrice * (1 + randomFactor);
  const spread = basePrice * 0.0005; // Spread de 0.05%
  return {
    symbol,
    price,
    timestamp: Date.now(),
    volume: basePrice * (0.5 + Math.random() * 1.5) / price,
    bid: price - spread/2,
    ask: price + spread/2
  };
};

// Fonction pour simuler l'alimentation en données de marché
const simulateMarketFeed = async () => {
  const startTime = Date.now();
  const testDuration = 30 * 1000; // 30 secondes de test
  const startPrice = 60000; // Prix de départ pour BTC
  let currentPrice = startPrice;
  let trendDirection = Math.random() > 0.5 ? 1 : -1;
  let trendStrength = 0.5 + Math.random() * 0.5;
  
  logger.info("Début de la simulation des données de marché");
  
  while (Date.now() - startTime < testDuration) {
    // Changer occasionnellement la direction de la tendance
    if (Math.random() < 0.05) {
      trendDirection *= -1;
      trendStrength = 0.5 + Math.random() * 0.5;
      logger.debug(`Changement de tendance: ${trendDirection > 0 ? "hausse" : "baisse"}, force: ${trendStrength.toFixed(2)}`);
    }
    
    // Simuler mouvement de prix avec une tendance
    currentPrice += trendDirection * trendStrength * (currentPrice * 0.002); // Mouvement de 0.2% max
    
    // Créer les données de marché
    const marketData = generateMarketData(currentPrice, 0.001, "BTC-USD");
    
    // Traiter les données avec chaque stratégie
    for (const strategy of strategies) {
      try {
        const signal = await strategy.instance.processMarketData(marketData);
        if (signal) {
          logger.info(`SIGNAL: ${strategy.name} - ${signal.type} ${signal.direction} @ ${signal.price} - ${signal.reason}`);
          
          // Générer ordre si un signal est détecté
          const orderParams = strategy.instance.generateOrder(signal, marketData);
          if (orderParams) {
            logger.info(`ORDRE: ${orderParams.side} ${orderParams.size} ${orderParams.symbol} @ ${orderParams.price || 'market price'}`);
          }
        }
      } catch (error: any) {
        logger.error(`Erreur lors du traitement des données pour ${strategy.name}:`, error);
      }
    }
    
    // Petite pause pour ne pas surcharger la console
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  logger.info("Fin de la simulation des données de marché");
};

// Lancer la simulation
simulateMarketFeed().catch((error) => {
  logger.error("Erreur lors de la simulation:", error);
});
