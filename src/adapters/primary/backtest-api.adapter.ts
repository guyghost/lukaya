import express from 'express';
import { BacktestController } from '../../backtest/controllers/backtest.controller';
import { BacktestService } from '../../backtest/services/backtest.service';
import { BacktestConfig } from '../../backtest/models/backtest.model';
import { createContextualLogger } from '../../infrastructure/logging/enhanced-logger';
import { Strategy } from '../../domain/models/strategy.model';

/**
 * Adaptateur API REST pour les fonctionnalités de backtesting
 */
export const createBacktestApiAdapter = (
  strategyService: any, // Service qui gère les stratégies disponibles
) => {
  const logger = createContextualLogger('BacktestApiAdapter');
  const router = express.Router();
  
  // Initialiser le service et le contrôleur de backtest
  const backtestService = new BacktestService();
  const backtestController = new BacktestController(backtestService);
  
  // Endpoint pour exécuter un backtest sur une stratégie
  router.post('/run', async (req, res) => {
    try {
      const { strategyId, config } = req.body;
      
      if (!strategyId || !config) {
        return res.status(400).json({ 
          error: 'Paramètres manquants: strategyId et config sont requis' 
        });
      }
      
      // Valider et convertir la configuration
      const backtestConfig = validateBacktestConfig(config);
      
      // Récupérer la stratégie
      const strategy = strategyService.getStrategyById(strategyId);
      
      if (!strategy) {
        return res.status(404).json({ 
          error: `Stratégie non trouvée avec l'ID: ${strategyId}` 
        });
      }
      
      // Exécuter le backtest
      const result = await backtestController.runBacktest(strategy, backtestConfig);
      
      return res.json(result);
    } catch (error) {
      logger.error('Erreur lors de l\'exécution du backtest:', error as Error);
      return res.status(500).json({ 
        error: 'Erreur lors de l\'exécution du backtest', 
        message: (error as Error).message 
      });
    }
  });
  
  // Endpoint pour comparer plusieurs stratégies
  router.post('/compare', async (req, res) => {
    try {
      const { strategyIds, config } = req.body;
      
      if (!strategyIds || !Array.isArray(strategyIds) || !config) {
        return res.status(400).json({ 
          error: 'Paramètres manquants ou invalides: strategyIds (tableau) et config sont requis' 
        });
      }
      
      // Valider et convertir la configuration
      const backtestConfig = validateBacktestConfig(config);
      
      // Récupérer les stratégies
      const strategies: Strategy[] = [];
      
      for (const id of strategyIds) {
        const strategy = strategyService.getStrategyById(id);
        if (strategy) {
          strategies.push(strategy);
        } else {
          logger.warn(`Stratégie non trouvée avec l'ID: ${id}`);
        }
      }
      
      if (strategies.length === 0) {
        return res.status(404).json({ 
          error: 'Aucune stratégie valide trouvée parmi les IDs fournis' 
        });
      }
      
      // Exécuter la comparaison
      const results = await backtestController.compareStrategies(strategies, backtestConfig);
      
      return res.json(results);
    } catch (error) {
      logger.error('Erreur lors de la comparaison des stratégies:', error as Error);
      return res.status(500).json({ 
        error: 'Erreur lors de la comparaison des stratégies', 
        message: (error as Error).message 
      });
    }
  });
  
  // Endpoint pour optimiser les paramètres d'une stratégie
  router.post('/optimize', async (req, res) => {
    try {
      const { strategyId, config, parameterRanges } = req.body;
      
      if (!strategyId || !config || !parameterRanges) {
        return res.status(400).json({ 
          error: 'Paramètres manquants: strategyId, config et parameterRanges sont requis' 
        });
      }
      
      // Valider et convertir la configuration
      const backtestConfig = validateBacktestConfig(config);
      
      // Récupérer la stratégie
      const strategy = strategyService.getStrategyById(strategyId);
      
      if (!strategy) {
        return res.status(404).json({ 
          error: `Stratégie non trouvée avec l'ID: ${strategyId}` 
        });
      }
      
      // Valider les plages de paramètres
      if (typeof parameterRanges !== 'object') {
        return res.status(400).json({ 
          error: 'parameterRanges doit être un objet avec des tableaux de valeurs' 
        });
      }
      
      // Optimiser la stratégie
      const optimizationResults = await backtestController.optimizeStrategy(
        strategy, 
        backtestConfig, 
        parameterRanges
      );
      
      return res.json(optimizationResults);
    } catch (error) {
      logger.error('Erreur lors de l\'optimisation de la stratégie:', error as Error);
      return res.status(500).json({ 
        error: 'Erreur lors de l\'optimisation de la stratégie', 
        message: (error as Error).message 
      });
    }
  });
  
  return router;
};

/**
 * Valide et convertit la configuration de backtest
 */
function validateBacktestConfig(config: any): BacktestConfig {
  // Vérifier les champs obligatoires
  if (!config.symbol) {
    throw new Error('Le symbole est requis dans la configuration');
  }
  
  if (!config.startDate || !config.endDate) {
    throw new Error('Les dates de début et de fin sont requises dans la configuration');
  }
  
  // Convertir les dates
  const startDate = new Date(config.startDate);
  const endDate = new Date(config.endDate);
  
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new Error('Dates invalides dans la configuration');
  }
  
  if (startDate >= endDate) {
    throw new Error('La date de début doit être antérieure à la date de fin');
  }
  
  // Vérifier le solde initial
  if (!config.initialBalance || typeof config.initialBalance !== 'number' || config.initialBalance <= 0) {
    throw new Error('Le solde initial doit être un nombre positif');
  }
  
  // Construire l'objet BacktestConfig avec des valeurs par défaut pour les champs optionnels
  return {
    symbol: config.symbol,
    startDate,
    endDate,
    initialBalance: config.initialBalance,
    tradingFees: config.tradingFees ?? 0.1, // 0.1% par défaut
    slippage: config.slippage ?? 0.05, // 0.05% par défaut
    dataResolution: config.dataResolution ?? '1h',
    includeWeekends: config.includeWeekends ?? false,
    enableStopLoss: config.enableStopLoss ?? false,
    stopLossPercentage: config.stopLossPercentage,
    enableTakeProfit: config.enableTakeProfit ?? false,
    takeProfitPercentage: config.takeProfitPercentage
  };
}
