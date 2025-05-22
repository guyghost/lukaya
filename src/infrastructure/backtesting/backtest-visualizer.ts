// backtest-visualizer.ts - Module pour générer des visualisations et graphiques des résultats de backtest
import * as fs from 'fs';
import * as path from 'path';
import { BacktestResults, BacktestTrade } from './backtest-models';
import { getLogger } from '../../infrastructure/logger';

const logger = getLogger();

/**
 * Interface pour la configuration des options de visualisation
 */
export interface VisualizationOptions {
  /** Sauvegarder les données pour visualisation dans un fichier HTML */
  outputHtmlPath?: string;
  /** Sauvegarder les données pour visualisation dans un fichier JSON */
  outputJsonPath?: string;
  /** Générer la courbe d'équité */
  includeEquityCurve?: boolean;
  /** Générer la distribution des trades */
  includeTradeDistribution?: boolean;
  /** Générer la comparaison des stratégies */
  includeStrategiesComparison?: boolean;
  /** Générer la heatmap des performances mensuelles */
  includeMonthlyHeatmap?: boolean;
  /** Générer les métriques de risque */
  includeRiskMetrics?: boolean;
}

/**
 * Classe pour générer des visualisations des résultats de backtest
 */
export class BacktestVisualizer {
  private results: BacktestResults;
  private options: VisualizationOptions;
  private logger = getLogger();

  constructor(results: BacktestResults, options: VisualizationOptions = {}) {
    this.results = results;
    this.options = {
      includeEquityCurve: true,
      includeTradeDistribution: true,
      includeStrategiesComparison: true,
      includeMonthlyHeatmap: true,
      includeRiskMetrics: true,
      ...options
    };
  }

  /**
   * Génère toutes les visualisations configurées
   */
  public async generateVisualizations(): Promise<any> {
    this.logger.info("[BACKTEST-VISUALIZER] Génération des visualisations de backtest");
    
    const visualizationData: any = {
      summary: this.generateSummary(),
    };
    
    if (this.options.includeEquityCurve) {
      visualizationData.equityCurve = this.generateEquityCurveData();
    }
    
    if (this.options.includeTradeDistribution) {
      visualizationData.tradeDistribution = this.generateTradeDistribution();
    }
    
    if (this.options.includeStrategiesComparison) {
      visualizationData.strategiesComparison = this.generateStrategiesComparison();
    }
    
    if (this.options.includeMonthlyHeatmap) {
      visualizationData.monthlyPerformance = this.generateMonthlyPerformance();
    }
    
    if (this.options.includeRiskMetrics) {
      visualizationData.riskMetrics = this.calculateRiskMetrics();
    }

    // Ajouter des statistiques supplémentaires avancées
    visualizationData.advancedStats = this.generateAdvancedStatistics();
    
    // Sauvegarder les données de visualisation au format JSON
    if (this.options.outputJsonPath) {
      fs.writeFileSync(this.options.outputJsonPath, JSON.stringify(visualizationData, null, 2));
      this.logger.info(`[BACKTEST-VISUALIZER] Données de visualisation sauvegardées dans ${this.options.outputJsonPath}`);
    }
    
    // Générer le HTML avec les visualisations intégrées
    if (this.options.outputHtmlPath) {
      const html = this.generateHTML(visualizationData);
      fs.writeFileSync(this.options.outputHtmlPath, html);
      this.logger.info(`[BACKTEST-VISUALIZER] Rapport HTML sauvegardé dans ${this.options.outputHtmlPath}`);
    }
    
    return visualizationData;
  }

  /**
   * Génère un résumé des résultats du backtest
   */
  private generateSummary(): any {
    return {
      initialBalance: this.results.initialBalance,
      finalBalance: this.results.finalBalance,
      profit: this.results.profit,
      profitPercentage: this.results.profitPercentage,
      totalTrades: this.results.trades.length,
      winningTrades: this.results.winningTrades,
      losingTrades: this.results.losingTrades,
      winRate: this.results.winRate,
      largestWin: this.results.largestWin,
      largestLoss: this.results.largestLoss,
      averageWin: this.results.averageWin,
      averageLoss: this.results.averageLoss,
      profitFactor: this.results.profitFactor,
      maxDrawdown: this.results.maxDrawdown,
      maxDrawdownPercentage: this.results.maxDrawdownPercentage,
    };
  }

