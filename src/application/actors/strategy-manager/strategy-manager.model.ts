import { Strategy, StrategyConfig, StrategySignal } from '../../../domain/models/strategy.model';
import { MarketData, OrderParams } from '../../../domain/models/market.model';
import { RiskLevel } from '../risk-manager/risk-manager.model';

export interface StrategyPerformance {
  strategyId: string;
  winRate: number;
  profitFactor: number;
  averageWin: number;
  averageLoss: number;
  sharpeRatio: number;
  drawdown: number;
  trades: number;
  netProfit: number;
  active: boolean;
  lastUpdated: number;
}

export interface StrategyEntry {
  strategy: Strategy;
  config: StrategyConfig;
  performance: StrategyPerformance;
  markets: string[];
  weight: number;
  status: 'active' | 'paused' | 'backtest' | 'deprecated';
  lastSignal?: StrategySignal;
  riskLevel: RiskLevel;
}

export interface StrategyManagerConfig {
  autoAdjustWeights: boolean;
  minPerformanceThreshold: number;
  maxActiveStrategies: number;
  rebalancePeriod: number;
  backtestPeriod: number;
  optimizationEnabled: boolean;
  rotationEnabled: boolean;
  conflictResolutionMode: 'performance_weighted' | 'risk_adjusted' | 'consensus';
}

export type StrategyManagerMessage =
  | { type: 'REGISTER_STRATEGY'; strategy: Strategy; markets: string[]; initialWeight?: number }
  | { type: 'UNREGISTER_STRATEGY'; strategyId: string }
  | { type: 'PROCESS_MARKET_DATA'; data: MarketData }
  | { type: 'UPDATE_STRATEGY_PERFORMANCE'; strategyId: string; performance: Partial<StrategyPerformance> }
  | { type: 'ADJUST_STRATEGY_WEIGHT'; strategyId: string; weight: number }
  | { type: 'PAUSE_STRATEGY'; strategyId: string }
  | { type: 'RESUME_STRATEGY'; strategyId: string }
  | { type: 'RUN_OPTIMIZATION'; strategyIds?: string[] }
  | { type: 'ROTATE_STRATEGIES' }
  | { type: 'GET_STRATEGY_SIGNALS'; marketData: MarketData }
  | { type: 'GET_ALL_STRATEGIES' }
  | { type: 'VALIDATE_ORDER'; strategyId: string; signal: StrategySignal; orderParams: OrderParams }
  | { type: 'UPDATE_CONFIG'; config: Partial<StrategyManagerConfig> };

export interface StrategyManagerState {
  strategies: Record<string, StrategyEntry>;
  config: StrategyManagerConfig;
  activeStrategiesCount: number;
  lastOptimization: number;
  lastRotation: number;
  marketDataCache: Record<string, MarketData>;
}

export interface StrategyManagerPort {
  registerStrategy(strategy: Strategy, markets: string[], initialWeight?: number): Promise<string>;
  unregisterStrategy(strategyId: string): Promise<boolean>;
  processMarketData(data: MarketData): Promise<Map<string, StrategySignal | null>>;
  updateStrategyPerformance(strategyId: string, performance: Partial<StrategyPerformance>): Promise<void>;
  adjustWeight(strategyId: string, weight: number): Promise<void>;
  pauseStrategy(strategyId: string): Promise<void>;
  resumeStrategy(strategyId: string): Promise<void>;
  getStrategies(): Promise<StrategyEntry[]>;
  getStrategy(strategyId: string): Promise<StrategyEntry | null>;
  optimizeStrategies(strategyIds?: string[]): Promise<void>;
  rotateStrategies(): Promise<void>;
}