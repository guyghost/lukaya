// test-enhanced-backtest.ts - Test complet du système de backtesting amélioré
import { BacktestEngine } from './infrastructure/backtesting/backtest-engine';
import { createSimpleMAStrategy } from './adapters/primary/simple-ma.strategy';
import { Strategy } from './domain/models/strategy.model';
import { getLogger } from './infrastructure/logger';
import * as fs from 'fs';
import * as path from 'path';
import { BacktestResults } from './infrastructure/backtesting/backtest-models';

const logger = getLogger();

// Fonction pour générer des rapports visuels avancés
async function generateVisualReport(results: BacktestResults, outputPath: string): Promise<void> {
  // Format de rapport avancé avec plus de métriques
  const report = {
    summary: {
      initialBalance: results.initialBalance,
      finalBalance: results.finalBalance,
      profit: results.profit,
      profitPercentage: results.profitPercentage,
      totalTrades: results.trades.length,
      winningTrades: results.winningTrades,
      losingTrades: results.losingTrades,
      winRate: results.winRate,
      profitFactor: results.profitFactor,
      maxDrawdown: results.maxDrawdown,
      maxDrawdownPercentage: results.maxDrawdownPercentage,
      averageWin: results.averageWin,
      averageLoss: results.averageLoss,
      averageExposure: results.averageExposure,
    },
    equityCurve: generateEquityCurveData(results),
    tradeDistribution: generateTradeDistribution(results),
    monthlyPerformance: generateMonthlyPerformance(results),
    drawdownPeriods: identifyDrawdownPeriods(results),
    strategiesComparison: compareStrategies(results),
    riskMetrics: calculateRiskMetrics(results)
  };

  // Sauvegarder le rapport complet
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  logger.info(`[TEST-ENHANCED-BACKTEST] Rapport détaillé sauvegardé dans ${outputPath}`);

  // Générer un rapport texte plus lisible
  const reportText = generateTextReport(report);
  fs.writeFileSync(outputPath.replace('.json', '.txt'), reportText);
  logger.info(`[TEST-ENHANCED-BACKTEST] Rapport texte sauvegardé dans ${outputPath.replace('.json', '.txt')}`);
}

// Génère les données de la courbe d'équité
function generateEquityCurveData(results: BacktestResults): any[] {
  const equityCurve = [];
  let balance = results.initialBalance;

  // Trier les trades par date
  const sortedTrades = [...results.trades].sort((a, b) => a.entryTime - b.entryTime);

  // Ajouter le point initial
  if (sortedTrades.length > 0) {
    equityCurve.push({
      timestamp: sortedTrades[0].entryTime - 86400000, // 1 jour avant le premier trade
      balance: balance,
      equity: balance,
      drawdown: 0,
      drawdownPct: 0
    });
  }

  // Établir l'équité maximale pour calculer le drawdown
  let maxEquity = balance;
  
  // Construire la courbe d'équité
  for (const trade of sortedTrades) {
    // Ajouter le point à l'entrée
    equityCurve.push({
      timestamp: trade.entryTime,
      balance: balance,
      equity: balance,
      drawdown: 0,
      drawdownPct: 0
    });

    // Mettre à jour la balance et l'équité maximum
    if (trade.exitTime) {
      balance += trade.profit;
      if (balance > maxEquity) {
        maxEquity = balance;
      }

      // Calculer le drawdown
      const drawdown = maxEquity - balance;
      const drawdownPct = drawdown / maxEquity * 100;

      // Ajouter le point à la sortie
      equityCurve.push({
        timestamp: trade.exitTime,
        balance: balance,
        equity: balance,
        drawdown: drawdown,
        drawdownPct: drawdownPct
      });
    }
  }

  return equityCurve;
}

// Génère la distribution des trades (profit, durée, etc.)
function generateTradeDistribution(results: BacktestResults): any {
  // Catégoriser les trades par taille de profit/perte
  const profitBins = [-Infinity, -10, -5, -3, -1, 0, 1, 3, 5, 10, Infinity].map(v => v / 100);
  const profitDistribution = Array(profitBins.length - 1).fill(0);

  // Distribution par durée (en heures)
  const durationBins = [0, 1, 4, 8, 24, 48, 72, 168, Infinity]; // heures
  const durationDistribution = Array(durationBins.length - 1).fill(0);

  for (const trade of results.trades) {
    if (trade.exitTime) {
      // Calculer le profit en pourcentage
      const profitPct = trade.profitPercentage / 100;
      
      // Trouver le bin pour ce profit
      for (let i = 0; i < profitBins.length - 1; i++) {
        if (profitPct >= profitBins[i] && profitPct < profitBins[i + 1]) {
          profitDistribution[i]++;
          break;
        }
      }
      
      // Calculer la durée en heures
      const durationHours = (trade.exitTime - trade.entryTime) / (1000 * 60 * 60);
      
      // Trouver le bin pour cette durée
      for (let i = 0; i < durationBins.length - 1; i++) {
        if (durationHours >= durationBins[i] && durationHours < durationBins[i + 1]) {
          durationDistribution[i]++;
          break;
        }
      }
    }
  }
  
  return {
    profitBins: profitBins.map(v => `${(v * 100).toFixed(1)}%`),
    profitDistribution,
    durationBins: durationBins.map(h => h === Infinity ? '>168h' : `${h}h`),
    durationDistribution
  };
}