  /**
   * Génère les données pour la courbe d'équité
   */
  private generateEquityCurveData(): any[] {
    const equityCurve = [];
    let balance = this.results.initialBalance;

    // Trier les trades par date d'entrée
    const sortedTrades = [...this.results.trades].sort((a, b) => a.entryTime - b.entryTime);

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

    // Variables pour suivre le drawdown
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

      if (trade.exitTime) {
        // Mise à jour du solde après la clôture du trade
        balance += trade.profit;
        
        // Mettre à jour l'équité maximale et calculer le drawdown
        if (balance > maxEquity) {
          maxEquity = balance;
        }
        
        const drawdown = maxEquity - balance;
        const drawdownPct = drawdown / maxEquity * 100;

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

  /**
   * Génère la distribution des trades (par profit/perte et durée)
   */
  private generateTradeDistribution(): any {
    // Distribution par taille de profit/perte (en pourcentage)
    const profitBins = [-Infinity, -10, -5, -3, -2, -1, 0, 1, 2, 3, 5, 10, Infinity];
    const profitDistribution = Array(profitBins.length - 1).fill(0);
    
    // Distribution par durée (en heures)
    const durationBins = [0, 1, 2, 4, 8, 12, 24, 48, 72, 168, 336, Infinity];
    const durationDistribution = Array(durationBins.length - 1).fill(0);
    
    // Distribution par symbole
    const symbolDistribution = new Map<string, { count: number, profit: number, winCount: number }>();
    
    // Distribution par période de la journée
    const hourOfDayDistribution = Array(24).fill(0);
    
    for (const trade of this.results.trades) {
      if (trade.exitTime) {
        // Profit en pourcentage
        const profitPct = trade.profitPercentage;
        
        // Trouver le bin approprié pour ce profit
        for (let i = 0; i < profitBins.length - 1; i++) {
          if (profitPct >= profitBins[i] && profitPct < profitBins[i + 1]) {
            profitDistribution[i]++;
            break;
          }
        }
        
        // Durée en heures
        const durationHrs = (trade.exitTime - trade.entryTime) / (1000 * 60 * 60);
        
        // Trouver le bin approprié pour cette durée
        for (let i = 0; i < durationBins.length - 1; i++) {
          if (durationHrs >= durationBins[i] && durationHrs < durationBins[i + 1]) {
            durationDistribution[i]++;
            break;
          }
        }
        
        // Statistiques par symbole
        const symbolStats = symbolDistribution.get(trade.symbol) || { count: 0, profit: 0, winCount: 0 };
        symbolStats.count++;
        symbolStats.profit += trade.profit;
        if (trade.profit > 0) symbolStats.winCount++;
        symbolDistribution.set(trade.symbol, symbolStats);
        
        // Statistiques par heure d'entrée
        const entryHour = new Date(trade.entryTime).getUTCHours();
        hourOfDayDistribution[entryHour]++;
      }
    }
    
    return {
      profitBins: profitBins.map(v => v === Infinity ? '>10%' : v === -Infinity ? '<-10%' : `${v}%`),
      profitDistribution,
      durationBins: durationBins.map(h => h === Infinity ? '>336h' : `${h}h`),
      durationDistribution,
      bySymbol: Array.from(symbolDistribution.entries()).map(([symbol, stats]) => ({
        symbol,
        trades: stats.count,
        profit: stats.profit,
        winRate: stats.count > 0 ? stats.winCount / stats.count : 0
      })),
      byHourOfDay: hourOfDayDistribution.map((count, hour) => ({ hour, count }))
    };
  }

  /**
   * Génère la comparaison des différentes stratégies
   */
  private generateStrategiesComparison(): any {
    // S'assurer que les performances par stratégie existent
    if (!this.results.strategyPerformance) {
      return [];
    }
    
    return Object.entries(this.results.strategyPerformance).map(([id, perf]) => ({
      id,
      trades: perf.trades,
      winningTrades: perf.winningTrades,
      losingTrades: perf.losingTrades,
      winRate: perf.winRate,
      profit: perf.profit,
      profitFactor: perf.profitFactor
    }));
  }

  /**
   * Génère une analyse des performances par mois
   */
  private generateMonthlyPerformance(): any {
    // Utiliser un Map pour stocker les performances par mois
    const monthlyData = new Map<string, { profit: number, trades: number, winCount: number }>();
    
    // Parcourir tous les trades
    for (const trade of this.results.trades) {
      if (trade.exitTime) {
        const date = new Date(trade.exitTime);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        // Récupérer ou initialiser les données pour ce mois
        const monthStats = monthlyData.get(monthKey) || { profit: 0, trades: 0, winCount: 0 };
        
        // Mettre à jour les statistiques
        monthStats.profit += trade.profit;
        monthStats.trades++;
        if (trade.profit > 0) monthStats.winCount++;
        
        monthlyData.set(monthKey, monthStats);
      }
    }
    
    // Convertir en tableau pour le JSON
    return Array.from(monthlyData.entries()).map(([month, stats]) => ({
      month,
      profit: stats.profit,
      profitPercentage: (stats.profit / this.results.initialBalance) * 100,
      trades: stats.trades,
      winRate: stats.trades > 0 ? stats.winCount / stats.trades : 0
    }));
  }

  /**
   * Calcule des métriques de risque avancées
   */
  private calculateRiskMetrics(): any {
    // Sélectionner uniquement les trades clôturés
    const completedTrades = this.results.trades.filter(t => t.exitTime);
    
    if (completedTrades.length === 0) {
      return {
        sharpeRatio: 0,
        calmarRatio: 0,
        sortinoRatio: 0
      };
    }
    
    // Calculer les rendements des trades
    const returns = completedTrades.map(t => t.profitPercentage / 100);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    
    // Écart-type des rendements (pour Sharpe)
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    // Sharpe Ratio (en supposant un taux sans risque de 0%)
    const sharpeRatio = stdDev !== 0 ? avgReturn / stdDev : 0;
    
    // Ratio de Calmar (rendement / drawdown maximum)
    const calmarRatio = this.results.maxDrawdownPercentage > 0 ? 
      this.results.profitPercentage / this.results.maxDrawdownPercentage : 0;
    
    // Calculer l'écart-type des rendements négatifs uniquement (pour Sortino)
    const negativeReturns = returns.filter(r => r < 0);
    let sortinoRatio = 0;
    
    if (negativeReturns.length > 0) {
      const avgNegReturn = negativeReturns.reduce((sum, r) => sum + r, 0) / negativeReturns.length;
      const negVariance = negativeReturns.reduce((sum, r) => sum + Math.pow(r - avgNegReturn, 2), 0) / negativeReturns.length;
      const negStdDev = Math.sqrt(negVariance);
      
      // Sortino Ratio
      sortinoRatio = negStdDev !== 0 ? avgReturn / negStdDev : 0;
    }
    
    // Calculer le temps moyen dans le marché
    let totalMarketTime = 0;
    let totalBacktestTime = 0;
    
    if (completedTrades.length > 0) {
      // Trier les trades par date
      const sortedTrades = [...completedTrades].sort((a, b) => a.entryTime - b.entryTime);
      
      // Calculer la durée totale du backtest
      totalBacktestTime = sortedTrades[sortedTrades.length - 1].exitTime! - sortedTrades[0].entryTime;
      
      // Calculer le temps total passé en position
      totalMarketTime = completedTrades.reduce((sum, t) => sum + (t.exitTime! - t.entryTime), 0);
    }
    
    // Pourcentage du temps passé en position
    const marketExposure = totalBacktestTime > 0 ? totalMarketTime / totalBacktestTime : 0;
    
    return {
      sharpeRatio,
      calmarRatio,
      sortinoRatio,
      marketExposure,
      // Ratio Gain/Loss moyen (Average Win / Average Loss)
      gainLossRatio: Math.abs(this.results.averageLoss) > 0 ? 
        this.results.averageWin / Math.abs(this.results.averageLoss) : 0,
      // Espérance mathématique: winRate * avgWin - (1-winRate) * |avgLoss|
      expectancy: (this.results.winRate * this.results.averageWin) - 
        ((1 - this.results.winRate) * Math.abs(this.results.averageLoss))
    };
  }

  /**
   * Génère des statistiques avancées
   */
  private generateAdvancedStatistics(): any {
    // Consécutifs
    const consecutiveStats = this.calculateConsecutiveStats();
    
    // Distribution des trades dans le temps
    const timeDistribution = this.calculateTimeDistribution();
    
    // Corrélation entre taille des pertes et profits suivants
    const recoveryStats = this.calculateRecoveryStats();
    
    return {
      consecutive: consecutiveStats,
      timeDistribution,
      recovery: recoveryStats
    };
  }

  /**
   * Calcule les statistiques de trades consécutifs
   */
  private calculateConsecutiveStats(): any {
    if (this.results.trades.length === 0) return { maxConsecutiveWins: 0, maxConsecutiveLosses: 0 };
    
    // Trier les trades par date de sortie
    const sortedTrades = [...this.results.trades]
      .filter(t => t.exitTime)
      .sort((a, b) => (a.exitTime || 0) - (b.exitTime || 0));
    
    let currentWins = 0;
    let currentLosses = 0;
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    
    for (const trade of sortedTrades) {
      if (trade.profit > 0) {
        // Trade gagnant
        currentWins++;
        currentLosses = 0;
        maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWins);
      } else {
        // Trade perdant
        currentLosses++;
        currentWins = 0;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLosses);
      }
    }
    
    return {
      maxConsecutiveWins,
      maxConsecutiveLosses
    };
  }

