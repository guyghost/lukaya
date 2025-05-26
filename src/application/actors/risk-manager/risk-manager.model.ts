import { OrderParams, Order, OrderSide } from '../../../domain/models/market.model';
import { ActorAddress } from '../../../actor/models/actor.model';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

export interface PositionRisk {
  symbol: string;
  direction: 'long' | 'short' | 'none';
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  riskLevel: RiskLevel;
  isViable?: boolean;
  viabilityReason?: string;
  holdingTime?: number;
  entryTime?: number;
}

export interface AccountRisk {
  totalValue: number;
  availableBalance: number;
  positions: PositionRisk[];
  totalRisk: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  maxPositionSize: number;
  currentRiskLevel: RiskLevel;
  leverageUsed: number;
}

export interface RiskManagerConfig {
  maxRiskPerTrade: number;
  maxPositionSize: number;
  maxDrawdownPercent: number;
  maxLeverage: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  accountSize: number;
  maxDailyLoss: number;
  maxOpenPositions: number;
  diversificationWeight: number;
  volatilityAdjustment: boolean;
  correlationMatrix: Record<string, Record<string, number>>;
}

export interface RiskAssessmentResult {
  approved: boolean;
  adjustedSize?: number;
  reason?: string;
  riskLevel: RiskLevel;
  recommendations?: string[];
}

export type RiskManagerMessage = 
  | { type: 'ASSESS_ORDER'; order: OrderParams; requestId: string }
  | { type: 'UPDATE_CONFIG'; config: Partial<RiskManagerConfig> }
  | { type: 'ORDER_FILLED'; order: Order; fillPrice: number }
  | { type: 'MARKET_UPDATE'; symbol: string; price: number }
  | { type: 'GET_POSITION_RISK'; symbol: string }
  | { type: 'GET_ACCOUNT_RISK' }
  | { type: 'REBALANCE_PORTFOLIO' }
  | { type: 'REGISTER_ORDER_MANAGER'; orderManagerAddress: ActorAddress }
  | { type: 'ANALYZE_OPEN_POSITIONS' }
  | { type: 'REGISTER_ORDER_MANAGER'; orderManagerAddress: ActorAddress }
  | { type: 'ANALYZE_OPEN_POSITIONS' }
  | { type: 'CHECK_POSITION_VIABILITY'; symbol: string; currentPrice: number }
  | { type: 'CLOSE_POSITION'; symbol: string; reason: string };

export interface RiskManagerState {
  config: RiskManagerConfig;
  positions: Record<string, PositionRisk>;
  accountRisk: AccountRisk;
  marketVolatility: Record<string, number>;
  dailyPnL: number;
  lastRebalance: number;
  orderManagerAddress: ActorAddress | null;
}

export interface PositionViabilityResult {
  isViable: boolean;
  reason: string;
  recommendation: string;
  riskLevel: RiskLevel;
  shouldClose: boolean;
  direction?: 'long' | 'short' | 'none';
  size?: number;
}

export interface RiskManagerPort {
  assessOrderRisk(order: OrderParams, accountRisk: AccountRisk): Promise<RiskAssessmentResult>;
  getAccountRisk(): Promise<AccountRisk>;
  getPositionRisk(symbol: string): Promise<PositionRisk | null>;
  updatePosition(symbol: string, price: number, side?: OrderSide, size?: number): void;
  suggestOrderAdjustments(order: OrderParams): Promise<OrderParams>;
  rebalancePortfolio(): Promise<RiskAssessmentResult[]>;
  analyzePositionViability(symbol: string, currentPrice: number): Promise<PositionViabilityResult>;
  analyzeAllOpenPositions(): Promise<Record<string, PositionViabilityResult>>;
}