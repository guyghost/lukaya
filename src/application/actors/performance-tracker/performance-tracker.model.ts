import { Order, OrderStatus } from '../../../domain/models/market.model';
import { StrategyPerformance } from '../strategy-manager/strategy-manager.model';

export interface TradeEntry {
  id: string;
  strategyId: string;
  symbol: string;
  entryTime: number;
  entryPrice: number;
  entryOrder: Order;
  exitTime?: number;
  exitPrice?: number;
  exitOrder?: Order;
  quantity: number;
  pnl?: number;
  pnlPercent?: number;
  fees: number;
  status: 'open' | 'closed' | 'canceled';
  duration?: number;
  tags: string[];
}

export interface SymbolPerformance {
  symbol: string;
  trades: number;
  winningTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  netProfit: number;
  netProfitPercent: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  averageHoldingTime: number;
}

export interface AccountMetrics {
  startingBalance: number;
  currentBalance: number;
  totalProfit: number;
  totalProfitPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  averageHoldingTime: number;
  dailyReturns: number[];
  monthlyReturns: number[];
  returnsVolatility: number;
  calmarRatio: number;
  openPositions: number;
}

export interface PerformanceTrackerConfig {
  historyLength: number;
  trackOpenPositions: boolean;
  realTimeUpdates: boolean;
  calculationInterval: number;
  includeFeesInCalculations: boolean;
}

export type PerformanceTrackerMessage =
  | { type: 'TRADE_OPENED'; trade: TradeEntry }
  | { type: 'TRADE_CLOSED'; trade: TradeEntry }
  | { type: 'TRADE_UPDATED'; trade: TradeEntry }
  | { type: 'UPDATE_PRICE'; symbol: string; price: number; timestamp: number }
  | { type: 'GET_ACCOUNT_METRICS' }
  | { type: 'GET_SYMBOL_PERFORMANCE'; symbol: string }
  | { type: 'GET_STRATEGY_PERFORMANCE'; strategyId: string }
  | { type: 'GET_TRADE_HISTORY'; filters?: TradeHistoryFilter }
  | { type: 'GENERATE_PERFORMANCE_REPORT'; type: ReportType; period?: Period }
  | { type: 'UPDATE_CONFIG'; config: Partial<PerformanceTrackerConfig> };

export interface TradeHistoryFilter {
  symbol?: string;
  strategyId?: string;
  status?: 'open' | 'closed' | 'canceled';
  startDate?: number;
  endDate?: number;
  profitable?: boolean;
  limit?: number;
  tags?: string[];
}

export type ReportType = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
export type Period = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'all';

export interface PerformanceTrackerState {
  trades: TradeEntry[];
  openTrades: Record<string, TradeEntry>;
  symbolPerformance: Record<string, SymbolPerformance>;
  strategyPerformance: Record<string, StrategyPerformance>;
  accountMetrics: AccountMetrics;
  lastUpdateTime: number;
  priceHistory: Record<string, { price: number; timestamp: number }[]>;
  config: PerformanceTrackerConfig;
}

export interface PerformanceTrackerPort {
  recordTradeOpened(trade: TradeEntry): Promise<void>;
  recordTradeClosed(trade: TradeEntry): Promise<void>;
  updateTrade(trade: TradeEntry): Promise<void>;
  updatePrice(symbol: string, price: number, timestamp: number): Promise<void>;
  getAccountMetrics(): Promise<AccountMetrics>;
  getSymbolPerformance(symbol: string): Promise<SymbolPerformance | null>;
  getStrategyPerformance(strategyId: string): Promise<StrategyPerformance | null>;
  getTradeHistory(filters?: TradeHistoryFilter): Promise<TradeEntry[]>;
  generateReport(type: ReportType, period?: Period): Promise<any>;
}