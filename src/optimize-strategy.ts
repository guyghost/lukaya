// optimize-strategy.ts - Script pour optimiser les paramètres de stratégie et générer des backtests complets
import { BacktestEngine } from './infrastructure/backtesting/backtest-engine';
import { createSimpleMAStrategy } from './adapters/primary/simple-ma.strategy';
import { Strategy } from './domain/models/strategy.model';
import { BacktestVisualizer } from './infrastructure/backtesting/backtest-visualizer';
import { getLogger } from './infrastructure/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger();

/**
 * Interface pour les paramètres de stratégie avec leurs plages de valeurs
 */
interface StrategyParameter {
  name: string;
  currentValue: number;
  minValue: number;
  maxValue: number;
  step: number;
}

/**
 * Interface pour les résultats d'optimisation
 */
interface OptimizationResult {
  parameters: Record<string, number>;
  performance: {
    profit: number;
    profitPercentage: number;
    winRate: number;
    profitFactor: number;
    trades: number;
  };
}

/**
 * Fonction pour exécuter un backtest avec un ensemble de paramètres
 */
async function runBacktestWithParameters(
  symbol: string,
  parameters: Record<string, number>,
  config: any
): Promise<OptimizationResult> {
  // Créer la stratégie avec les paramètres fournis
  const strategy = createSimpleMAStrategy({
    symbol: symbol,
    positionSize: 0.1,
    ...parameters
  });
  
  // Créer le moteur de backtest
  const engine = new BacktestEngine(config);
  
  try {
    // Exécuter le backtest
    logger.info(`[OPTIMIZE] Exécution du backtest avec paramètres: ${JSON.stringify(parameters)}`);
    const results = await engine.run([strategy]);
    
    return {
      parameters,
      performance: {
        profit: results.profit,
        profitPercentage: results.profitPercentage,
        winRate: results.winRate,
        profitFactor: results.profitFactor,
        trades: results.trades.length
      }
    };
  } catch (error) {
    logger.error(`[OPTIMIZE] Erreur lors de l'exécution du backtest: ${error instanceof Error ? error.message : String(error)}`);
    return {
      parameters,
      performance: {
        profit: 0,
        profitPercentage: 0,
        winRate: 0,
        profitFactor: 0,
        trades: 0
      }
    };
  }
}

/**
 * Optimiseur de stratégie par recherche de grille (grid search)
 */
async function optimizeStrategyGridSearch(
  symbol: string,
  baseParameters: Record<string, number>,
  parametersToOptimize: StrategyParameter[],
  config: any
): Promise<OptimizationResult[]> {
  const results: OptimizationResult[] = [];
  const totalCombinations = parametersToOptimize.reduce(
    (acc, param) => acc * (Math.floor((param.maxValue - param.minValue) / param.step) + 1),
    1
  );
  
  logger.info(`[OPTIMIZE] Démarrage de l'optimisation de grille avec ${totalCombinations} combinaisons`);
  
  // Fonction récursive pour explorer toutes les combinaisons de paramètres
  async function exploreParameters(
    paramIndex: number,
    currentParams: Record<string, number>
  ): Promise<void> {
    // Si nous avons exploré tous les paramètres, exécutez le backtest
    if (paramIndex >= parametersToOptimize.length) {
      const result = await runBacktestWithParameters(symbol, currentParams, config);
      results.push(result);
      
      // Afficher la progression
      logger.info(`[OPTIMIZE] Progression: ${results.length}/${totalCombinations} (${((results.length / totalCombinations) * 100).toFixed(1)}%)`);
      return;
    }
    
    const param = parametersToOptimize[paramIndex];
    
    // Explorer les valeurs pour ce paramètre
    for (
      let value = param.minValue;
      value <= param.maxValue;
      value += param.step
    ) {
      // Créer une nouvelle copie des paramètres avec cette valeur
      const newParams = { ...currentParams };
      newParams[param.name] = value;
      
      // Explorer les paramètres suivants avec cette valeur
      await exploreParameters(paramIndex + 1, newParams);
    }
  }
  
  // Commencer l'exploration avec les paramètres de base
  await exploreParameters(0, { ...baseParameters });
  
  // Trier les résultats par profit décroissant
  return results.sort((a, b) => b.performance.profit - a.performance.profit);
}

/**
 * Optimiseur de stratégie par optimisation bayésienne
 * (Version simplifiée, simule en évitant d'ajouter des dépendances)
 */
