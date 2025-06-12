/**
 * Types communs pour remplacer les 'any' dans le projet Lukaya
 */

import { Order, OrderParams } from '../../domain/models/market.model';
import { Strategy, StrategyConfig } from '../../domain/models/strategy.model';
import { Result } from './index';

// Types pour les services
export interface StrategyService {
  createStrategy(type: string, config: Record<string, unknown>): Promise<Strategy>;
  getStrategy(id: string): Strategy | null;
  getAllStrategies(): Strategy[];
  removeStrategy(id: string): Promise<Result<void>>;
  updateStrategy(id: string, config: Partial<StrategyConfig>): Promise<Result<void>>;
}

// Types pour les configurations de backtest
export interface BacktestConfig {
  symbol: string;
  startDate: string | number;
  endDate: string | number;
  initialBalance?: number;
  commission?: number;
  slippage?: number;
  timeframe?: string;
}

// Types pour les paramètres d'optimisation
export type ParameterValue = string | number | boolean;
export type ParameterRange = ParameterValue[];
export type ParameterRanges = Record<string, ParameterRange>;
export type ParameterCombination = Record<string, ParameterValue>;

// Types pour les résultats d'optimisation
export interface OptimizationResult {
  parameters: ParameterCombination;
  metrics: BacktestMetrics;
  rank: number;
}

export interface BacktestMetrics {
  totalReturn: number;
  totalReturnPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  profitFactor?: number;
  sortinoRatio?: number;
}

// Types pour les données de marché externes (API)
export interface ExternalMarketData {
  symbol: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ExternalOrderData {
  id: string;
  clientId?: string;
  symbol: string;
  side: string;
  type: string;
  size: string | number;
  price?: string | number;
  status: string;
  createdAt: string | number;
  updatedAt?: string | number;
  filledSize?: string | number;
  avgFillPrice?: string | number;
}

// Types pour les messages d'acteurs
export interface ActorMessage<T = unknown> {
  type: string;
  payload?: T;
  timestamp?: number;
  source?: string;
}

export interface ActorContext {
  self: { id: string };
  parent: { id: string } | null;
  children: Map<string, unknown>;
  spawn: (definition: ActorDefinition) => Promise<ActorAddress>;
  stop: (address: ActorAddress) => Promise<void>;
  send: (address: ActorAddress, message: ActorMessage) => void;
}

export interface ActorDefinition {
  id: string;
  initialState: unknown;
  behavior: ActorBehavior;
}

export interface ActorAddress {
  id: string;
  send: (message: ActorMessage) => void;
}

export type ActorBehavior = (
  state: unknown,
  message: ActorMessage,
  context: ActorContext
) => Promise<{ state: unknown; effects?: ActorEffect[] }>;

export interface ActorEffect {
  type: string;
  data?: unknown;
}

// Types pour les ordres rejetés et annulés
export interface RejectedOrder {
  order: OrderParams;
  reason: string;
  error?: Error;
  timestamp: number;
}

export interface CancelledOrder {
  order: Order;
  reason: string;
  error?: Error;
  timestamp: number;
}

// Types pour l'évaluation des risques
export interface RiskAssessmentResult {
  approved: boolean;
  riskScore: number;
  warnings: string[];
  recommendations?: string[];
  maxPositionSize?: number;
  suggestedStopLoss?: number;
}

// Types pour les métriques de performance
export interface PerformanceMetrics {
  totalReturn: number;
  totalReturnPercent: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  averageWin: number;
  averageLoss: number;
  averageHoldingTime: number;
}

// Types pour les rapports
export interface PerformanceReport {
  type: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
  period: {
    start: number;
    end: number;
  };
  metrics: PerformanceMetrics;
  trades: TradeReportEntry[];
  summary: ReportSummary;
  charts?: ChartData[];
}

export interface TradeReportEntry {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryTime: number;
  exitTime?: number;
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  duration?: number;
  fees: number;
}

export interface ReportSummary {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  totalPnlPercent: number;
  bestTrade: number;
  worstTrade: number;
  averageTrade: number;
}

export interface ChartData {
  type: 'line' | 'bar' | 'pie';
  title: string;
  data: Array<{ x: number | string; y: number }>;
  labels?: string[];
}

// Types pour les configurations d'acteurs
export interface ActorConfig {
  [key: string]: unknown;
}

export interface StrategyManagerConfig extends ActorConfig {
  autoAdjustWeights: boolean;
  maxActiveStrategies: number;
  conflictResolutionMode: 'weighted' | 'latest' | 'consensus' | 'priority';
  optimizationEnabled: boolean;
}

export interface PerformanceTrackerConfig extends ActorConfig {
  historyLength: number;
  trackOpenPositions: boolean;
  realTimeUpdates: boolean;
  calculationInterval: number;
  includeFeesInCalculations: boolean;
}

export interface RiskManagerConfig extends ActorConfig {
  maxPositionSize: number;
  maxDailyLoss: number;
  maxDrawdown: number;
  allowedRiskPerTrade: number;
  stopLossRequired: boolean;
}

// Types pour les intervalles et timers
export type IntervalId = NodeJS.Timeout;
export type TimeoutId = NodeJS.Timeout;

// Types pour les stratégies de configuration par défaut
export interface DefaultStrategyConfig {
  symbol: string;
  positionSize: number;
  [key: string]: unknown;
}

export interface RSIDivergenceConfig extends DefaultStrategyConfig {
  rsiPeriod: number;
  divergenceWindow: number;
  overboughtLevel: number;
  oversoldLevel: number;
  minDivergenceStrength?: number;
}

export interface MovingAverageCrossConfig extends DefaultStrategyConfig {
  fastPeriod: number;
  slowPeriod: number;
  signalType: 'sma' | 'ema';
}

export interface BollingerBandsConfig extends DefaultStrategyConfig {
  period: number;
  standardDeviations: number;
  reversal: boolean;
}

// Type union pour toutes les configurations de stratégie
export type AnyStrategyConfig =
  | RSIDivergenceConfig
  | MovingAverageCrossConfig
  | BollingerBandsConfig
  | DefaultStrategyConfig;

// Types pour la validation et les résultats de backtest
export interface BacktestValidationResult {
  passed: boolean;
  result: BacktestMetrics | null;
  addedToBot: boolean;
  reason?: string;
}

// Types pour les données de santé de l'application
export interface ApplicationHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  version: string;
  uptime: number;
  services: ServiceHealthStatus[];
  actors: ActorHealthStatus[];
  memory: MemoryUsage;
  performance: PerformanceStats;
}

export interface ServiceHealthStatus {
  name: string;
  status: 'running' | 'stopped' | 'error';
  uptime: number;
  lastError?: string;
}

export interface ActorHealthStatus {
  id: string;
  type: string;
  status: 'active' | 'paused' | 'terminated';
  messageQueue: number;
  lastActivity: number;
}

export interface MemoryUsage {
  used: number;
  total: number;
  percentage: number;
}

export interface PerformanceStats {
  cpu: number;
  memoryUsage: number;
  activeConnections: number;
  requestsPerSecond: number;
}

// Types pour les objets à nettoyer (logging)
export type SanitizableValue = string | number | boolean | null | undefined | SanitizableObject | SanitizableArray;
export interface SanitizableObject {
  [key: string]: SanitizableValue;
}
export interface SanitizableArray extends Array<SanitizableValue> {}

// Types pour les erreurs d'exécution parallèle
export interface ParallelExecutionError {
  message: string;
  stack?: string;
  code?: string | number;
}
