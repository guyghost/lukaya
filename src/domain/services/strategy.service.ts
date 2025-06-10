import { Strategy, StrategySignal } from "../models/strategy.model";
import { MarketData, OrderParams } from "../models/market.model";

// L'état est maintenant juste un type, pas encapsulé dans une closure.
export type StrategiesState = Map<string, Strategy>;

// Les fonctions prennent l'état en premier argument.

export const registerStrategy = (strategies: StrategiesState, strategy: Strategy): StrategiesState => {
  const newStrategies = new Map(strategies);
  newStrategies.set(strategy.getId(), strategy);
  return newStrategies;
};

export const unregisterStrategy = (strategies: StrategiesState, strategyId: string): StrategiesState => {
  const newStrategies = new Map(strategies);
  newStrategies.delete(strategyId);
  return newStrategies;
};

export const getStrategy = (strategies: StrategiesState, strategyId: string): Strategy | undefined => {
  return strategies.get(strategyId);
};

export const getAllStrategies = (strategies: StrategiesState): Strategy[] => {
  return Array.from(strategies.values());
};

export const processMarketDataForStrategies = async (
  strategies: StrategiesState,
  data: MarketData
): Promise<Map<string, StrategySignal | null>> => {
  const results = new Map<string, StrategySignal | null>();
  for (const [id, strategy] of Array.from(strategies.entries())) {
    try {
      const signal = await strategy.processMarketData(data);
      results.set(id, signal);
    } catch (error) {
      console.error(`Error processing market data for strategy ${id}:`, error);
      results.set(id, null);
    }
  }
  return results;
};

export const generateOrderForStrategy = (
  strategies: StrategiesState,
  strategyId: string,
  signal: StrategySignal,
  marketData: MarketData
): OrderParams | null => {
  const strategy = strategies.get(strategyId);
  if (!strategy) return null;
  return strategy.generateOrder(signal, marketData);
};

// L'ancienne fonction createStrategyService n'est plus nécessaire dans cette approche purement fonctionnelle.
// Si vous avez besoin de regrouper ces fonctions, vous pouvez exporter un objet les contenant,
// mais elles opéreront toujours sur l'état passé en argument.

// Wrapper pour compatibilité avec l'API existante
export interface StrategyService {
  registerStrategy(strategy: Strategy): void;
  unregisterStrategy(strategyId: string): void;
  getStrategy(strategyId: string): Strategy | undefined;
  getStrategyById(strategyId: string): Strategy | undefined;
  getAllStrategies(): Record<string, Strategy>;
  processMarketData(data: MarketData): Promise<Map<string, StrategySignal | null>>;
  generateOrder(strategyId: string, signal: StrategySignal, marketData: MarketData): OrderParams | null;
}

export const createStrategyService = (): StrategyService => {
  let state: StrategiesState = new Map();
  
  return {
    registerStrategy: (strategy: Strategy) => {
      state = registerStrategy(state, strategy);
    },
    
    unregisterStrategy: (strategyId: string) => {
      state = unregisterStrategy(state, strategyId);
    },
    
    getStrategy: (strategyId: string) => {
      return getStrategy(state, strategyId);
    },
    
    getStrategyById: (strategyId: string) => {
      return getStrategy(state, strategyId);
    },
    
    getAllStrategies: () => {
      const strategies = getAllStrategies(state);
      const result: Record<string, Strategy> = {};
      strategies.forEach(strategy => {
        result[strategy.getId()] = strategy;
      });
      return result;
    },
    
    processMarketData: (data: MarketData) => {
      return processMarketDataForStrategies(state, data);
    },
    
    generateOrder: (strategyId: string, signal: StrategySignal, marketData: MarketData) => {
      return generateOrderForStrategy(state, strategyId, signal, marketData);
    }
  };
};

// Exemple de regroupement (optionnel) :
export const StrategyServiceFunctions = {
  registerStrategy,
  unregisterStrategy,
  getStrategy,
  getAllStrategies,
  processMarketData: processMarketDataForStrategies,
  generateOrder: generateOrderForStrategy,
};