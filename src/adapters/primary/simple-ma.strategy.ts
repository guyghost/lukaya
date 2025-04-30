import { 
  MarketData, 
  OrderParams,
  OrderSide,
  OrderType,
  TimeInForce 
} from "../../domain/models/market.model";
import { 
  Strategy,
  StrategyConfig,
  StrategySignal 
} from "../../domain/models/strategy.model";

interface SimpleMAConfig {
  shortPeriod: number;
  longPeriod: number;
  symbol: string;
  positionSize: number;
}

interface SimpleMAState {
  priceHistory: number[];
  position: "none" | "long" | "short";
}

export const createSimpleMAStrategy = (config: SimpleMAConfig): Strategy => {
  // Create strategy state
  const state: SimpleMAState = {
    priceHistory: [],
    position: "none"
  };
  
  // Generate unique ID and name for the strategy
  const id = `simple-ma-${config.shortPeriod}-${config.longPeriod}-${config.symbol}`;
  const name = `Simple Moving Average (${config.shortPeriod}/${config.longPeriod})`;
  
  // Helper function to calculate moving average
  const calculateMA = (period: number, offset: number = 0): number => {
    if (state.priceHistory.length < period + offset) return 0;

    const relevantPrices = state.priceHistory
      .slice(-(period + offset), state.priceHistory.length - offset);

    const sum = relevantPrices.reduce((acc, price) => acc + price, 0);
    return sum / period;
  };
  
  // Return the strategy implementation
  return {
    getId: (): string => id,
    
    getName: (): string => name,
    
    getConfig: (): StrategyConfig => {
      return {
        id,
        name,
        description: `Simple moving average crossover strategy using ${config.shortPeriod} and ${config.longPeriod} periods`,
        parameters: config as unknown as Record<string, unknown>,
      };
    },
    
    processMarketData: async (data: MarketData): Promise<StrategySignal | null> => {
      if (data.symbol !== config.symbol) return null;

      // Add price to history
      state.priceHistory.push(data.price);

      // Keep only the required data points
      const requiredLength = Math.max(config.shortPeriod, config.longPeriod);
      if (state.priceHistory.length > requiredLength) {
        state.priceHistory = state.priceHistory.slice(-requiredLength);
      }

      // Not enough data yet
      if (state.priceHistory.length < requiredLength) {
        return null;
      }

      // Calculate moving averages
      const shortMA = calculateMA(config.shortPeriod);
      const longMA = calculateMA(config.longPeriod);

      // Previous moving averages (from one data point ago)
      const prevShortMA = calculateMA(config.shortPeriod, 1);
      const prevLongMA = calculateMA(config.longPeriod, 1);

      // Check for crossovers
      if (shortMA > longMA && prevShortMA <= prevLongMA) {
        // Bullish crossover
        if (state.position === "short") {
          // Close short position first
          const exitSignal: StrategySignal = {
            type: "exit",
            direction: "short",
            price: data.price,
            reason: "Moving average bullish crossover",
          };
          state.position = "none";
          return exitSignal;
        } else if (state.position === "none") {
          // Enter long position
          const entrySignal: StrategySignal = {
            type: "entry",
            direction: "long",
            price: data.price,
            reason: "Moving average bullish crossover",
          };
          state.position = "long";
          return entrySignal;
        }
      } else if (shortMA < longMA && prevShortMA >= prevLongMA) {
        // Bearish crossover
        if (state.position === "long") {
          // Close long position first
          const exitSignal: StrategySignal = {
            type: "exit",
            direction: "long",
            price: data.price,
            reason: "Moving average bearish crossover",
          };
          state.position = "none";
          return exitSignal;
        } else if (state.position === "none") {
          // Enter short position
          const entrySignal: StrategySignal = {
            type: "entry",
            direction: "short",
            price: data.price,
            reason: "Moving average bearish crossover",
          };
          state.position = "short";
          return entrySignal;
        }
      }

      return null;
    },
    
    generateOrder: (signal: StrategySignal, marketData: MarketData): OrderParams | null => {
      if (marketData.symbol !== config.symbol) return null;

      const orderSide = 
        (signal.type === "entry" && signal.direction === "long") || 
        (signal.type === "exit" && signal.direction === "short") 
          ? OrderSide.BUY 
          : OrderSide.SELL;

      return {
        symbol: config.symbol,
        side: orderSide,
        type: OrderType.MARKET,
        size: config.positionSize,
        timeInForce: TimeInForce.IMMEDIATE_OR_CANCEL,
      };
    }
  };
};