async function optimizeStrategyBayesian(
  symbol: string,
  baseParameters: Record<string, number>,
  parametersToOptimize: StrategyParameter[],
  config: any,
  iterations: number = 20
): Promise<OptimizationResult[]> {
  const results: OptimizationResult[] = [];
  
  logger.info(`[OPTIMIZE] Démarrage de l'optimisation bayésienne avec ${iterations} itérations`);
  
  // Phase 1: Exploration initiale aléatoire
  const initialExplorations = Math.min(10, iterations / 2);
  
  for (let i = 0; i < initialExplorations; i++) {
    // Générer un ensemble de paramètres aléatoires dans les plages définies
    const randomParams = { ...baseParameters };
    
    for (const param of parametersToOptimize) {
      const range = param.maxValue - param.minValue;
      const randomValue = param.minValue + Math.random() * range;
      // Arrondir à l'étape la plus proche
      randomParams[param.name] = Math.round(randomValue / param.step) * param.step;
    }
    
    // Exécuter le backtest avec ces paramètres
    const result = await runBacktestWithParameters(symbol, randomParams, config);
    results.push(result);
    
    logger.info(`[OPTIMIZE] Phase d'exploration: ${i + 1}/${initialExplorations}`);
  }
  
  // Phase 2: Exploitation guidée
  const remainingIterations = iterations - initialExplorations;
  
  // Trier les résultats pour trouver les meilleurs
  const sortedResults = [...results].sort((a, b) => b.performance.profit - a.performance.profit);
  
  for (let i = 0; i < remainingIterations; i++) {
    // Prendre les N meilleurs résultats comme référence
    const topN = Math.min(3, sortedResults.length);
    const topResults = sortedResults.slice(0, topN);
    
    // Créer un nouvel ensemble de paramètres basé sur les meilleurs résultats
    const newParams = { ...baseParameters };
    
    for (const param of parametersToOptimize) {
      // Calculer la moyenne pondérée des meilleurs paramètres
      let weightedSum = 0;
      let weightSum = 0;
      
      for (let j = 0; j < topN; j++) {
        const weight = Math.pow(0.7, j); // Le poids diminue exponentiellement
        weightedSum += topResults[j].parameters[param.name] * weight;
        weightSum += weight;
      }
      
      let baseValue = weightedSum / weightSum;
      
      // Ajouter un peu de bruit pour explorer autour des bonnes valeurs
      // Le bruit diminue au fil des itérations
      const explorationFactor = 1 - (i / remainingIterations);
      const maxDeviation = (param.maxValue - param.minValue) * 0.2 * explorationFactor;
      const noise = (Math.random() * 2 - 1) * maxDeviation;
      
      // Limiter à la plage de paramètres et arrondir à l'étape
      let value = baseValue + noise;
      value = Math.max(param.minValue, Math.min(param.maxValue, value));
      value = Math.round(value / param.step) * param.step;
      
      newParams[param.name] = value;
    }
    
    // Exécuter le backtest avec ces paramètres
    const result = await runBacktestWithParameters(symbol, newParams, config);
    results.push(result);
    
    // Mettre à jour les résultats triés
    sortedResults.push(result);
    sortedResults.sort((a, b) => b.performance.profit - a.performance.profit);
    
    logger.info(`[OPTIMIZE] Phase d'exploitation: ${i + 1}/${remainingIterations}`);
  }
  
  // Retourner tous les résultats triés par profit décroissant
  return results.sort((a, b) => b.performance.profit - a.performance.profit);
}

/**
 * Fonction pour exécuter un backtest complet avec les meilleurs paramètres trouvés
 */
