// Nouvelle stratégie de moyenne mobile complète
// Utilise SMA, EMA et signaux de croisement, avec gestion dynamique de la taille et du stop-loss
import { MarketData, OrderParams, OrderSide, OrderType, TimeInForce } from "../../domain/models/market.model";
import { Strategy, StrategyConfig, StrategySignal } from "../../domain/models/strategy.model";

interface AdvancedMAConfig {
  symbol: string;
  shortPeriod: number;
  longPeriod: number;
  positionSize: number;
  useEMA?: boolean;
  riskPerTrade?: number;
  stopLossPercent?: number;
  trailingStop?: boolean;
  trailingPercent?: number;
  maxSlippagePercent?: number;
  minLiquidityRatio?: number;
  accountSize?: number;
  maxCapitalPerTrade?: number;
  limitOrderBuffer?: number;
}

interface AdvancedMAState {
  priceHistory: number[];
  position: "none" | "long" | "short";
  lastEntryPrice: number | null;
  trailingStopPrice: number | null;
  accountSize: number | null;
}

export const createAdvancedMAStrategy = (config: AdvancedMAConfig): Strategy => {
  const state: AdvancedMAState = {
    priceHistory: [],
    position: "none",
    lastEntryPrice: null,
    trailingStopPrice: null,
    accountSize: config.accountSize || null
  };
  const id = `advanced-ma-${config.shortPeriod}-${config.longPeriod}-${config.symbol}`;
  const name = `Advanced Moving Average (${config.useEMA ? "EMA" : "SMA"} ${config.shortPeriod}/${config.longPeriod})`;
  const maxSlippagePercent = config.maxSlippagePercent || 1.0;
  const minLiquidityRatio = config.minLiquidityRatio || 10.0;
  const riskPerTrade = config.riskPerTrade || 0.01;
  const stopLossPercent = config.stopLossPercent || 0.02;
  const defaultAccountSize = config.accountSize || 10000;
  const maxCapitalPerTrade = config.maxCapitalPerTrade || 0.25;
  const limitOrderBuffer = config.limitOrderBuffer || 0.0005;
  const trailingPercent = config.trailingPercent || 0.01;

  // Helper: SMA
  const sma = (period: number, offset = 0): number => {
    if (state.priceHistory.length < period + offset) return 0;
    const relevant = state.priceHistory.slice(-(period + offset), state.priceHistory.length - offset);
    return relevant.reduce((a, b) => a + b, 0) / period;
  };
  // Helper: EMA
  const ema = (period: number, offset = 0): number => {
    if (state.priceHistory.length < period + offset) return 0;
    const relevant = state.priceHistory.slice(-(period + offset), state.priceHistory.length - offset);
    const k = 2 / (period + 1);
    let emaPrev = relevant[0];
    for (let i = 1; i < relevant.length; i++) {
      emaPrev = relevant[i] * k + emaPrev * (1 - k);
    }
    return emaPrev;
  };

  // Main logic
  return {
    getId: () => id,
    getName: () => name,
    getConfig: (): StrategyConfig => ({
      id,
      name,
      description: `Advanced MA strategy using ${config.useEMA ? "EMA" : "SMA"} (${config.shortPeriod}/${config.longPeriod})`,
      parameters: config as unknown as Record<string, unknown>,
    }),
    processMarketData: async (data: MarketData): Promise<StrategySignal | null> => {
      if (data.symbol !== config.symbol) return null;
      state.priceHistory.push(data.price);
      const requiredLength = Math.max(config.shortPeriod, config.longPeriod);
      if (state.priceHistory.length > requiredLength + 10) {
        state.priceHistory = state.priceHistory.slice(-requiredLength - 10);
      }
      if (state.priceHistory.length < requiredLength) return null;
      const shortMA = config.useEMA ? ema(config.shortPeriod) : sma(config.shortPeriod);
      const longMA = config.useEMA ? ema(config.longPeriod) : sma(config.longPeriod);
      const prevShortMA = config.useEMA ? ema(config.shortPeriod, 1) : sma(config.shortPeriod, 1);
      const prevLongMA = config.useEMA ? ema(config.longPeriod, 1) : sma(config.longPeriod, 1);
      // Crossovers
      if (shortMA > longMA && prevShortMA <= prevLongMA) {
        if (state.position === "short") {
          state.position = "none";
          state.lastEntryPrice = null;
          state.trailingStopPrice = null;
          return { type: "exit", direction: "short", price: data.price, reason: "MA bullish crossover" };
        } else if (state.position === "none") {
          state.position = "long";
          state.lastEntryPrice = data.price;
          state.trailingStopPrice = null;
          return { type: "entry", direction: "long", price: data.price, reason: "MA bullish crossover" };
        }
      } else if (shortMA < longMA && prevShortMA >= prevLongMA) {
        if (state.position === "long") {
          state.position = "none";
          state.lastEntryPrice = null;
          state.trailingStopPrice = null;
          return { type: "exit", direction: "long", price: data.price, reason: "MA bearish crossover" };
        } else if (state.position === "none") {
          state.position = "short";
          state.lastEntryPrice = data.price;
          state.trailingStopPrice = null;
          return { type: "entry", direction: "short", price: data.price, reason: "MA bearish crossover" };
        }
      }
      // Trailing stop (if enabled)
      if (config.trailingStop && state.position === "long" && state.lastEntryPrice) {
        const newTrail = data.price * (1 - trailingPercent);
        if (!state.trailingStopPrice || newTrail > state.trailingStopPrice) {
          state.trailingStopPrice = newTrail;
        }
        if (data.price < state.trailingStopPrice) {
          state.position = "none";
          state.lastEntryPrice = null;
          state.trailingStopPrice = null;
          return { type: "exit", direction: "long", price: data.price, reason: "Trailing stop hit" };
        }
      }
      if (config.trailingStop && state.position === "short" && state.lastEntryPrice) {
        const newTrail = data.price * (1 + trailingPercent);
        if (!state.trailingStopPrice || newTrail < state.trailingStopPrice) {
          state.trailingStopPrice = newTrail;
        }
        if (data.price > state.trailingStopPrice) {
          state.position = "none";
          state.lastEntryPrice = null;
          state.trailingStopPrice = null;
          return { type: "exit", direction: "short", price: data.price, reason: "Trailing stop hit" };
        }
      }
      return null;
    },
    generateOrder: (signal: StrategySignal, marketData: MarketData): OrderParams | null => {
      if (marketData.symbol !== config.symbol) return null;
      const orderSide = (signal.type === "entry" && signal.direction === "long") || (signal.type === "exit" && signal.direction === "short") ? OrderSide.BUY : OrderSide.SELL;
      const liquidityPrice = orderSide === OrderSide.BUY ? marketData.ask : marketData.bid;
      const midPrice = (marketData.bid + marketData.ask) / 2;
      const currentAccountSize = state.accountSize || defaultAccountSize;
      let positionSize: number;
      if (signal.type === "entry") {
        const riskAmount = currentAccountSize * riskPerTrade;
        const entryPrice = marketData.price;
        const stopLossDistance = entryPrice * stopLossPercent;
        positionSize = stopLossDistance > 0 ? riskAmount / stopLossDistance : 0;
        const maxPositionValue = currentAccountSize * maxCapitalPerTrade;
        const calculatedPositionValue = positionSize * entryPrice;
        if (calculatedPositionValue > maxPositionValue) {
          positionSize = maxPositionValue / entryPrice;
        }
      } else {
        positionSize = config.positionSize;
      }
      if (positionSize <= 0) return null;
      const currentSlippagePercent = Math.abs((liquidityPrice - midPrice) / midPrice) * 100;
      const estimatedLiquidity = marketData.volume / 24;
      const liquidityRatio = estimatedLiquidity / positionSize;
      let adjustedSize = positionSize;
      if (currentSlippagePercent > maxSlippagePercent) {
        const reductionFactor = maxSlippagePercent / currentSlippagePercent;
        adjustedSize = positionSize * reductionFactor;
      }
      if (liquidityRatio < minLiquidityRatio) {
        const liquidityReductionFactor = liquidityRatio / minLiquidityRatio;
        adjustedSize = adjustedSize * liquidityReductionFactor;
      }
      if (adjustedSize < positionSize * 0.1) return null;
      adjustedSize = Math.floor(adjustedSize * 10000) / 10000;
      const slippageBuffer = limitOrderBuffer;
      const limitPrice = orderSide === OrderSide.BUY
        ? Math.round((marketData.bid * (1 + slippageBuffer)) * 100) / 100
        : Math.round((marketData.ask * (1 - slippageBuffer)) * 100) / 100;
      const orderParams: OrderParams = {
        symbol: config.symbol,
        side: orderSide,
        type: OrderType.LIMIT,
        size: adjustedSize,
        price: limitPrice,
        timeInForce: TimeInForce.GOOD_TIL_CANCEL,
        postOnly: true
      };
      return orderParams;
    }
  };
};