// Génère la performance mensuelle
function generateMonthlyPerformance(results: BacktestResults): any {
  const monthlyPerf = new Map<string, { profit: number, trades: number, winRate: number }>();
  
  for (const trade of results.trades) {
    if (trade.exitTime) {
      const date = new Date(trade.exitTime);
      const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthlyPerf.has(monthYear)) {
        monthlyPerf.set(monthYear, { profit: 0, trades: 0, winRate: 0 });
      }
      
      const month = monthlyPerf.get(monthYear)!;
      month.profit += trade.profit;
      month.trades += 1;
      month.winRate = (month.winRate * (month.trades - 1) + (trade.profit > 0 ? 1 : 0)) / month.trades;
    }
  }
  
  // Convertir la Map en tableau pour JSON
  return Array.from(monthlyPerf.entries()).map(([month, data]) => ({
    month,
    profit: data.profit,
    trades: data.trades,
    winRate: data.winRate
  }));
}

// Identifie les périodes de drawdown significatives
function identifyDrawdownPeriods(results: BacktestResults): any[] {
  const drawdownPeriods = [];
  let inDrawdown = false;
  let drawdownStart = 0;
  let peakBalance = results.initialBalance;
  let currentBalance = results.initialBalance;
  let maxDrawdown = 0;
  
  // Trier les trades par date
  const sortedTrades = [...results.trades].sort((a, b) => a.entryTime - b.entryTime);
  
  for (const trade of sortedTrades) {
    if (trade.exitTime) {
      currentBalance += trade.profit;
      
      if (currentBalance > peakBalance) {
        // Nouveau pic, fin d'un éventuel drawdown
        if (inDrawdown) {
          drawdownPeriods.push({
            start: new Date(drawdownStart).toISOString(),
            end: new Date(trade.exitTime).toISOString(),
            drawdown: ((peakBalance - currentBalance + trade.profit) / peakBalance) * 100,
            duration: Math.round((trade.exitTime - drawdownStart) / (1000 * 60 * 60 * 24)) // jours
          });
          inDrawdown = false;
        }
        peakBalance = currentBalance;
      } else {
        // Potentiel drawdown
        const currentDrawdown = (peakBalance - currentBalance) / peakBalance;
        if (currentDrawdown > 0.02 && !inDrawdown) { // 2% de drawdown minimum
          inDrawdown = true;
          drawdownStart = trade.exitTime;
          maxDrawdown = currentDrawdown;
        } else if (inDrawdown && currentDrawdown > maxDrawdown) {
          maxDrawdown = currentDrawdown;
        }
      }
    }
  }
  
  // Si on est toujours en drawdown à la fin du backtest
  if (inDrawdown && sortedTrades.length > 0) {
    const lastTrade = sortedTrades[sortedTrades.length - 1];
    drawdownPeriods.push({
      start: new Date(drawdownStart).toISOString(),
      end: new Date(lastTrade.exitTime || lastTrade.entryTime).toISOString(),
      drawdown: ((peakBalance - currentBalance) / peakBalance) * 100,
      duration: Math.round((lastTrade.exitTime || lastTrade.entryTime - drawdownStart) / (1000 * 60 * 60 * 24))
    });
  }
  
  return drawdownPeriods;
}

// Compare les performances des différentes stratégies
function compareStrategies(results: BacktestResults): any {
  // S'assurer que les données de performance par stratégie existent
  if (!results.strategyPerformance) {
    return [];
  }
  
  return Object.entries(results.strategyPerformance).map(([id, perf]) => ({
    id,
    trades: perf.trades,
    winRate: perf.winRate,
    profit: perf.profit,
    profitFactor: perf.profitFactor
  }));
}

