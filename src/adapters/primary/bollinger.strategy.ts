import { 
  Strategy, StrategyConfig, StrategySignal 
} from "../../domain/models/strategy.model";
import { 
  MarketData, OrderParams, OrderSide, OrderType, TimeInForce 
} from "../../domain/models/market.model";

interface BollingerConfig {
  symbol: string;
  period?: number;
  stdDev?: number;
  positionSize?: number;
}

export const createBollingerStrategy = (config: BollingerConfig): Strategy => {
  const period = config.period || 20;
  const stdDev = config.stdDev || 2;
  let closes: number[] = [];
  let position: "none" | "long" | "short" = "none";
  const id = `bollinger-${period}-${stdDev}-${config.symbol}`;
  const name = `Bollinger Bands (${period}, ${stdDev}) - ${config.symbol}`;

  function mean(data: number[]): number {
    return data.reduce((a, b) => a + b, 0) / data.length;
  }
  function std(data: number[]): number {
    const m = mean(data);
    return Math.sqrt(data.reduce((a, b) => a + Math.pow(b - m, 2), 0) / data.length);
  }

  return {
    getId: () => id,
    getName: () => name,
    getConfig: (): StrategyConfig => ({
      id,
      name,
      description: `Bollinger Bands strategy with period ${period}, stdDev ${stdDev}`,
      parameters: config as unknown as Record<string, unknown>,
    }),
    processMarketData: async (data: MarketData): Promise<StrategySignal | null> => {
      if (data.symbol !== config.symbol) return null;
      closes.push(data.price);
      if (closes.length > period) closes.shift();
      if (closes.length < period) return null;
      const m = mean(closes);
      const s = std(closes);
      const upper = m + stdDev * s;
      const lower = m - stdDev * s;
      if (data.price < lower && position === "none") {
        position = "long";
        return { type: "entry", direction: "long", reason: `Price below lower Bollinger band (${lower.toFixed(2)})` };
      } else if (data.price > upper && position === "long") {
        position = "none";
        return { type: "exit", direction: "long", reason: `Price above upper Bollinger band (${upper.toFixed(2)})` };
      }
      return null;
    },
    generateOrder: (signal: StrategySignal, marketData: MarketData): OrderParams | null => {
      if (!signal || marketData.symbol !== config.symbol) return null;
      return {
        symbol: config.symbol,
        side: signal.direction === "long" ? OrderSide.BUY : OrderSide.SELL,
        type: OrderType.MARKET,
        size: config.positionSize || 0.01,
        timeInForce: TimeInForce.IMMEDIATE_OR_CANCEL
      };
    }
  };
};
