import { BacktestService } from '../services/backtest.service';
import { BacktestConfig, BacktestResult } from '../models/backtest.model';
import { Strategy } from '../../domain/models/strategy.model';
import { createContextualLogger } from '../../infrastructure/logging/enhanced-logger';

/**
 * Contrôleur pour gérer les requêtes de backtest via API ou interface utilisateur
 */
export class BacktestController {
  private logger = createContextualLogger('BacktestController');
  private backtestService: BacktestService;
  
  constructor(backtestService: BacktestService) {
    this.backtestService = backtestService;
  }
  
  /**
   * Exécute un backtest pour une stratégie spécifique
   */
  async runBacktest(strategy: Strategy, config: BacktestConfig): Promise<BacktestResult> {
    this.logger.info(`Démarrage du backtest pour la stratégie ${strategy.getName()}`);
    
    try {
      return await this.backtestService.runBacktest(strategy, config);
    } catch (error) {
      this.logger.error(`Erreur lors du backtest de la stratégie ${strategy.getName()}:`, error as Error);
      throw error;
    }
  }
  
  /**
   * Exécute un backtest avec comparaison de plusieurs stratégies
   */
  async compareStrategies(strategies: Strategy[], config: BacktestConfig): Promise<BacktestResult[]> {
    this.logger.info(`Comparaison de ${strategies.length} stratégies sur ${config.symbol}`);
    
    try {
      const results: BacktestResult[] = [];
      
      for (const strategy of strategies) {
        this.logger.info(`Exécution du backtest pour ${strategy.getName()}`);
        const result = await this.backtestService.runBacktest(strategy, config);
        results.push(result);
      }
      
      // Trier les résultats par performance (profitPercentage)
      results.sort((a, b) => b.profitPercentage - a.profitPercentage);
      
      return results;
    } catch (error) {
      this.logger.error(`Erreur lors de la comparaison des stratégies:`, error as Error);
      throw error;
    }
  }
  
  /**
   * Exécute une optimisation de paramètres pour une stratégie
   */
  async optimizeStrategy(
    strategy: Strategy, 
    baseConfig: BacktestConfig, 
    parameterRanges: Record<string, any[]>
  ): Promise<{
    bestParameters: Record<string, any>;
    bestResult: BacktestResult;
    allResults: Array<{ parameters: Record<string, any>; result: BacktestResult }>;
  }> {
    this.logger.info(`Optimisation des paramètres pour la stratégie ${strategy.getName()}`);
    
    try {
      // Générer toutes les combinaisons de paramètres possibles
      const parameterCombinations = this.generateParameterCombinations(parameterRanges);
      this.logger.info(`${parameterCombinations.length} combinaisons de paramètres à tester`);
      
      const results: Array<{ parameters: Record<string, any>; result: BacktestResult }> = [];
      
      // Tester chaque combinaison de paramètres
      for (const parameters of parameterCombinations) {
        // Créer une copie de la stratégie avec les nouveaux paramètres
        const strategyWithParams = this.updateStrategyParameters(strategy, parameters);
        
        // Exécuter le backtest
        const result = await this.backtestService.runBacktest(strategyWithParams, baseConfig);
        
        // Stocker les résultats
        results.push({ parameters, result });
      }
      
      // Trier les résultats par performance
      results.sort((a, b) => b.result.profitPercentage - a.result.profitPercentage);
      
      // Retourner la meilleure combinaison et tous les résultats
      return {
        bestParameters: results[0].parameters,
        bestResult: results[0].result,
        allResults: results
      };
    } catch (error) {
      this.logger.error(`Erreur lors de l'optimisation de la stratégie ${strategy.getName()}:`, error as Error);
      throw error;
    }
  }
  
  /**
   * Génère toutes les combinaisons possibles de paramètres
   */
  private generateParameterCombinations(parameterRanges: Record<string, any[]>): Record<string, any>[] {
    const keys = Object.keys(parameterRanges);
    const combinations: Record<string, any>[] = [{}];
    
    for (const key of keys) {
      const values = parameterRanges[key];
      const newCombinations: Record<string, any>[] = [];
      
      for (const combination of combinations) {
        for (const value of values) {
          newCombinations.push({ ...combination, [key]: value });
        }
      }
      
      if (newCombinations.length > 0) {
        combinations.length = 0;
        combinations.push(...newCombinations);
      }
    }
    
    return combinations;
  }
  
  /**
   * Met à jour les paramètres d'une stratégie existante
   */
  private updateStrategyParameters(strategy: Strategy, parameters: Record<string, any>): Strategy {
    // Cette méthode dépend de l'implémentation spécifique des stratégies
    // Dans un cas simple, nous pouvons créer une nouvelle instance avec les mêmes fonctions
    // mais avec des paramètres différents
    
    // Pour l'instant, nous utilisons une approche simplifiée en supposant que
    // la stratégie a une méthode pour mettre à jour ses paramètres
    const config = strategy.getConfig();
    const updatedConfig = {
      ...config,
      parameters: {
        ...config.parameters,
        ...parameters
      }
    };
    
    // Nous supposons que cette méthode existe ou devrait être implémentée
    // @ts-ignore - Cette méthode peut ne pas exister sur toutes les stratégies
    if (strategy.updateConfig) {
      // @ts-ignore
      strategy.updateConfig(updatedConfig);
      return strategy;
    }
    
    // Si la méthode n'existe pas, nous pourrions avoir besoin de créer une nouvelle instance
    // Cela dépend de l'implémentation concrète des stratégies
    this.logger.warn(`La stratégie ${strategy.getName()} ne supporte pas la mise à jour des paramètres`);
    return strategy;
  }
}
