import { RiskManagerConfig } from "../../application/actors/risk-manager/risk-manager.model";
import { StrategyManagerConfig } from "../../application/actors/strategy-manager/strategy-manager.model";
import { TakeProfitConfig } from "../../application/actors/take-profit-manager/take-profit-manager.model";
import { TakeProfitIntegratorConfig } from "../../application/integrators/take-profit-integrator";

/**
 * Options pour configurer le provider de données de backtest
 */
export interface BacktestDataOptions {
  /**
   * Source des données (fichier CSV, API, etc.)
   */
  dataSource: 'csv' | 'api' | 'database';
  
  /**
   * Chemin vers les fichiers de données si dataSource='csv'
   */
  dataPath?: string;
  
  /**
   * URL de l'API si dataSource='api'
   */
  apiUrl?: string;
  
  /**
   * Connexion à la base de données si dataSource='database'
   */
  dbConnection?: any;
  
  /**
   * Intervalle des données (1m, 5m, 15m, 1h, etc.)
   */
  timeframe: string;
  
  /**
   * Si true, générera automatiquement des données synthétiques lorsqu'il n'y a pas assez de données réelles
   */
  interpolateData?: boolean;
}

/**
 * Options pour le simulateur d'exécution d'ordres
 */
export interface BacktestTradingOptions {
  /**
   * Solde initial du compte
   */
  initialBalance: number;
  
  /**
   * Frais de trading à appliquer (pourcentage)
   */
  tradingFees: number;
  
  /**
   * Slippage moyen à appliquer (pourcentage)
   */
  slippage: number;
  
  /**
   * Proportion maximale des fonds disponibles pour un ordre
   */
  maxFundsPerOrder: number;
  
  /**
   * Simulation de retards d'exécution d'ordre (ms)
   */
  executionDelay?: number;
  
  /**
   * Pourcentage de probabilité qu'un ordre soit rejeté
   */
  rejectionProbability?: number;
}

/**
 * Configuration complète du backtest
 */
export interface BacktestConfig {
  /**
   * Date de début du backtest
   */
  startDate: Date;
  
  /**
   * Date de fin du backtest
   */
  endDate: Date;
  
  /**
   * Configuration des données historiques
   */
  dataOptions: BacktestDataOptions;
  
  /**
   * Configuration du simulateur de trading
   */
  tradingOptions: BacktestTradingOptions;
  
  /**
   * Configuration du gestionnaire de risque
   */
  riskConfig?: Partial<RiskManagerConfig>;
  
  /**
   * Configuration du gestionnaire de stratégies
   */
  strategyConfig?: Partial<StrategyManagerConfig>;
  
  /**
   * Configuration du gestionnaire de prise de profit
   */
  takeProfitConfig?: Partial<TakeProfitConfig>;
  
  /**
   * Configuration de l'intégrateur de prise de profit
   */
  takeProfitIntegratorConfig?: Partial<TakeProfitIntegratorConfig>;
  
  /**
   * Activer le mode à haut risque
   */
  highRiskMode?: boolean;
}

/**
 * Représentation d'un trade dans le backtest
 */
export interface BacktestTrade {
  /**
   * Identifiant du trade
   */
  id: string;
  
  /**
   * Symbole du marché
   */
  symbol: string;
  
  /**
   * Stratégie qui a généré le signal
   */
  strategyId: string;
  
  /**
   * Direction (long/short)
   */
  direction: 'long' | 'short';
  
  /**
   * Taille de la position
   */
  size: number;
  
  /**
   * Prix d'entrée
   */
  entryPrice: number;
  
  /**
   * Prix de sortie (si la position est fermée)
   */
  exitPrice?: number;
  
  /**
   * Horodatage de l'entrée
   */
  entryTime: number;
  
  /**
   * Horodatage de la sortie
   */
  exitTime?: number;
  
  /**
   * Profit/perte en devise de base
   */
  profit: number;
  
  /**
   * Profit/perte en pourcentage
   */
  profitPercentage: number;
  
  /**
   * Frais de trading
   */
  fees: number;
  
  /**
   * Raison de sortie
   */
  exitReason?: 'take-profit' | 'stop-loss' | 'signal' | 'manual' | 'end-of-backtest';
}

/**
 * Performance d'une stratégie dans le backtest
 */
export interface BacktestStrategyPerformance {
  /**
   * Nombre de trades générés
   */
  trades: number;
  
  /**
   * Nombre de trades gagnants
   */
  winningTrades: number;
  
  /**
   * Nombre de trades perdants
   */
  losingTrades: number;
  
  /**
   * Taux de réussite (%)
   */
  winRate: number;
  
  /**
   * Profit/perte total
   */
  profit: number;
  
  /**
   * Facteur de profit (gains/pertes)
   */
  profitFactor: number;
}

/**
 * Résultats complets du backtest
 */
export interface BacktestResults {
  /**
   * Solde initial
   */
  initialBalance: number;
  
  /**
   * Solde final
   */
  finalBalance: number;
  
  /**
   * Profit/perte net
   */
  profit: number;
  
  /**
   * Profit/perte en pourcentage
   */
  profitPercentage: number;
  
  /**
   * Liste de tous les trades
   */
  trades: BacktestTrade[];
  
  /**
   * Nombre de trades gagnants
   */
  winningTrades: number;
  
  /**
   * Nombre de trades perdants
   */
  losingTrades: number;
  
  /**
   * Taux de réussite (%)
   */
  winRate: number;
  
  /**
   * Plus grand gain sur un trade
   */
  largestWin: number;
  
  /**
   * Plus grande perte sur un trade
   */
  largestLoss: number;
  
  /**
   * Gain moyen sur les trades gagnants
   */
  averageWin: number;
  
  /**
   * Perte moyenne sur les trades perdants
   */
  averageLoss: number;
  
  /**
   * Facteur de profit (gains/pertes)
   */
  profitFactor: number;
  
  /**
   * Drawdown maximum en devise de base
   */
  maxDrawdown: number;
  
  /**
   * Drawdown maximum en pourcentage
   */
  maxDrawdownPercentage: number;
  
  /**
   * Exposition moyenne au marché (%)
   */
  averageExposure: number;
  
  /**
   * Performance par stratégie
   */
  strategyPerformance: Record<string, BacktestStrategyPerformance>;
}
