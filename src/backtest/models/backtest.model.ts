/**
 * Interface pour les résultats de backtest d'une stratégie
 */
export interface BacktestResult {
  // Informations sur la stratégie
  strategyId: string;
  strategyName: string;
  
  // Paramètres du backtest
  symbol: string;
  startDate: Date;
  endDate: Date;
  initialBalance: number;
  
  // Résultats globaux
  finalBalance: number;
  profit: number;
  profitPercentage: number;
  trades: BacktestTrade[];
  
  // Métriques de performance
  metrics: BacktestMetrics;
}

/**
 * Métrique de performance pour un backtest
 */
export interface BacktestMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercentage: number;
  sharpeRatio: number;
  sortinoRatio: number;
  averageHoldingTime: number; // en millisecondes
}

/**
 * Représente un trade dans un backtest
 */
export interface BacktestTrade {
  id: string;
  entryDate: Date;
  entryPrice: number;
  exitDate: Date | null;
  exitPrice: number | null;
  quantity: number;
  direction: 'long' | 'short';
  profit: number;
  profitPercentage: number;
  status: 'open' | 'closed';
  fees: number;
}

/**
 * Configuration pour un backtest
 */
export interface BacktestConfig {
  symbol: string;
  startDate: Date;
  endDate: Date;
  initialBalance: number;
  tradingFees: number; // en pourcentage
  slippage: number; // en pourcentage
  dataResolution: string; // '1m', '5m', '15m', '1h', '4h', '1d'
  includeWeekends: boolean;
  enableStopLoss: boolean;
  stopLossPercentage?: number;
  enableTakeProfit: boolean;
  takeProfitPercentage?: number;
}
