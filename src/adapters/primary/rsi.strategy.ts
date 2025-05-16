import { 
  Strategy, StrategyConfig, StrategySignal 
} from "../../domain/models/strategy.model";
import { 
  MarketData, OrderParams, OrderSide, OrderType, TimeInForce 
} from "../../domain/models/market.model";

interface RSIConfig {
  symbol: string;
  period?: number;
  overbought?: number;
  oversold?: number;
  positionSize?: number;
}

export const createRSIStrategy = (config: RSIConfig): Strategy => {
  const period = config.period || 14;
  const overbought = config.overbought || 70;
  const oversold = config.oversold || 30;
  let closes: number[] = [];
  let position: "none" | "long" | "short" = "none";
  const id = `rsi-${period}-${config.symbol}`;
  const name = `RSI (${period}) - ${config.symbol}`;

  return {
    getId: () => id,
    getName: () => name,
    getConfig: (): StrategyConfig => ({
      id,
      name,
      description: `RSI strategy with period ${period}, overbought ${overbought}, oversold ${oversold}`,
      parameters: config as unknown as Record<string, unknown>,
    }),
    processMarketData: async (data: MarketData): Promise<StrategySignal | null> => {
      if (data.symbol !== config.symbol) return null;
      closes.push(data.price);
      if (closes.length > period + 1) closes.shift();
      if (closes.length < period + 1) return null;
      let gains = 0, losses = 0;
      for (let i = 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
      }
      const avgGain = gains / period;
      const avgLoss = losses / period;
      if (avgLoss === 0) return null;
      const rs = avgGain / avgLoss;
      const rsi = 100 - 100 / (1 + rs);
      if (rsi > overbought && position === "long") {
        position = "none";
        return { type: "exit", direction: "long", reason: `RSI ${rsi.toFixed(2)} > ${overbought}` };
      } else if (rsi < oversold && position === "none") {
        position = "long";
        return { type: "entry", direction: "long", reason: `RSI ${rsi.toFixed(2)} < ${oversold}` };
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