// Calcule des métriques de risque supplémentaires
function calculateRiskMetrics(results: BacktestResults): any {
  // Calculer des métriques supplémentaires
  const tradesWithExit = results.trades.filter(t => t.exitTime);
  
  // Sharpe Ratio approximatif (en supposant un taux sans risque de 0%)
  const returns = tradesWithExit.map(t => t.profitPercentage / 100);
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const stdReturn = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);
  const sharpeRatio = avgReturn / (stdReturn || 1);
  
  // Ratio Calmar (rendement annualisé / drawdown maximum)
  // Supposons que la période totale du backtest est d'un an pour simplifier
  const calmarRatio = results.profitPercentage / (results.maxDrawdownPercentage || 1);
  
  // Ratio de Sortino (rendement / volatilité négative)
  const negativeReturns = returns.filter(r => r < 0);
  const avgNegReturn = negativeReturns.reduce((sum, r) => sum + r, 0) / negativeReturns.length || 1;
  const stdNegReturn = Math.sqrt(negativeReturns.reduce((sum, r) => sum + Math.pow(r - avgNegReturn, 2), 0) / negativeReturns.length || 1);
  const sortinoRatio = avgReturn / (stdNegReturn || 1);
  
  // Fréquence des trades
  const tradeDays = tradesWithExit.length > 0 ? 
    (tradesWithExit[tradesWithExit.length - 1].exitTime - tradesWithExit[0].entryTime) / (1000 * 60 * 60 * 24) : 
    1;
  const tradesPerDay = tradesWithExit.length / (tradeDays || 1);
  
  return {
    sharpeRatio: sharpeRatio,
    calmarRatio: calmarRatio,
    sortinoRatio: sortinoRatio,
    tradesPerDay: tradesPerDay,
    averageTradeDuration: tradesWithExit.reduce((sum, t) => sum + (t.exitTime! - t.entryTime), 0) / (tradesWithExit.length * 1000 * 60 * 60) // en heures
  };
}

// Génère un rapport texte en format plus lisible
function generateTextReport(report: any): string {
  let text = "=== RAPPORT DE BACKTEST DÉTAILLÉ ===\n\n";
  
  text += "== RÉSUMÉ ==\n";
  text += `Balance initiale: $${report.summary.initialBalance.toFixed(2)}\n`;
  text += `Balance finale: $${report.summary.finalBalance.toFixed(2)}\n`;
  text += `Profit: $${report.summary.profit.toFixed(2)} (${report.summary.profitPercentage.toFixed(2)}%)\n`;
  text += `Nombre total de trades: ${report.summary.totalTrades}\n`;
  text += `Trades gagnants: ${report.summary.winningTrades} (${(report.summary.winRate * 100).toFixed(2)}%)\n`;
  text += `Trades perdants: ${report.summary.losingTrades} (${(100 - report.summary.winRate * 100).toFixed(2)}%)\n`;
  text += `Facteur de profit: ${report.summary.profitFactor.toFixed(2)}\n`;
  text += `Drawdown maximum: ${report.summary.maxDrawdownPercentage.toFixed(2)}% ($${report.summary.maxDrawdown.toFixed(2)})\n`;
  text += `Gain moyen: $${report.summary.averageWin.toFixed(2)}\n`;
  text += `Perte moyenne: $${report.summary.averageLoss.toFixed(2)}\n\n`;
  
  text += "== MÉTRIQUES DE RISQUE ==\n";
  text += `Ratio de Sharpe: ${report.riskMetrics.sharpeRatio.toFixed(2)}\n`;
  text += `Ratio de Calmar: ${report.riskMetrics.calmarRatio.toFixed(2)}\n`;
  text += `Ratio de Sortino: ${report.riskMetrics.sortinoRatio.toFixed(2)}\n`;
  text += `Trades par jour (moyenne): ${report.riskMetrics.tradesPerDay.toFixed(2)}\n`;
  text += `Durée moyenne des trades: ${report.riskMetrics.averageTradeDuration.toFixed(2)} heures\n\n`;
  
  text += "== PERFORMANCE PAR STRATÉGIE ==\n";
  for (const strat of report.strategiesComparison) {
    text += `${strat.id}:\n`;
    text += `  - Trades: ${strat.trades}\n`;
    text += `  - Taux de réussite: ${(strat.winRate * 100).toFixed(2)}%\n`;
    text += `  - Profit: $${strat.profit.toFixed(2)}\n`;
    text += `  - Facteur de profit: ${strat.profitFactor.toFixed(2)}\n\n`;
  }
  
  text += "== PERFORMANCE MENSUELLE ==\n";
  for (const month of report.monthlyPerformance) {
    text += `${month.month}: $${month.profit.toFixed(2)} (${month.trades} trades, ${(month.winRate * 100).toFixed(2)}% réussite)\n`;
  }
  text += "\n";
  
  text += "== PÉRIODES DE DRAWDOWN SIGNIFICATIVES ==\n";
  if (report.drawdownPeriods.length === 0) {
    text += "Aucune période de drawdown significative détectée.\n";
  } else {
    for (const dd of report.drawdownPeriods) {
      text += `Du ${dd.start.split('T')[0]} au ${dd.end.split('T')[0]}: ${dd.drawdown.toFixed(2)}% (${dd.duration} jours)\n`;
    }
  }
  
  return text;
}

