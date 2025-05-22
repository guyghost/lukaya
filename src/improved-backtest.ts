// improved-backtest.ts - Version améliorée du système de backtesting
import { createBacktestCLI } from './infrastructure/backtesting/backtest-cli';
import { getLogger } from './infrastructure/logger';
import { BacktestEngine } from './infrastructure/backtesting/backtest-engine';
import { createSimpleMAStrategy } from './adapters/primary/simple-ma.strategy';
import { Strategy } from './domain/models/strategy.model';
import { BacktestVisualizer } from './infrastructure/backtesting/backtest-visualizer';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger();

// Fonction principale pour exécuter le backtest
async function main() {
  try {
    logger.info("[IMPROVED-BACKTEST] Démarrage du backtest amélioré");
    
    // Configuration simplifiée pour le backtest
    const config = {
      startDate: new Date('2023-01-01T00:00:00.000Z'),
      endDate: new Date('2023-02-28T00:00:00.000Z'), // Période étendue pour plus de données
      highRiskMode: true,
      dataOptions: {
        dataSource: 'csv',
        dataPath: path.resolve(process.cwd(), 'data'),
        timeframe: '1h',
        interpolateData: true // Activer l'interpolation de données
      },
      tradingOptions: {
        initialBalance: 10000,
        tradingFees: 0.1,
        slippage: 0.05,
        maxFundsPerOrder: 0.1
      },
      riskConfig: {
        maxRiskPerTrade: 0.03,
        maxOpenPositions: 5,
        maxPositionSize: 5,
        maxDrawdownPercent: 25.0,
        maxLeverage: 2.0,
        stopLossPercent: 5.0,
        takeProfitPercent: 10.0,
        accountSize: 10000,
        diversificationWeight: 0.5,
        volatilityAdjustment: true
      },
      takeProfitConfig: {
        enabled: true,
        trailingMode: true,
        cooldownPeriod: 60000,
        priceTolerance: 0.1,
        minOrderSizePercent: 5.0,
        profitTiers: [
          { profitPercentage: 1.0, closePercentage: 25 },
          { profitPercentage: 2.0, closePercentage: 25 },
          { profitPercentage: 5.0, closePercentage: 25 },
          { profitPercentage: 10.0, closePercentage: 25 }
        ]
      },
      strategyConfig: {
        autoAdjustWeights: true,
        maxActiveStrategies: 5,
        conflictResolutionMode: 'performance_weighted',
        minPerformanceThreshold: 0.4
      }
    };
    
    logger.info("[IMPROVED-BACKTEST] Configuration chargée", {
      startDate: config.startDate.toISOString(),
      endDate: config.endDate.toISOString(),
      balance: config.tradingOptions.initialBalance
    });
    
    // Créer le moteur de backtest
    const engine = new BacktestEngine(config);
    
    // Créer les stratégies avec des paramètres améliorés
    const strategies: Strategy[] = [
      createSimpleMAStrategy({
        symbol: 'BTC_USD',
        shortPeriod: 7, // paramètre optimisé
        longPeriod: 21,
        positionSize: 0.1,
        useBollinger: true,
        bollingerPeriod: 20,
        bollingerStdDev: 2.2, // légèrement augmenté
        useMACD: true,
        macdFastPeriod: 6, // paramètre optimisé
        macdSlowPeriod: 19, // paramètre optimisé
        macdSignalPeriod: 9,
        useRSI: true,
        rsiPeriod: 14,
        rsiOversold: 42, // paramètre optimisé
        rsiOverbought: 58 // paramètre optimisé
      }),
      createSimpleMAStrategy({
        symbol: 'ETH_USD',
        shortPeriod: 5, // paramètre optimisé
        longPeriod: 15, // paramètre optimisé
        positionSize: 0.1,
        useBollinger: true,
        bollingerPeriod: 15, // paramètre optimisé
        bollingerStdDev: 2.2,
        useMACD: true,
        macdFastPeriod: 7, // paramètre optimisé
        macdSlowPeriod: 17, // paramètre optimisé
        macdSignalPeriod: 7, // paramètre optimisé
        useRSI: true,
        rsiPeriod: 10, // paramètre optimisé
        rsiOversold: 40, 
        rsiOverbought: 60
      })
    ];
    
    logger.info("[IMPROVED-BACKTEST] Stratégies créées", {
      count: strategies.length,
      names: strategies.map(s => s.getName())
    });
    
    try {
      // Exécuter le backtest
      logger.info("[IMPROVED-BACKTEST] Lancement du backtest");
      const results = await engine.run(strategies);
      
      // Afficher les résultats
      logger.info("[IMPROVED-BACKTEST] Résultats du backtest", {
        finalBalance: results.finalBalance,
        profit: results.profit,
        profitPercentage: results.profitPercentage,
        totalTrades: results.trades.length,
        winRate: results.winRate,
        profitFactor: results.profitFactor
      });
      
      // Sauvegarder les résultats détaillés
      fs.writeFileSync(
        path.resolve(process.cwd(), 'improved-backtest-results.json'),
        JSON.stringify(results, null, 2)
      );
      
      // Générer un rapport textuel standard
      const reportText = await engine.generateReport();
      fs.writeFileSync(
        path.resolve(process.cwd(), 'improved-backtest-report.txt'),
        reportText
      );
      
      // Générer des visualisations avancées
      logger.info("[IMPROVED-BACKTEST] Génération des visualisations");
      const visualizer = new BacktestVisualizer(results, {
        outputHtmlPath: path.resolve(process.cwd(), 'improved-backtest-report.html'),
        outputJsonPath: path.resolve(process.cwd(), 'improved-backtest-viz-data.json')
      });
      
      await visualizer.generateVisualizations();
      
      logger.info("[IMPROVED-BACKTEST] Backtest terminé avec succès");
      logger.info("[IMPROVED-BACKTEST] Rapports générés: improved-backtest-report.txt et improved-backtest-report.html");
    } catch (error) {
      logger.error("[IMPROVED-BACKTEST] Erreur lors de l'exécution du backtest", 
        error instanceof Error ? error : new Error(String(error)));
      
      if (error instanceof Error && error.stack) {
        logger.error("[IMPROVED-BACKTEST] Stack trace:", new Error(error.stack));
      }
    }
  } catch (error) {
    logger.error("[IMPROVED-BACKTEST] Erreur globale", 
      error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  }
}

main().catch(err => {
  console.error("[IMPROVED-BACKTEST] Erreur non gérée", err);
  process.exit(1);
});
