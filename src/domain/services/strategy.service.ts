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
// Exemple de regroupement (optionnel) :
/*
export const StrategyServiceFunctions = {
  registerStrategy,
  unregisterStrategy,
  getStrategy,
  getAllStrategies,
  processMarketData: processMarketDataForStrategies,
  generateOrder: generateOrderForStrategy,
};
*/

// Plus besoin de createStrategyService et de StrategyServiceState/StrategyService interfaces ici
// si on adopte une approche purement fonctionnelle où l'état est géré explicitement à l'extérieur.