  /**
   * Calcule la distribution des trades dans le temps
   */
  private calculateTimeDistribution(): any {
    const tradesByDay = new Map<string, number>();
    const tradesByHour = Array(24).fill(0);
    const tradesByDayOfWeek = Array(7).fill(0);
    
    for (const trade of this.results.trades) {
      if (trade.entryTime) {
        const date = new Date(trade.entryTime);
        
        // Par jour
        const dayKey = date.toISOString().split('T')[0];
        tradesByDay.set(dayKey, (tradesByDay.get(dayKey) || 0) + 1);
        
        // Par heure
        const hour = date.getUTCHours();
        tradesByHour[hour]++;
        
        // Par jour de la semaine (0 = Dimanche, 6 = Samedi)
        const dayOfWeek = date.getUTCDay();
        tradesByDayOfWeek[dayOfWeek]++;
      }
    }
    
    // Calculer la densité moyenne de trades par jour
    const uniqueDays = tradesByDay.size;
    const avgTradesPerDay = uniqueDays > 0 ? this.results.trades.length / uniqueDays : 0;
    
    return {
      byHour: tradesByHour,
      byDayOfWeek: tradesByDayOfWeek,
      avgTradesPerDay,
      mostActiveHour: tradesByHour.indexOf(Math.max(...tradesByHour)),
      mostActiveDayOfWeek: tradesByDayOfWeek.indexOf(Math.max(...tradesByDayOfWeek))
    };
  }