async function runDetailedBacktest(
  symbol: string,
  parameters: Record<string, number>,
  config: any
): Promise<void> {
  try {
    // Créer la stratégie avec les paramètres optimisés
    const strategy = createSimpleMAStrategy({
      symbol: symbol,
      positionSize: 0.1,
      ...parameters
    });
    
    logger.info(`[OPTIMIZE] Exécution du backtest détaillé pour les paramètres optimisés: ${JSON.stringify(parameters)}`);
    
    // Créer le moteur de backtest
    const engine = new BacktestEngine(config);
    
    // Exécuter le backtest
    const results = await engine.run([strategy]);
    
    // Générer un rapport de backtest standard
    const reportText = await engine.generateReport();
    const reportFilePath = path.resolve(process.cwd(), `optimized-${symbol}-report.txt`);
    fs.writeFileSync(reportFilePath, reportText);
    
    // Générer un rapport visuel détaillé
    const visualizer = new BacktestVisualizer(results, {
      outputHtmlPath: path.resolve(process.cwd(), `optimized-${symbol}-report.html`),
      outputJsonPath: path.resolve(process.cwd(), `optimized-${symbol}-data.json`)
    });
    
    await visualizer.generateVisualizations();
    
    // Sauvegarder les résultats complets
    fs.writeFileSync(
      path.resolve(process.cwd(), `optimized-${symbol}-results.json`),
      JSON.stringify(results, null, 2)
    );
    
    logger.info(`[OPTIMIZE] Backtest détaillé terminé pour ${symbol} avec succès`);
    logger.info(`[OPTIMIZE] Résultats du backtest optimisé pour ${symbol}:`, {
      finalBalance: results.finalBalance,
      profit: results.profit,
      profitPercentage: results.profitPercentage,
      totalTrades: results.trades.length,
      winRate: results.winRate,
      profitFactor: results.profitFactor
    });
  } catch (error) {
    logger.error(`[OPTIMIZE] Erreur lors de l'exécution du backtest détaillé: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Fonction principale pour optimiser et tester les stratégies
 */
async function main(): Promise<void> {
  try {
    logger.info("[OPTIMIZE] Démarrage de l'optimisation des stratégies");
    
    // Configuration de base pour les backtests
    const baseConfig = {
      startDate: new Date('2023-01-01T00:00:00.000Z'),
      endDate: new Date('2023-03-01T00:00:00.000Z'),
      highRiskMode: true,
      dataOptions: {
        dataSource: 'csv',
        dataPath: path.resolve(process.cwd(), 'data'),
        timeframe: '1h',
        interpolateData: true
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
    
    // Symboles à optimiser
    const symbols = ['BTC_USD', 'ETH_USD'];
    
    for (const symbol of symbols) {
      logger.info(`[OPTIMIZE] Optimisation de la stratégie pour ${symbol}`);
      
      // Paramètres de base pour la stratégie
      const baseParameters = {
        shortPeriod: 8,
        longPeriod: 21,
        useBollinger: true,
        bollingerPeriod: 20,
        bollingerStdDev: 2,
        useMACD: true,
        macdFastPeriod: 12,
        macdSlowPeriod: 26,
        macdSignalPeriod: 9,
        useRSI: true,
        rsiPeriod: 14,
        rsiOversold: 40,
        rsiOverbought: 60
      };
      
      // Paramètres à optimiser et leurs plages
      const parametersToOptimize: StrategyParameter[] = [
        { name: 'shortPeriod', currentValue: 8, minValue: 3, maxValue: 12, step: 1 },
        { name: 'longPeriod', currentValue: 21, minValue: 15, maxValue: 30, step: 3 },
        { name: 'rsiPeriod', currentValue: 14, minValue: 7, maxValue: 21, step: 2 },
        { name: 'rsiOversold', currentValue: 40, minValue: 30, maxValue: 45, step: 5 },
        { name: 'rsiOverbought', currentValue: 60, minValue: 55, maxValue: 70, step: 5 },
        { name: 'macdFastPeriod', currentValue: 12, minValue: 6, maxValue: 15, step: 3 },
        { name: 'macdSlowPeriod', currentValue: 26, minValue: 15, maxValue: 30, step: 3 }
      ];
      
      // Pour un test plus rapide, utiliser seulement quelques paramètres clés
      const quickOptimizeParameters: StrategyParameter[] = [
        { name: 'shortPeriod', currentValue: 8, minValue: 5, maxValue: 10, step: 1 },
        { name: 'longPeriod', currentValue: 21, minValue: 15, maxValue: 30, step: 3 },
        { name: 'rsiOversold', currentValue: 40, minValue: 35, maxValue: 45, step: 5 }
      ];
      
      // Utiliser l'optimisation bayésienne (plus efficace)
      logger.info(`[OPTIMIZE] Optimisation bayésienne pour ${symbol}`);
      const optimizationResults = await optimizeStrategyBayesian(
        symbol, 
        baseParameters, 
        quickOptimizeParameters,
        baseConfig, 
        15 // Nombre d'itérations
      );
      
      // Afficher les meilleurs résultats
      const topResults = optimizationResults.slice(0, 5);
      logger.info(`[OPTIMIZE] Top 5 résultats pour ${symbol}:`);
      
      for (let i = 0; i < topResults.length; i++) {
        const result = topResults[i];
        logger.info(`[OPTIMIZE] #${i+1}: Profit: $${result.performance.profit.toFixed(2)} (${result.performance.profitPercentage.toFixed(2)}%), Win Rate: ${(result.performance.winRate * 100).toFixed(2)}%, Paramètres: ${JSON.stringify(result.parameters)}`);
      }
      
      // Exécuter un backtest détaillé avec les meilleurs paramètres trouvés
      if (topResults.length > 0) {
        const bestParams = topResults[0].parameters;
        logger.info(`[OPTIMIZE] Exécution d'un backtest détaillé pour ${symbol} avec les meilleurs paramètres`);
        await runDetailedBacktest(symbol, bestParams, baseConfig);
      }
    }
    
    // Backtest final avec les deux stratégies optimisées
    if (symbols.length > 1) {
      logger.info("[OPTIMIZE] Exécution d'un backtest final avec toutes les stratégies optimisées");
      
      // À implémenter si nécessaire pour combiner les stratégies optimisées
    }
    
    logger.info("[OPTIMIZE] Optimisation et tests terminés");
  } catch (error) {
    logger.error(`[OPTIMIZE] Erreur lors de l'optimisation: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Exécuter le script principal
main().catch(err => {
  logger.error("[OPTIMIZE] Erreur non gérée", err);
  process.exit(1);
});
