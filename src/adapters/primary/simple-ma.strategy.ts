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
  maxSlippagePercent?: number; // Pourcentage maximal de slippage accepté
  minLiquidityRatio?: number; // Ratio minimum de liquidité par rapport à la taille de l'ordre
  riskPerTrade?: number; // Pourcentage du capital à risquer par trade (0.01 = 1%)
  stopLossPercent?: number; // Pourcentage de stop loss par rapport au prix d'entrée
  accountSize?: number; // Taille du compte en USD (optionnel, sera récupéré dynamiquement si non fourni)
  maxCapitalPerTrade?: number; // Pourcentage maximum du capital pour un trade (0.25 = 25%)
  limitOrderBuffer?: number; // Buffer pour les ordres limite (0.0005 = 0.05%)
  useLimitOrders?: boolean; // Utiliser des ordres limite au lieu d'ordres au marché
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

  // Set default values for parameters
  const maxSlippagePercent = config.maxSlippagePercent || 1.0; // 1% par défaut
  const minLiquidityRatio = config.minLiquidityRatio || 10.0; // 10x taille de l'ordre par défaut
  const riskPerTrade = config.riskPerTrade || 0.01; // 1% du capital par défaut
  const stopLossPercent = config.stopLossPercent || 0.02; // 2% par défaut
  const defaultAccountSize = config.accountSize || 10000; // 10000 USD par défaut si non spécifié
  const maxCapitalPerTrade = config.maxCapitalPerTrade || 0.25; // 25% maximum du capital par trade
  const limitOrderBuffer = config.limitOrderBuffer || 0.0005; // 0.05% buffer par défaut pour les ordres limite
  const useLimitOrders = config.useLimitOrders !== undefined ? config.useLimitOrders : false; // Utiliser des ordres au marché par défaut

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
          state.lastEntryPrice = null;
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
          state.lastEntryPrice = data.price;
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
          state.lastEntryPrice = null;
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
          state.lastEntryPrice = data.price;
          return entrySignal;
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

        // S'assurer que la taille est proportionnelle au buying power (max 25% du capital)
        const maxPositionValue = currentAccountSize * 0.25;
        const calculatedPositionValue = positionSize * entryPrice;

        // Réduire la taille si elle dépasse le pourcentage maximum du capital
        if (calculatedPositionValue > maxPositionValue) {
          positionSize = maxPositionValue / entryPrice;
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

      // Calculer le prix limite en fonction du côté de l'ordre
      // Pour les achats, on place légèrement au-dessus du bid (meilleure chance d'exécution)
      // Pour les ventes, on place légèrement en-dessous du ask
      const slippageBuffer = 0.0005; // 0.05% de buffer pour augmenter les chances d'exécution
      const limitPrice =
        orderSide === OrderSide.BUY
          ? Math.round(marketData.bid * (1 + slippageBuffer) * 100) / 100 // Arrondi à 2 décimales
          : Math.round(marketData.ask * (1 - slippageBuffer) * 100) / 100;

      // Déterminer si on utilise un ordre limite ou au marché
      const orderParams: OrderParams = {
        symbol: config.symbol,
        side: orderSide,
        type: useLimitOrders ? OrderType.LIMIT : OrderType.MARKET,
        size: adjustedSize,
      };

      // Si on utilise un ordre limite, ajouter le prix limite
      if (useLimitOrders && orderParams.type === OrderType.LIMIT) {
        orderParams.price = limitPrice;
        orderParams.postOnly = true; // Garantir l'ajout de liquidité
      }

      return orderParams;
    },
  };
};