  /**
   * Calcule les statistiques de récupération après pertes
   */
  private calculateRecoveryStats(): any {
    // Trier les trades par date de sortie
    const sortedTrades = [...this.results.trades]
      .filter(t => t.exitTime)
      .sort((a, b) => (a.exitTime || 0) - (b.exitTime || 0));
    
    if (sortedTrades.length < 2) return { avgRecoveryTrades: 0, maxRecoveryTrades: 0 };
    
    let recoveryPeriods: number[] = [];
    let currentRecovery = 0;
    let inRecovery = false;
    let peakEquity = this.results.initialBalance;
    let currentEquity = this.results.initialBalance;
    
    for (const trade of sortedTrades) {
      // Mettre à jour l'équité
      currentEquity += trade.profit;
      
      if (currentEquity > peakEquity) {
        // Nouveau sommet, fin de période de récupération
        if (inRecovery) {
          recoveryPeriods.push(currentRecovery);
          inRecovery = false;
          currentRecovery = 0;
        }
        peakEquity = currentEquity;
      } else if (trade.profit < 0 && currentEquity < peakEquity) {
        // Perte qui nous met en période de récupération
        if (!inRecovery) {
          inRecovery = true;
          currentRecovery = 1;
        } else {
          currentRecovery++;
        }
      } else if (inRecovery) {
        // On est en période de récupération, mais ce trade ne nous a pas ramené au sommet
        currentRecovery++;
      }
    }
    
    // Si on termine en période de récupération, l'ajouter
    if (inRecovery) {
      recoveryPeriods.push(currentRecovery);
    }
    
    // Calculer les statistiques
    const avgRecoveryTrades = recoveryPeriods.length > 0 ? 
      recoveryPeriods.reduce((sum, period) => sum + period, 0) / recoveryPeriods.length : 0;
    
    const maxRecoveryTrades = recoveryPeriods.length > 0 ?
      Math.max(...recoveryPeriods) : 0;
    
    return {
      avgRecoveryTrades,
      maxRecoveryTrades,
      recoveryPeriods: recoveryPeriods.length,
    };
  }