// Fonction principale pour exécuter plusieurs variantes de stratégies
async function runBacktestVariations(): Promise<void> {
  // Configuration de base
  const baseConfig = {
    startDate: new Date('2023-01-01T00:00:00.000Z'),
    endDate: new Date('2023-03-01T00:00:00.000Z'), // Période plus longue
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
  
  // Stratégies optimisées à tester (variantes)
  const strategyVariations = [
    {
      name: "optimized_btc_trend",
      symbol: 'BTC_USD',
      shortPeriod: 7,
      longPeriod: 21,
      positionSize: 0.1,
      useBollinger: true,
      bollingerPeriod: 20,
      bollingerStdDev: 2,
      useMACD: true,
      macdFastPeriod: 6,
      macdSlowPeriod: 19,
      macdSignalPeriod: 9,
      useRSI: true,
      rsiPeriod: 14,
      rsiOversold: 42,
      rsiOverbought: 58
    },
    {
      name: "optimized_eth_trend",
      symbol: 'ETH_USD',
      shortPeriod: 5,
      longPeriod: 15,
      positionSize: 0.1,
      useBollinger: true,
      bollingerPeriod: 15,
      bollingerStdDev: 2.2,
      useMACD: true,
      macdFastPeriod: 7,
      macdSlowPeriod: 17,
      macdSignalPeriod: 7,
      useRSI: true,
      rsiPeriod: 10,
      rsiOversold: 40,
      rsiOverbought: 60
    },
    {
      name: "aggressive_btc_short",
      symbol: 'BTC_USD',
      shortPeriod: 3,
      longPeriod: 10,
      positionSize: 0.15,
      useBollinger: true,
      bollingerPeriod: 10,
      bollingerStdDev: 2.5,
      useMACD: true,
      macdFastPeriod: 5,
      macdSlowPeriod: 12,
      macdSignalPeriod: 4,
      useRSI: true,
      rsiPeriod: 7,
      rsiOversold: 35,
      rsiOverbought: 65
    }
  ];
  
  logger.info("[TEST-ENHANCED-BACKTEST] Démarrage des tests avec variations de stratégies");
  
  // Tester chaque variante de stratégie
  for (const strategyConfig of strategyVariations) {
    logger.info(`[TEST-ENHANCED-BACKTEST] Test de la stratégie "${strategyConfig.name}"`);
    
    // Créer la stratégie
    const strategy: Strategy = createSimpleMAStrategy({
      ...strategyConfig
    });
    
    // Créer le moteur de backtest pour cette variante
    const engine = new BacktestEngine(baseConfig);
    
    try {
      // Exécuter le backtest
      logger.info(`[TEST-ENHANCED-BACKTEST] Lancement du backtest pour ${strategyConfig.name}`);
      const results = await engine.run([strategy]);
      
      // Générer un rapport détaillé pour cette stratégie
      const reportPath = path.resolve(process.cwd(), `enhanced-backtest-${strategyConfig.name}-results.json`);
      await generateVisualReport(results, reportPath);
      
      // Afficher les résultats clés
      logger.info(`[TEST-ENHANCED-BACKTEST] Résultats pour ${strategyConfig.name}`, {
        finalBalance: results.finalBalance,
        profit: results.profit,
        profitPercentage: results.profitPercentage,
        totalTrades: results.trades.length,
        winRate: results.winRate,
        profitFactor: results.profitFactor
      });
      
      // Générer le rapport de backtest standard
      const reportText = await engine.generateReport();
      fs.writeFileSync(
        path.resolve(process.cwd(), `enhanced-backtest-${strategyConfig.name}-report.txt`),
        reportText
      );
      
    } catch (error) {
      logger.error(`[TEST-ENHANCED-BACKTEST] Erreur lors du test de ${strategyConfig.name}`, 
        error instanceof Error ? error.message : String(error));
    }
  }
  
  logger.info("[TEST-ENHANCED-BACKTEST] Tous les tests sont terminés");
}

// Exécuter les backtests avec variations
runBacktestVariations().catch(err => {
  logger.error("[TEST-ENHANCED-BACKTEST] Erreur non gérée", err);
  process.exit(1);
});
