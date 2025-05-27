import { BacktestController } from '../../backtest/controllers/backtest.controller';
import { BacktestService } from '../../backtest/services/backtest.service';
import { BacktestConfig, BacktestResult } from '../../backtest/models/backtest.model';
import { Strategy } from '../../domain/models/strategy.model';
import { createContextualLogger } from '../../infrastructure/logging/enhanced-logger';

/**
 * Adaptateur pour l'interface utilisateur de backtesting
 * Peut être utilisé avec une interface web ou en ligne de commande
 */
export class BacktestUiAdapter {
  private logger = createContextualLogger('BacktestUiAdapter');
  private backtestController: BacktestController;
  private strategyService: any; // Service qui gère les stratégies disponibles
  
  constructor(strategyService: any) {
    const backtestService = new BacktestService();
    this.backtestController = new BacktestController(backtestService);
    this.strategyService = strategyService;
  }
  
  /**
   * Liste toutes les stratégies disponibles pour le backtesting
   */
  getAvailableStrategies(): Array<{ id: string; name: string; description?: string }> {
    const strategies = this.strategyService.getAllStrategies();
    return Object.values(strategies).map((strategy: unknown) => {
      const typedStrategy = strategy as Strategy;
      const config = typedStrategy.getConfig();
      return {
        id: typedStrategy.getId(),
        name: typedStrategy.getName(),
        description: config.description
      };
    });
  }
  
  /**
   * Exécute un backtest pour une stratégie spécifique
   */
  async runBacktest(strategyId: string, config: BacktestConfig): Promise<BacktestResult> {
    this.logger.info(`Exécution du backtest pour la stratégie ${strategyId}`);
    
    const strategy = this.strategyService.getStrategyById(strategyId);
    if (!strategy) {
      throw new Error(`Stratégie non trouvée avec l'ID: ${strategyId}`);
    }
    
    return this.backtestController.runBacktest(strategy, config);
  }
  
  /**
   * Compare les performances de plusieurs stratégies
   */
  async compareStrategies(
    strategyIds: string[], 
    config: BacktestConfig
  ): Promise<BacktestResult[]> {
    this.logger.info(`Comparaison de ${strategyIds.length} stratégies`);
    
    const strategies: Strategy[] = [];
    
    for (const id of strategyIds) {
      const strategy = this.strategyService.getStrategyById(id);
      if (strategy) {
        strategies.push(strategy);
      } else {
        this.logger.warn(`Stratégie non trouvée avec l'ID: ${id}`);
      }
    }
    
    if (strategies.length === 0) {
      throw new Error('Aucune stratégie valide trouvée');
    }
    
    return this.backtestController.compareStrategies(strategies, config);
  }
  
  /**
   * Optimise les paramètres d'une stratégie
   */
  async optimizeStrategy(
    strategyId: string,
    config: BacktestConfig,
    parameterRanges: Record<string, any[]>
  ): Promise<{
    bestParameters: Record<string, any>;
    bestResult: BacktestResult;
    allResults: Array<{ parameters: Record<string, any>; result: BacktestResult }>;
  }> {
    this.logger.info(`Optimisation de la stratégie ${strategyId}`);
    
    const strategy = this.strategyService.getStrategyById(strategyId);
    if (!strategy) {
      throw new Error(`Stratégie non trouvée avec l'ID: ${strategyId}`);
    }
    
    return this.backtestController.optimizeStrategy(strategy, config, parameterRanges);
  }
  
  /**
   * Génère un rapport détaillé pour un résultat de backtest
   */
  generateBacktestReport(result: BacktestResult): string {
    const report = [];
    
    // En-tête du rapport
    report.push(`# Rapport de Backtest - ${result.strategyName}`);
    report.push('');
    report.push(`- **Symbole**: ${result.symbol}`);
    report.push(`- **Période**: ${result.startDate.toLocaleDateString()} - ${result.endDate.toLocaleDateString()}`);
    report.push(`- **Capital initial**: ${result.initialBalance.toFixed(2)} USDT`);
    report.push(`- **Capital final**: ${result.finalBalance.toFixed(2)} USDT`);
    report.push(`- **Profit**: ${result.profit.toFixed(2)} USDT (${result.profitPercentage.toFixed(2)}%)`);
    report.push('');
    
    // Métriques de performance
    report.push('## Métriques de performance');
    report.push('');
    report.push(`- **Nombre de trades**: ${result.metrics.totalTrades}`);
    report.push(`- **Trades gagnants**: ${result.metrics.winningTrades} (${(result.metrics.winRate * 100).toFixed(2)}%)`);
    report.push(`- **Trades perdants**: ${result.metrics.losingTrades}`);
    report.push(`- **Gain moyen par trade gagnant**: ${result.metrics.averageWin.toFixed(2)} USDT`);
    report.push(`- **Perte moyenne par trade perdant**: ${result.metrics.averageLoss.toFixed(2)} USDT`);
    report.push(`- **Plus grand gain**: ${result.metrics.largestWin.toFixed(2)} USDT`);
    report.push(`- **Plus grande perte**: ${result.metrics.largestLoss.toFixed(2)} USDT`);
    report.push(`- **Facteur de profit**: ${result.metrics.profitFactor.toFixed(2)}`);
    report.push(`- **Drawdown maximum**: ${result.metrics.maxDrawdown.toFixed(2)} USDT (${result.metrics.maxDrawdownPercentage.toFixed(2)}%)`);
    report.push(`- **Ratio de Sharpe**: ${result.metrics.sharpeRatio.toFixed(2)}`);
    report.push(`- **Ratio de Sortino**: ${result.metrics.sortinoRatio.toFixed(2)}`);
    report.push(`- **Durée moyenne des positions**: ${(result.metrics.averageHoldingTime / (1000 * 60 * 60)).toFixed(2)} heures`);
    report.push('');
    
    // Résumé des trades
    report.push('## Résumé des trades');
    report.push('');
    report.push('| # | Date d\'entrée | Prix d\'entrée | Date de sortie | Prix de sortie | Direction | Profit | Profit % |');
    report.push('|---|--------------|--------------|--------------|--------------|-----------|--------|---------|');
    
    result.trades.forEach((trade, index) => {
      const entryDate = trade.entryDate.toLocaleString();
      const exitDate = trade.exitDate ? trade.exitDate.toLocaleString() : 'N/A';
      const exitPrice = trade.exitPrice ? trade.exitPrice.toFixed(2) : 'N/A';
      
      report.push(`| ${index + 1} | ${entryDate} | ${trade.entryPrice.toFixed(2)} | ${exitDate} | ${exitPrice} | ${trade.direction} | ${trade.profit.toFixed(2)} | ${trade.profitPercentage.toFixed(2)}% |`);
    });
    
    return report.join('\n');
  }
  
  /**
   * Exporte les résultats du backtest au format JSON
   */
  exportBacktestResults(result: BacktestResult, filePath: string): void {
    try {
      const fs = require('fs');
      const data = JSON.stringify(result, null, 2);
      fs.writeFileSync(filePath, data);
      this.logger.info(`Résultats exportés avec succès vers ${filePath}`);
    } catch (error) {
      this.logger.error('Erreur lors de l\'exportation des résultats:', error as Error);
      throw new Error(`Impossible d'exporter les résultats: ${(error as Error).message}`);
    }
  }
}
