import { Strategy, StrategySignal } from "../models/strategy.model";
import { MarketData, OrderParams } from "../models/market.model";

interface StrategyServiceState {
  strategies: Map<string, Strategy>;
}

export interface StrategyService {
  registerStrategy: (strategy: Strategy) => void;
  unregisterStrategy: (strategyId: string) => void;
  getStrategy: (strategyId: string) => Strategy | undefined;
  getAllStrategies: () => Strategy[];
  processMarketData: (data: MarketData) => Promise<Map<string, StrategySignal | null>>;
  generateOrder: (strategyId: string, signal: StrategySignal, marketData: MarketData) => OrderParams | null;
}

export const createStrategyService = (): StrategyService => {
  // Initialize state
  const state: StrategyServiceState = {
    strategies: new Map()
  };
  
  return {
    registerStrategy: (strategy: Strategy): void => {
      state.strategies.set(strategy.getId(), strategy);
    },
    
    unregisterStrategy: (strategyId: string): void => {
      state.strategies.delete(strategyId);
    },
    
    getStrategy: (strategyId: string): Strategy | undefined => {
      return state.strategies.get(strategyId);
    },
    
    getAllStrategies: (): Strategy[] => {
      return Array.from(state.strategies.values());
    },
    
    processMarketData: async (data: MarketData): Promise<Map<string, StrategySignal | null>> => {
      const results = new Map<string, StrategySignal | null>();
      
      for (const [id, strategy] of Array.from(state.strategies.entries())) {
        try {
          const signal = await strategy.processMarketData(data);
          results.set(id, signal);
        } catch (error) {
          console.error(`Error processing market data for strategy ${id}:`, error);
          results.set(id, null);
        }
      }
      
      return results;
    },
    
    generateOrder: (strategyId: string, signal: StrategySignal, marketData: MarketData): OrderParams | null => {
      const strategy = state.strategies.get(strategyId);
      if (!strategy) return null;
      
      return strategy.generateOrder(signal, marketData);
    }
  };
};