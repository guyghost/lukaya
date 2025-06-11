#!/usr/bin/env bun

import { createStrategyService } from './domain/services/strategy.service';
import { StrategyFactory } from './adapters/strategies/strategy-factory';
import { StrategyType } from './shared/enums';
import { BacktestUiAdapter } from './adapters/primary/backtest-ui.adapter';
import type { BacktestConfig } from './backtest/models/backtest.model';

// Créer le service de stratégies
const strategyService = createStrategyService();

// Créer la factory de stratégies
const strategyFactory = new StrategyFactory();

// Configuration de notre stratégie de scalping EMA 20/50 + RSI 7
const scalpingConfig = {
  fastEmaPeriod: 20,
  slowEmaPeriod: 50,
  rsiPeriod: 7,
  momentumPeriod: 10,
  symbol: "ETH-USD",
  positionSize: 0.01,
  maxHoldingPeriod: 15,
  profitTargetPercent: 0.3,
  stopLossPercent: 0.2,
  rsiOverboughtLevel: 70,
  rsiOversoldLevel: 30,
  momentumThreshold: 0.01,
  priceDeviationThreshold: 0.05,
  maxSlippagePercent: 0.2,
  minLiquidityRatio: 8.0,
  riskPerTrade: 0.01,
  accountSize: 10000,
  maxCapitalPerTrade: 0.08,
  limitOrderBuffer: 0.0001,
  useLimitOrders: true
};

async function testScalpingStrategy() {
  try {
    console.log('🚀 Test de la stratégie de scalping EMA 20/50 + RSI 7');
    console.log('=' .repeat(60));
    
    // Créer la stratégie
    console.log('📈 Création de la stratégie de scalping...');
    const strategy = await strategyFactory.createStrategy(
      StrategyType.SCALPING_ENTRY_EXIT,
      scalpingConfig
    );
    
    console.log(`✅ Stratégie créée: ${strategy.getName()}`);
    console.log(`   ID: ${strategy.getId()}`);
    console.log(`   Description: ${strategy.getConfig().description}`);
    
    // Enregistrer la stratégie
    strategyService.registerStrategy(strategy);
    console.log('✅ Stratégie enregistrée dans le service');
    
    // Vérifier que la stratégie est bien enregistrée
    const registeredStrategy = strategyService.getStrategyById(strategy.getId());
    if (registeredStrategy) {
      console.log('✅ Stratégie trouvée dans le service');
    } else {
      console.log('❌ Erreur: Stratégie non trouvée dans le service');
      return;
    }
    
    // Créer l'adaptateur de backtest
    const backtestAdapter = new BacktestUiAdapter(strategyService);
    
    // Lister les stratégies disponibles
    console.log('\n📋 Stratégies disponibles pour le backtest:');
    const availableStrategies = backtestAdapter.getAvailableStrategies();
    availableStrategies.forEach((strat, index) => {
      console.log(`  ${index + 1}. ${strat.id}: ${strat.name}`);
      if (strat.description) {
        console.log(`     ${strat.description}`);
      }
    });
    
    if (availableStrategies.length === 0) {
      console.log('❌ Aucune stratégie disponible pour le backtest');
      return;
    }
    
    // Configuration du backtest
    const backtestConfig: BacktestConfig = {
      symbol: "ETH-USD",
      startDate: new Date("2024-01-01T00:00:00.000Z"),
      endDate: new Date("2024-01-07T23:59:59.999Z"),
      initialBalance: 10000,
      tradingFees: 0.1,
      slippage: 0.05,
      dataResolution: "5m",
      includeWeekends: false,
      enableStopLoss: true,
      stopLossPercentage: 0.2,
      enableTakeProfit: true,
      takeProfitPercentage: 0.3
    };
    
    console.log('\n🧪 Lancement du backtest...');
    console.log(`   Symbole: ${backtestConfig.symbol}`);
    console.log(`   Période: ${backtestConfig.startDate.toISOString()} - ${backtestConfig.endDate.toISOString()}`);
    console.log(`   Capital initial: $${backtestConfig.initialBalance}`);
    console.log(`   Résolution: ${backtestConfig.dataResolution}`);
    
    // Exécuter le backtest
    const result = await backtestAdapter.runBacktest(strategy.getId(), backtestConfig);
    
    // Afficher les résultats
    console.log('\n📊 Résultats du backtest:');
    console.log('=' .repeat(40));
    console.log(`💰 Profit: $${result.profit.toFixed(2)} (${result.profitPercentage.toFixed(2)}%)`);
    console.log(`📈 Balance finale: $${result.finalBalance.toFixed(2)}`);
    console.log(`🔢 Nombre de trades: ${result.metrics.totalTrades}`);
    console.log(`🎯 Taux de réussite: ${(result.metrics.winRate * 100).toFixed(2)}%`);
    console.log(`📉 Drawdown max: ${result.metrics.maxDrawdownPercentage.toFixed(2)}%`);
    console.log(`📊 Ratio de Sharpe: ${result.metrics.sharpeRatio.toFixed(2)}`);
    
    if (result.trades.length > 0) {
      console.log('\n🔍 Aperçu des trades:');
      result.trades.slice(0, 5).forEach((trade, index) => {
        console.log(`  ${index + 1}. ${trade.direction.toUpperCase()} - Entry: $${trade.entryPrice.toFixed(2)} | P&L: ${trade.profitPercentage.toFixed(2)}%`);
      });
      if (result.trades.length > 5) {
        console.log(`  ... et ${result.trades.length - 5} autres trades`);
      }
    }
    
    console.log('\n✅ Test terminé avec succès!');
    
  } catch (error) {
    console.error('❌ Erreur lors du test:', error);
    process.exit(1);
  }
}

// Exécuter le test
testScalpingStrategy();