  /**
   * Génère le HTML avec les visualisations
   */
  private generateHTML(data: any): string {
    // Base HTML avec un design moderne
    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Lukaya Backtest Report</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.2.3/dist/css/bootstrap.min.css" rel="stylesheet">
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <style>
        body { background-color: #f8f9fa; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        .dashboard-card { background-color: white; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 20px; padding: 20px; }
        .metrics-container { display: flex; flex-wrap: wrap; }
        .metric-box { flex: 1 0 30%; padding: 10px; margin: 5px; background-color: #f8f9fa; border-radius: 5px; text-align: center; }
        .positive { color: #28a745; }
        .negative { color: #dc3545; }
        h1, h2 { color: #343a40; }
        .chart-container { position: relative; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container py-4">
        <h1 class="text-center mb-4">Lukaya Backtest Report</h1>
        
        <!-- Summary Section -->
        <div class="dashboard-card">
          <h2>Performance Summary</h2>
          <div class="metrics-container">
            <div class="metric-box">
              <h5>Initial Balance</h5>
              <p>$${data.summary.initialBalance.toFixed(2)}</p>
            </div>
            <div class="metric-box">
              <h5>Final Balance</h5>
              <p>$${data.summary.finalBalance.toFixed(2)}</p>
            </div>
            <div class="metric-box">
              <h5>Profit/Loss</h5>
              <p class="${data.summary.profit >= 0 ? 'positive' : 'negative'}">
                $${data.summary.profit.toFixed(2)} (${data.summary.profitPercentage.toFixed(2)}%)
              </p>
            </div>
            <div class="metric-box">
              <h5>Total Trades</h5>
              <p>${data.summary.totalTrades}</p>
            </div>
            <div class="metric-box">
              <h5>Win Rate</h5>
              <p>${(data.summary.winRate * 100).toFixed(2)}%</p>
            </div>
            <div class="metric-box">
              <h5>Profit Factor</h5>
              <p>${data.summary.profitFactor.toFixed(2)}</p>
            </div>
            <div class="metric-box">
              <h5>Max Drawdown</h5>
              <p class="negative">${data.summary.maxDrawdownPercentage.toFixed(2)}%</p>
            </div>
            <div class="metric-box">
              <h5>Avg Win</h5>
              <p class="positive">$${data.summary.averageWin.toFixed(2)}</p>
            </div>
            <div class="metric-box">
              <h5>Avg Loss</h5>
              <p class="negative">$${data.summary.averageLoss.toFixed(2)}</p>
            </div>
          </div>
        </div>
        
        <!-- Equity Curve -->
        <div class="dashboard-card">
          <h2>Equity Curve</h2>
          <div class="chart-container">
            <canvas id="equityCurveChart"></canvas>
          </div>
        </div>
        
        <!-- Trade Distribution -->
        <div class="dashboard-card">
          <h2>Trade Distribution</h2>
          <div class="row">
            <div class="col-md-6">
              <h4>By Profit/Loss</h4>
              <div class="chart-container">
                <canvas id="profitDistributionChart"></canvas>
              </div>
            </div>
            <div class="col-md-6">
              <h4>By Duration</h4>
              <div class="chart-container">
                <canvas id="durationDistributionChart"></canvas>
              </div>
            </div>
          </div>
          <div class="row mt-4">
            <div class="col-md-6">
              <h4>By Hour of Day</h4>
              <div class="chart-container">
                <canvas id="hourDistributionChart"></canvas>
              </div>
            </div>
            <div class="col-md-6">
              <h4>By Symbol</h4>
              <div class="chart-container">
                <canvas id="symbolDistributionChart"></canvas>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Risk Metrics -->
        <div class="dashboard-card">
          <h2>Risk Metrics</h2>
          <div class="metrics-container">
            <div class="metric-box">
              <h5>Sharpe Ratio</h5>
              <p>${data.riskMetrics?.sharpeRatio.toFixed(2) || 'N/A'}</p>
            </div>
            <div class="metric-box">
              <h5>Sortino Ratio</h5>
              <p>${data.riskMetrics?.sortinoRatio.toFixed(2) || 'N/A'}</p>
            </div>
            <div class="metric-box">
              <h5>Calmar Ratio</h5>
              <p>${data.riskMetrics?.calmarRatio.toFixed(2) || 'N/A'}</p>
            </div>
            <div class="metric-box">
              <h5>Market Exposure</h5>
              <p>${(data.riskMetrics?.marketExposure * 100).toFixed(2) || 'N/A'}%</p>
            </div>
            <div class="metric-box">
              <h5>Gain/Loss Ratio</h5>
              <p>${data.riskMetrics?.gainLossRatio.toFixed(2) || 'N/A'}</p>
            </div>
            <div class="metric-box">
              <h5>Expectancy</h5>
              <p class="${(data.riskMetrics?.expectancy || 0) >= 0 ? 'positive' : 'negative'}">
                $${data.riskMetrics?.expectancy.toFixed(2) || 'N/A'}
              </p>
            </div>
          </div>
        </div>
        
        <!-- Monthly Performance -->
        <div class="dashboard-card">
          <h2>Monthly Performance</h2>
          <div class="chart-container">
            <canvas id="monthlyPerformanceChart"></canvas>
          </div>
        </div>
        
        <!-- Advanced Statistics -->
        <div class="dashboard-card">
          <h2>Advanced Statistics</h2>
          <div class="row">
            <div class="col-md-4">
              <h4>Consecutive Trades</h4>
              <div class="metrics-container">
                <div class="metric-box">
                  <h5>Max Consecutive Wins</h5>
                  <p>${data.advancedStats?.consecutive?.maxConsecutiveWins || 'N/A'}</p>
                </div>
                <div class="metric-box">
                  <h5>Max Consecutive Losses</h5>
                  <p>${data.advancedStats?.consecutive?.maxConsecutiveLosses || 'N/A'}</p>
                </div>
              </div>
            </div>
            <div class="col-md-4">
              <h4>Time Distribution</h4>
              <div class="metrics-container">
                <div class="metric-box">
                  <h5>Avg Trades Per Day</h5>
                  <p>${data.advancedStats?.timeDistribution?.avgTradesPerDay.toFixed(2) || 'N/A'}</p>
                </div>
                <div class="metric-box">
                  <h5>Most Active Hour</h5>
                  <p>${data.advancedStats?.timeDistribution?.mostActiveHour || 'N/A'}:00 UTC</p>
                </div>
              </div>
            </div>
            <div class="col-md-4">
              <h4>Recovery Stats</h4>
              <div class="metrics-container">
                <div class="metric-box">
                  <h5>Avg Recovery Trades</h5>
                  <p>${data.advancedStats?.recovery?.avgRecoveryTrades.toFixed(2) || 'N/A'}</p>
                </div>
                <div class="metric-box">
                  <h5>Max Recovery Trades</h5>
                  <p>${data.advancedStats?.recovery?.maxRecoveryTrades || 'N/A'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <script>
        // Charger les données de visualisation
        const visualizationData = ${JSON.stringify(data)};
        
        // Fonction pour formater les dates
        function formatDate(timestamp) {
          return new Date(timestamp).toLocaleDateString();
        }
        
        // Fonction pour générer une couleur aléatoire
        function getRandomColor() {
          const letters = '0123456789ABCDEF';
          let color = '#';
          for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
          }
          return color;
        }
        
        // Charger les graphiques quand le document est prêt
        document.addEventListener('DOMContentLoaded', function() {
          // Graphique de la courbe d'équité
          if (visualizationData.equityCurve && visualizationData.equityCurve.length > 0) {
            const equityCurveCtx = document.getElementById('equityCurveChart').getContext('2d');
            new Chart(equityCurveCtx, {
              type: 'line',
              data: {
                labels: visualizationData.equityCurve.map(point => formatDate(point.timestamp)),
                datasets: [
                  {
                    label: 'Equity',
                    data: visualizationData.equityCurve.map(point => point.balance),
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'rgba(75, 192, 192, 0.1)',
                    fill: true,
                    tension: 0.1
                  },
                  {
                    label: 'Drawdown',
                    data: visualizationData.equityCurve.map(point => -point.drawdown),
                    borderColor: 'rgba(255, 99, 132, 1)',
                    backgroundColor: 'rgba(255, 99, 132, 0.1)',
                    fill: true,
                    tension: 0.1,
                    yAxisID: 'y1'
                  }
                ]
              },
              options: {
                responsive: true,
                scales: {
                  x: {
                    title: {
                      display: true,
                      text: 'Date'
                    }
                  },
                  y: {
                    beginAtZero: false,
                    title: {
                      display: true,
                      text: 'Balance ($)'
                    }
                  },
                  y1: {
                    position: 'right',
                    beginAtZero: true,
                    max: 0,
                    title: {
                      display: true,
                      text: 'Drawdown ($)'
                    }
                  }
                }
              }
            });
          }
          
          // Graphique de distribution des profits/pertes
          if (visualizationData.tradeDistribution) {
            const profitDistCtx = document.getElementById('profitDistributionChart').getContext('2d');
            new Chart(profitDistCtx, {
              type: 'bar',
              data: {
                labels: visualizationData.tradeDistribution.profitBins,
                datasets: [{
                  label: 'Number of Trades',
                  data: visualizationData.tradeDistribution.profitDistribution,
                  backgroundColor: visualizationData.tradeDistribution.profitBins.map((bin, i) => {
                    // Rouge pour les pertes, vert pour les gains
                    const binValue = parseFloat(bin.replace('%', ''));
                    return binValue < 0 ? 'rgba(255, 99, 132, 0.7)' : 'rgba(75, 192, 192, 0.7)';
                  })
                }]
              },
              options: {
                responsive: true,
                scales: {
                  x: {
                    title: {
                      display: true,
                      text: 'Profit/Loss (%)'
                    }
                  },
                  y: {
                    beginAtZero: true,
                    title: {
                      display: true,
                      text: 'Number of Trades'
                    }
                  }
                }
              }
            });
            
            // Graphique de distribution de durée
            const durationDistCtx = document.getElementById('durationDistributionChart').getContext('2d');
            new Chart(durationDistCtx, {
              type: 'bar',
              data: {
                labels: visualizationData.tradeDistribution.durationBins,
                datasets: [{
                  label: 'Number of Trades',
                  data: visualizationData.tradeDistribution.durationDistribution,
                  backgroundColor: 'rgba(153, 102, 255, 0.7)'
                }]
              },
              options: {
                responsive: true,
                scales: {
                  x: {
                    title: {
                      display: true,
                      text: 'Trade Duration'
                    }
                  },
                  y: {
                    beginAtZero: true,
                    title: {
                      display: true,
                      text: 'Number of Trades'
                    }
                  }
                }
              }
            });
            
            // Graphique de distribution par heure du jour
            const hourDistCtx = document.getElementById('hourDistributionChart').getContext('2d');
            new Chart(hourDistCtx, {
              type: 'bar',
              data: {
                labels: visualizationData.tradeDistribution.byHourOfDay.map(d => d.hour + ':00'),
                datasets: [{
                  label: 'Number of Trades',
                  data: visualizationData.tradeDistribution.byHourOfDay.map(d => d.count),
                  backgroundColor: 'rgba(54, 162, 235, 0.7)'
                }]
              },
              options: {
                responsive: true,
                scales: {
                  x: {
                    title: {
                      display: true,
                      text: 'Hour of Day (UTC)'
                    }
                  },
                  y: {
                    beginAtZero: true,
                    title: {
                      display: true,
                      text: 'Number of Trades'
                    }
                  }
                }
              }
            });
            
            // Graphique de distribution par symbole
            if (visualizationData.tradeDistribution.bySymbol) {
              const symbolDistCtx = document.getElementById('symbolDistributionChart').getContext('2d');
              new Chart(symbolDistCtx, {
                type: 'bar',
                data: {
                  labels: visualizationData.tradeDistribution.bySymbol.map(s => s.symbol),
                  datasets: [
                    {
                      label: 'Number of Trades',
                      data: visualizationData.tradeDistribution.bySymbol.map(s => s.trades),
                      backgroundColor: 'rgba(255, 159, 64, 0.7)',
                      order: 2
                    },
                    {
                      label: 'Win Rate',
                      data: visualizationData.tradeDistribution.bySymbol.map(s => s.winRate * 100),
                      borderColor: 'rgba(75, 192, 192, 1)',
                      backgroundColor: 'rgba(75, 192, 192, 0.7)',
                      type: 'line',
                      order: 1,
                      yAxisID: 'y1'
                    }
                  ]
                },
                options: {
                  responsive: true,
                  scales: {
                    x: {
                      title: {
                        display: true,
                        text: 'Symbol'
                      }
                    },
                    y: {
                      beginAtZero: true,
                      title: {
                        display: true,
                        text: 'Number of Trades'
                      }
                    },
                    y1: {
                      beginAtZero: true,
                      max: 100,
                      position: 'right',
                      title: {
                        display: true,
                        text: 'Win Rate (%)'
                      }
                    }
                  }
                }
              });
            }
          }
          
          // Graphique de performance mensuelle
          if (visualizationData.monthlyPerformance && visualizationData.monthlyPerformance.length > 0) {
            const monthlyPerfCtx = document.getElementById('monthlyPerformanceChart').getContext('2d');
            new Chart(monthlyPerfCtx, {
              type: 'bar',
              data: {
                labels: visualizationData.monthlyPerformance.map(m => m.month),
                datasets: [
                  {
                    label: 'Monthly Profit/Loss ($)',
                    data: visualizationData.monthlyPerformance.map(m => m.profit),
                    backgroundColor: visualizationData.monthlyPerformance.map(m => 
                      m.profit >= 0 ? 'rgba(75, 192, 192, 0.7)' : 'rgba(255, 99, 132, 0.7)'
                    )
                  },
                  {
                    label: 'Win Rate (%)',
                    data: visualizationData.monthlyPerformance.map(m => m.winRate * 100),
                    borderColor: 'rgba(54, 162, 235, 1)',
                    backgroundColor: 'rgba(54, 162, 235, 0.1)',
                    type: 'line',
                    yAxisID: 'y1'
                  }
                ]
              },
              options: {
                responsive: true,
                scales: {
                  x: {
                    title: {
                      display: true,
                      text: 'Month'
                    }
                  },
                  y: {
                    title: {
                      display: true,
                      text: 'Profit/Loss ($)'
                    }
                  },
                  y1: {
                    beginAtZero: true,
                    max: 100,
                    position: 'right',
                    title: {
                      display: true,
                      text: 'Win Rate (%)'
                    }
                  }
                }
              }
            });
          }
        });
      </script>
      
    </body>
    </html>
    `;
    
    return html;
  }
}
