import {
  MarketData,
  OrderParams,
  OrderSide,
  OrderType,
  TimeInForce,
} from "../../domain/models/market.model";
import {
  Strategy,
  StrategyConfig,
  StrategySignal,
} from "../../domain/models/strategy.model";

interface SimpleMAConfig {
  shortPeriod: number;
  longPeriod: number;
  symbol: string;
  positionSize: number;
  maxSlippagePercent?: number;
  minLiquidityRatio?: number;
  riskPerTrade?: number;
  stopLossPercent?: number;
  accountSize?: number;
  maxCapitalPerTrade?: number;
  limitOrderBuffer?: number;
  // Nouveaux indicateurs
  useRSI?: boolean;
  rsiPeriod?: number;
  rsiOverbought?: number;
  rsiOversold?: number;
  useMACD?: boolean;
  macdFastPeriod?: number;
  macdSlowPeriod?: number;
  macdSignalPeriod?: number;
  useBollinger?: boolean;
  bollingerPeriod?: number;
  bollingerStdDev?: number;
}

interface SimpleMAState {
  priceHistory: number[];
  position: "none" | "long" | "short";
  lastEntryPrice: number | null;
  accountSize: number | null;
}

export const createSimpleMAStrategy = (config: SimpleMAConfig): Strategy => {
  // Create strategy state
  const state: SimpleMAState = {
    priceHistory: [],
    position: "none",
    lastEntryPrice: null,
    accountSize: config.accountSize || null,
  };

  // Generate unique ID and name for the strategy
  const id = `simple-ma-${config.shortPeriod}-${config.longPeriod}-${config.symbol}`;
  const name = `Simple Moving Average (${config.shortPeriod}/${config.longPeriod})`;

  // Set default values for parameters - version très agressive
  const maxSlippagePercent = config.maxSlippagePercent || 2.0; // 2.0% par défaut (encore plus augmenté)
  const minLiquidityRatio = config.minLiquidityRatio || 6.0; // 6x taille de l'ordre par défaut (encore plus réduit pour marchés moins liquides)
  const riskPerTrade = config.riskPerTrade || 0.03; // 3% du capital par défaut (triplé par rapport à l'original)
  const stopLossPercent = config.stopLossPercent || 0.04; // 4% par défaut (doublé par rapport à l'original)
  const defaultAccountSize = config.accountSize || 10000; // 10000 USD par défaut si non spécifié
  const maxCapitalPerTrade = config.maxCapitalPerTrade || 0.45; // 45% maximum du capital par trade (augmenté encore plus)
  const limitOrderBuffer = config.limitOrderBuffer || 0.002; // 0.2% buffer par défaut pour les ordres limite (doublé)

  // Helper function to calculate moving average
  const calculateMA = (period: number, offset: number = 0): number => {
    if (state.priceHistory.length < period + offset) return 0;

    const relevantPrices = state.priceHistory.slice(
      -(period + offset),
      state.priceHistory.length - offset,
    );

    const sum = relevantPrices.reduce((acc, price) => acc + price, 0);
    return sum / period;
  };

  // Helpers pour indicateurs
  const calculateRSI = (period: number): number => {
    if (state.priceHistory.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = state.priceHistory.length - period; i < state.priceHistory.length; i++) {
      const diff = state.priceHistory[i] - state.priceHistory[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  };

  const calculateMACD = (fast: number, slow: number, signal: number): { macd: number, signal: number, hist: number } => {
    if (state.priceHistory.length < slow + signal) return { macd: 0, signal: 0, hist: 0 };
    const ema = (period: number, offset = 0) => {
      const k = 2 / (period + 1);
      let emaPrev = state.priceHistory[state.priceHistory.length - period - offset];
      for (let i = state.priceHistory.length - period - offset + 1; i < state.priceHistory.length - offset; i++) {
        emaPrev = state.priceHistory[i] * k + emaPrev * (1 - k);
      }
      return emaPrev;
    };
    const macdLine = ema(fast) - ema(slow);
    // Signal line
    let signalLine = macdLine;
    let prevMacd = macdLine;
    for (let i = 1; i < signal; i++) {
      prevMacd = ema(fast, i) - ema(slow, i);
      signalLine = prevMacd * (2 / (signal + 1)) + signalLine * (1 - 2 / (signal + 1));
    }
    return { macd: macdLine, signal: signalLine, hist: macdLine - signalLine };
  };

  const calculateBollinger = (period: number, stdDev: number): { upper: number, lower: number, middle: number } => {
    if (state.priceHistory.length < period) return { upper: 0, lower: 0, middle: 0 };
    const prices = state.priceHistory.slice(-period);
    const mean = prices.reduce((a, b) => a + b, 0) / period;
    const variance = prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    return { upper: mean + stdDev * std, lower: mean - stdDev * std, middle: mean };
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

    processMarketData: async (
      data: MarketData,
    ): Promise<StrategySignal | null> => {
      if (data.symbol !== config.symbol) return null;
      state.priceHistory.push(data.price);
      const requiredLength = Math.max(
        config.shortPeriod,
        config.longPeriod,
        config.rsiPeriod || 14,
        config.macdSlowPeriod || 26,
        config.bollingerPeriod || 20
      );
      if (state.priceHistory.length > requiredLength) {
        state.priceHistory = state.priceHistory.slice(-requiredLength);
      }
      if (state.priceHistory.length < requiredLength) return null;
      // MA
      const shortMA = calculateMA(config.shortPeriod);
      const longMA = calculateMA(config.longPeriod);
      const prevShortMA = calculateMA(config.shortPeriod, 1);
      const prevLongMA = calculateMA(config.longPeriod, 1);
      // RSI
      let rsi = 50;
      if (config.useRSI) {
        rsi = calculateRSI(config.rsiPeriod || 14);
      }
      // MACD
      let macd = { macd: 0, signal: 0, hist: 0 };
      if (config.useMACD) {
        macd = calculateMACD(
          config.macdFastPeriod || 12,
          config.macdSlowPeriod || 26,
          config.macdSignalPeriod || 9
        );
      }
      // Bollinger
      let boll = { upper: 0, lower: 0, middle: 0 };
      if (config.useBollinger) {
        boll = calculateBollinger(
          config.bollingerPeriod || 20,
          config.bollingerStdDev || 2
        );
      }
      // LOGS
      console.log(`[${data.symbol}] MA: short=${shortMA.toFixed(2)}, long=${longMA.toFixed(2)} | RSI: ${rsi.toFixed(2)} | MACD: ${macd.macd.toFixed(2)}, signal=${macd.signal.toFixed(2)}, hist=${macd.hist.toFixed(2)} | Boll: upper=${boll.upper.toFixed(2)}, lower=${boll.lower.toFixed(2)}, price=${data.price}`);
      // Logique de signal combinée
      let entryLong = shortMA > longMA && prevShortMA <= prevLongMA;
      let entryShort = shortMA < longMA && prevShortMA >= prevLongMA;
      if (config.useRSI) {
        entryLong = entryLong && rsi < (config.rsiOversold || 40); // Plus agressif: 40 au lieu de 30
        entryShort = entryShort && rsi > (config.rsiOverbought || 60); // Plus agressif: 60 au lieu de 70
      }
      if (config.useMACD) {
        // Plus agressif: vérifier seulement la direction, pas besoin que l'histogramme soit positif
        entryLong = entryLong && macd.macd > macd.signal; 
        entryShort = entryShort && macd.macd < macd.signal;
      }
      if (config.useBollinger) {
        // Plus agressif: permettre les entrées quand le prix est proche des bandes
        const bollingerBuffer = 0.003; // 0.3% buffer
        entryLong = entryLong && data.price < (boll.lower * (1 + bollingerBuffer));
        entryShort = entryShort && data.price > (boll.upper * (1 - bollingerBuffer));
      }
      if (entryLong) {
        if (state.position === "short") {
          state.position = "none";
          state.lastEntryPrice = null;
          console.log(`[${data.symbol}] Signal EXIT short (long combiné)`);
          return { type: "exit", direction: "short", price: data.price, reason: "Signal long combiné" };
        } else if (state.position === "none") {
          state.position = "long";
          state.lastEntryPrice = data.price;
          console.log(`[${data.symbol}] Signal ENTRY long (combiné)`);
          return { type: "entry", direction: "long", price: data.price, reason: "Signal long combiné" };
        }
      } else if (entryShort) {
        if (state.position === "long") {
          state.position = "none";
          state.lastEntryPrice = null;
          console.log(`[${data.symbol}] Signal EXIT long (short combiné)`);
          return { type: "exit", direction: "long", price: data.price, reason: "Signal short combiné" };
        } else if (state.position === "none") {
          state.position = "short";
          state.lastEntryPrice = data.price;
          console.log(`[${data.symbol}] Signal ENTRY short (combiné)`);
          return { type: "entry", direction: "short", price: data.price, reason: "Signal short combiné" };
        }
      }
      return null;
    },

    generateOrder: (
      signal: StrategySignal,
      marketData: MarketData,
    ): OrderParams | null => {
      if (marketData.symbol !== config.symbol) return null;

      // Déterminer le côté de l'ordre
      const orderSide =
        (signal.type === "entry" && signal.direction === "long") ||
        (signal.type === "exit" && signal.direction === "short")
          ? OrderSide.BUY
          : OrderSide.SELL;

      // Vérifier la liquidité disponible
      const liquidityPrice =
        orderSide === OrderSide.BUY ? marketData.ask : marketData.bid;
      const midPrice = (marketData.bid + marketData.ask) / 2;

      // Utiliser la taille de compte configurée ou par défaut
      const currentAccountSize = state.accountSize || defaultAccountSize;

      // Calculer la taille de position basée sur le risque
      let positionSize: number;

      if (signal.type === "entry") {
        // Pour les ordres d'entrée, calculer la taille en fonction du risque et du stop loss
        // Montant à risquer = taille du compte * pourcentage de risque par trade
        const riskAmount = currentAccountSize * riskPerTrade;

        // Distance jusqu'au stop loss (en USD)
        // Pour un ordre long: prix d'entrée - prix du stop loss
        // Pour un ordre short: prix du stop loss - prix d'entrée
        const entryPrice = marketData.price;
        const stopLossDistance = entryPrice * stopLossPercent;

        // Taille de la position = montant à risquer / distance jusqu'au stop loss
        positionSize = stopLossDistance > 0 ? riskAmount / stopLossDistance : 0;

        // S'assurer que la taille est proportionnelle au buying power - version agressive
        // Utiliser maxCapitalPerTrade (45% par défaut) au lieu de hardcoder 25%
        const maxPositionValue = currentAccountSize * maxCapitalPerTrade;
        const calculatedPositionValue = positionSize * entryPrice;

        // Version plus agressive - si le calcul basé sur le risque génère une position plus grande,
        // on l'autorise jusqu'à 25% plus grande que la limite du capital par trade
        if (calculatedPositionValue > maxPositionValue * 1.25) {
          positionSize = (maxPositionValue * 1.25) / entryPrice;
        }
      } else {
        // Pour les ordres de sortie, utiliser la même taille que l'entrée
        positionSize = config.positionSize;
      }

      // Vérifier que la taille n'est pas nulle ou invalide
      if (positionSize <= 0) {
        return null;
      }

      // Calculer le slippage actuel
      const currentSlippagePercent =
        Math.abs((liquidityPrice - midPrice) / midPrice) * 100;

      // Estimer la liquidité disponible à partir de l'écart entre le prix et le volume
      // Dans un cas réel, on pourrait utiliser la profondeur du carnet d'ordres
      const estimatedLiquidity = marketData.volume / 24; // Volume horaire approximatif
      const liquidityRatio = estimatedLiquidity / positionSize;

      // Ajuster la taille de la position en fonction de la liquidité
      let adjustedSize = positionSize;

      // Si le slippage est trop élevé, réduire la taille de l'ordre
      if (currentSlippagePercent > maxSlippagePercent) {
        const reductionFactor = maxSlippagePercent / currentSlippagePercent;
        adjustedSize = positionSize * reductionFactor;
      }

      // Si la liquidité est insuffisante, réduire davantage la taille
      if (liquidityRatio < minLiquidityRatio) {
        const liquidityReductionFactor = liquidityRatio / minLiquidityRatio;
        adjustedSize = adjustedSize * liquidityReductionFactor;
      }

      // Si la taille ajustée est trop petite (moins de 10% de la taille originale), ne pas passer d'ordre
      if (adjustedSize < positionSize * 0.1) {
        return null; // Liquidité insuffisante, ne pas passer d'ordre
      }

      // Arrondir la taille à 4 décimales pour éviter les erreurs de précision
      adjustedSize = Math.floor(adjustedSize * 10000) / 10000;

      // Calculer le prix limite en fonction du côté de l'ordre - version plus agressive
      // Pour les achats, on place considérablement au-dessus du bid (exécution garantie)
      // Pour les ventes, on place considérablement en-dessous du ask
      const slippageBuffer = limitOrderBuffer || 0.002; // 0.2% de buffer pour garantir l'exécution (augmenté)
      const limitPrice =
        orderSide === OrderSide.BUY
          ? Math.round(marketData.bid * (1 + slippageBuffer * 1.5) * 100) / 100 // Augmenté de 50% supplémentaires
          : Math.round(marketData.ask * (1 - slippageBuffer * 1.5) * 100) / 100;

      // Pour les ordres d'entrée - version agressive avec ordre limite plus agressif
      // Utiliser des ordres limite avec un buffer agressif pour garantir l'exécution mais obtenir un meilleur prix
      const orderParams: OrderParams = {
        symbol: config.symbol,
        side: orderSide,
        type: OrderType.LIMIT, // Utiliser LIMIT au lieu de MARKET pour de meilleurs prix potentiels
        size: adjustedSize,
        price: limitPrice,
        timeInForce: TimeInForce.IMMEDIATE_OR_CANCEL // Exécuter immédiatement ou annuler
      };

      return orderParams;
    },
  };
};
