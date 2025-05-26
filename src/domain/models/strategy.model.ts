import { MarketData, OrderParams } from "./market.model";

export interface StrategySignal {
  type: "entry" | "exit";
  direction: "long" | "short";
  price?: number;
  reason: string;
  confidence?: number;
  metadata?: Record<string, any>;
}

export interface StrategyConfig {
  id: string;
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface Strategy {
  getId(): string;
  getName(): string;
  getConfig(): StrategyConfig;
  processMarketData(data: MarketData): Promise<StrategySignal | null>;
  generateOrder(signal: StrategySignal, marketData: MarketData): OrderParams | null;
  initializeWithHistory?(historicalData: MarketData[]): Promise<void>;
}
