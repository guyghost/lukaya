import { Strategy, StrategySignal } from "../models/strategy.model";
import { MarketData, OrderParams } from "../models/market.model";

export class StrategyService {
  private strategies: Map<string, Strategy>;

  constructor() {
    this.strategies = new Map();
  }

  registerStrategy(strategy: Strategy): void {
    this.strategies.set(strategy.getId(), strategy);
  }

  unregisterStrategy(strategyId: string): void {
    this.strategies.delete(strategyId);
  }

  getStrategy(strategyId: string): Strategy | undefined {
    return this.strategies.get(strategyId);
  }

  getAllStrategies(): Strategy[] {
    return Array.from(this.strategies.values());
  }

  async processMarketData(data: MarketData): Promise<Map<string, StrategySignal | null>> {
    const results = new Map<string, StrategySignal | null>();
    
    for (const [id, strategy] of Array.from(this.strategies.entries())) {
      try {
        const signal = await strategy.processMarketData(data);
        results.set(id, signal);
      } catch (error) {
        console.error(`Error processing market data for strategy ${id}:`, error);
        results.set(id, null);
      }
    }
    
    return results;
  }

  generateOrder(strategyId: string, signal: StrategySignal, marketData: MarketData): OrderParams | null {
    const strategy = this.getStrategy(strategyId);
    if (!strategy) return null;
    
    return strategy.generateOrder(signal, marketData);
  }
}
