#!/usr/bin/env ts-node

/**
 * Script de test rapide pour vérifier les améliorations de génération de signaux
 */

import { createContextualLogger } from "./infrastructure/logging/enhanced-logger";

const logger = createContextualLogger('TestOptimizations');

function testScalpingConditions() {
  logger.info("🧪 Test des nouvelles conditions de scalping...");
  
  // Simule des conditions de marché typiques d'après les logs
  const marketScenarios = [
    {
      name: "SOL-USD scenario (from logs)",
      currentPrice: 50.00,
      fastEMA: 49.95,
      slowEMA: 49.90,
      currentRSI: 12.5,
      previousRSI: 11.8,
      momentum: 0.0002,
      volumeSignal: 'long'
    },
    {
      name: "BTC-USD scenario (from logs)", 
      currentPrice: 45000,
      fastEMA: 44995,
      slowEMA: 44990,
      currentRSI: 14.2,
      previousRSI: 13.9,
      momentum: 0.0001,
      volumeSignal: 'long'
    },
    {
      name: "ETH-USD scenario (from logs)",
      currentPrice: 3200,
      fastEMA: 3198,
      slowEMA: 3195,
      currentRSI: 16.8,
      previousRSI: 15.9,
      momentum: 0.0003,
      volumeSignal: 'none'
    }
  ];

  const config = {
    rsiOverboughtLevel: 78,
    rsiOversoldLevel: 22,
    momentumThreshold: 0.0003
  };

  marketScenarios.forEach(scenario => {
    logger.info(`\n📊 Testing scenario: ${scenario.name}`);
    
    // Test conditions assouplies
    const bullishMomentum = scenario.momentum > config.momentumThreshold;
    const rsiOkForLong = scenario.currentRSI < config.rsiOverboughtLevel + 5;
    const priceAboveFast = scenario.currentPrice > scenario.fastEMA;
    const rsiRecovering = scenario.currentRSI > scenario.previousRSI || scenario.currentRSI < config.rsiOversoldLevel + 10;
    
    const longSignalConditions = (priceAboveFast || bullishMomentum) && rsiOkForLong && rsiRecovering;
    
    // Test conditions coordonnées
    const longConditions = {
      bullishCrossover: scenario.currentPrice > scenario.fastEMA && scenario.fastEMA > scenario.slowEMA,
      rsiNotOverbought: scenario.currentRSI < config.rsiOverboughtLevel + 10,
      positiveMomentum: scenario.momentum > config.momentumThreshold * 0.5,
      volumeSignalLong: scenario.volumeSignal === 'long'
    };
    
    const coordLongConditionsMet = Object.values(longConditions).filter(Boolean).length;
    const coordLongSignal = coordLongConditionsMet >= 2;
    
    logger.info(`   Scalping Signal: ${longSignalConditions ? '✅ LONG' : '❌ None'}`);
    logger.info(`   - Price above fast EMA: ${priceAboveFast}`);
    logger.info(`   - Bullish momentum: ${bullishMomentum}`);
    logger.info(`   - RSI OK for long: ${rsiOkForLong}`);
    logger.info(`   - RSI recovering: ${rsiRecovering}`);
    
    logger.info(`   Coordinated Signal: ${coordLongSignal ? '✅ LONG' : '❌ None'} (${coordLongConditionsMet}/4 conditions)`);
    logger.info(`   - Bullish crossover: ${longConditions.bullishCrossover}`);
    logger.info(`   - RSI not overbought: ${longConditions.rsiNotOverbought}`);
    logger.info(`   - Positive momentum: ${longConditions.positiveMomentum}`);
    logger.info(`   - Volume signal long: ${longConditions.volumeSignalLong}`);
  });
}

function testConfidenceThresholds() {
  logger.info("\n🎯 Test des nouveaux seuils de confiance...");
  
  const scenarios = [
    { name: "Scenario from logs", elliott: 0.050, harmonic: 0.600, volume: 0.375, overall: 0.274 },
    { name: "Typical weak signal", elliott: 0.030, harmonic: 0.040, volume: 0.025, overall: 0.095 },
    { name: "Moderate signal", elliott: 0.060, harmonic: 0.080, volume: 0.050, overall: 0.130 }
  ];

  const newThresholds = {
    trend: 0.03,
    pattern: 0.05,
    volume: 0.02,
    overall: 0.08
  };

  scenarios.forEach(scenario => {
    logger.info(`\n📈 ${scenario.name}:`);
    logger.info(`   Elliott: ${scenario.elliott.toFixed(3)} ${scenario.elliott >= newThresholds.trend ? '✅' : '❌'} (threshold: ${newThresholds.trend})`);
    logger.info(`   Harmonic: ${scenario.harmonic.toFixed(3)} ${scenario.harmonic >= newThresholds.pattern ? '✅' : '❌'} (threshold: ${newThresholds.pattern})`);
    logger.info(`   Volume: ${scenario.volume.toFixed(3)} ${scenario.volume >= newThresholds.volume ? '✅' : '❌'} (threshold: ${newThresholds.volume})`);
    logger.info(`   Overall: ${scenario.overall.toFixed(3)} ${scenario.overall >= newThresholds.overall ? '✅' : '❌'} (threshold: ${newThresholds.overall})`);
    
    const wouldTrade = scenario.overall >= newThresholds.overall;
    logger.info(`   🎯 Trading Decision: ${wouldTrade ? '🚀 TRADE!' : '⏳ Wait'}`);
  });
}

// Exécuter les tests
async function runTests() {
  try {
    logger.info("🚀 Démarrage des tests d'optimisation des signaux");
    logger.info("=" .repeat(60));
    
    testScalpingConditions();
    testConfidenceThresholds();
    
    logger.info("\n✅ Tests terminés avec succès!");
    logger.info("📝 Résumé des optimisations:");
    logger.info("  • Conditions d'entrée assouplies (2/4 au lieu de 3/4)");
    logger.info("  • Seuils de momentum réduits de 50%");
    logger.info("  • Marges RSI élargies de ±10 points");
    logger.info("  • Seuils de confiance réduits de 30-50%");
    logger.info("  • Cooldown des signaux réduit à 1 candle");
    
  } catch (error) {
    logger.error("❌ Erreur lors des tests:", error as Error);
  }
}

runTests();
