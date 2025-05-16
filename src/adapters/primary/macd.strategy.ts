import { 
  Strategy, StrategyConfig, StrategySignal 
} from "../../domain/models/strategy.model";
import { 
  MarketData, OrderParams, OrderSide, OrderType, TimeInForce 
} from "../../domain/models/market.model";

interface MACDConfig {
  symbol: string;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
  positionSize?: number;
}

export const createMACDStrategy = (config: MACDConfig): Strategy => {
  const fastPeriod = config.fastPeriod || 12;
  const slowPeriod = config.slowPeriod || 26;
  const signalPeriod = config.signalPeriod || 9;
  let closes: number[] = [];
  let macdLine: number[] = [];
  let signalLine: number[] = [];
  let position: "none" | "long" | "short" = "none";
  const id = `macd-${fastPeriod}-${slowPeriod}-${signalPeriod}-${config.symbol}`;
  const name = `MACD (${fastPeriod}/${slowPeriod}/${signalPeriod}) - ${config.symbol}`;

  function ema(period: number, data: number[]): number {
    if (data.length < period) return 0;
    const k = 2 / (period + 1);
    let emaPrev = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      emaPrev = data[i] * k + emaPrev * (1 - k);
    }
    return emaPrev;
  }

  return {
    getId: () => id,
    getName: () => name,
    getConfig: (): StrategyConfig => ({
      id,
      name,
      description: `MACD strategy with fast ${fastPeriod}, slow ${slowPeriod}, signal ${signalPeriod}`,
      parameters: config as unknown as Record<string, unknown>,
    }),
    processMarketData: async (data: MarketData): Promise<StrategySignal | null> => {
      if (data.symbol !== config.symbol) return null;
      closes.push(data.price);
      if (closes.length < slowPeriod + signalPeriod) return null;
      const macd = ema(fastPeriod, closes) - ema(slowPeriod, closes);
      macdLine.push(macd);
      if (macdLine.length > signalPeriod) macdLine.shift();
      const signal = ema(signalPeriod, macdLine);
      signalLine.push(signal);
      if (signalLine.length > 2) signalLine.shift();
      if (macdLine.length < signalPeriod) return null;
      // Cross detection
      if (macdLine.length >= 2 && signalLine.length >= 2) {
        const prevMacd = macdLine[macdLine.length - 2] - signalLine[signalLine.length - 2];
        const currMacd = macdLine[macdLine.length - 1] - signalLine[signalLine.length - 1];
        if (prevMacd < 0 && currMacd > 0 && position === "none") {
          position = "long";
          return { type: "entry", direction: "long", reason: "MACD bullish crossover" };
        } else if (prevMacd > 0 && currMacd < 0 && position === "long") {
          position = "none";
          return { type: "exit", direction: "long", reason: "MACD bearish crossover" };
        }
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
