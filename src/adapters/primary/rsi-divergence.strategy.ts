import {
  MarketData,
  OrderParams,
  OrderSide,
  OrderType,
  Strategy,
  StrategyConfig,
  StrategySignal,
  Result
} from "../../shared";
import { RSI } from 'technicalindicators';
import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";
import { result } from "../../shared/utils";

interface RsiDivergenceConfig {
  rsiPeriod: number;
  divergenceWindow: number;
  symbol: string;
  positionSize: number;
  overboughtLevel: number;
  oversoldLevel: number;
  maxSlippagePercent?: number;
  minLiquidityRatio?: number;
  riskPerTrade?: number;
  stopLossPercent?: number;
  accountSize?: number;
  maxCapitalPerTrade?: number;
  limitOrderBuffer?: number;
  useLimitOrders?: boolean;
}

interface RsiDivergenceState {
  priceHistory: number[];
  rsiHistory: number[];
  priceHighs: {price: number, index: number}[];
  priceLows: {price: number, index: number}[];
  rsiHighs: {rsi: number, index: number}[];
  rsiLows: {rsi: number, index: number}[];
  position: "none" | "long" | "short";
  lastEntryPrice: number | null;
  accountSize: number | null;
}

export const createRsiDivergenceStrategy = (config: RsiDivergenceConfig): Strategy => {
  const logger = createContextualLogger('RsiDivergenceStrategy');
  
  // État initial de la stratégie
  const state: RsiDivergenceState = {
    priceHistory: [],
    rsiHistory: [],
    priceHighs: [],
    priceLows: [],
    rsiHighs: [],
    rsiLows: [],
    position: "none",
    lastEntryPrice: null,
    accountSize: config.accountSize || null,
  };

  // Génerer un ID et un nom uniques pour la stratégie
  const id = `rsi-div-${config.rsiPeriod}-${config.symbol}`;
  const name = `RSI Divergence (${config.rsiPeriod})`;

  // Paramètres par défaut
  const maxSlippagePercent = config.maxSlippagePercent || 1.0;
  const minLiquidityRatio = config.minLiquidityRatio || 10.0;
  const useLimitOrders = config.useLimitOrders !== undefined ? config.useLimitOrders : true;

  // Recherche des pivots locaux (sommets/creux)
  const findPivots = (data: number[], window: number): { highs: {value: number, index: number}[], lows: {value: number, index: number}[] } => {
    const highs: {value: number, index: number}[] = [];
    const lows: {value: number, index: number}[] = [];
    
    // On a besoin d'au moins 2*window+1 points pour trouver un pivot
    if (data.length < 2 * window + 1) return { highs, lows };
    
    // Parcourir les données en ignorant les window premiers et derniers éléments
    for (let i = window; i < data.length - window; i++) {
      let isHigh = true;
      let isLow = true;
      
      // Vérifier si le point est un sommet local
      for (let j = 1; j <= window; j++) {
        if (data[i] <= data[i-j] || data[i] <= data[i+j]) {
          isHigh = false;
        }
        if (data[i] >= data[i-j] || data[i] >= data[i+j]) {
          isLow = false;
        }
        if (!isHigh && !isLow) break;
      }
      
      if (isHigh) highs.push({ value: data[i], index: i });
      if (isLow) lows.push({ value: data[i], index: i });
    }
    
    return { highs, lows };
  };

  // Détection des divergences
  const detectDivergences = (state: RsiDivergenceState): { 
    bullishDivergence: boolean, 
    bearishDivergence: boolean 
  } => {
    if (state.priceHistory.length < config.divergenceWindow * 2 || 
        state.rsiHistory.length < config.divergenceWindow * 2) {
      return { bullishDivergence: false, bearishDivergence: false };
    }
    
    // Obtenir les deux derniers creux de prix et de RSI
    const recentPriceLows = state.priceLows.slice(-2);
    const recentRsiLows = state.rsiLows.slice(-2);
    
    // Obtenir les deux derniers sommets de prix et de RSI
    const recentPriceHighs = state.priceHighs.slice(-2);
    const recentRsiHighs = state.rsiHighs.slice(-2);
    
    // Vérifier s'il y a suffisamment de pivots pour l'analyse
    if (recentPriceLows.length < 2 || recentRsiLows.length < 2 || 
        recentPriceHighs.length < 2 || recentRsiHighs.length < 2) {
      return { bullishDivergence: false, bearishDivergence: false };
    }
    
    // Divergence haussière: Prix fait des creux plus bas mais RSI fait des creux plus hauts
    const bullishDivergence = 
      recentPriceLows[1].price < recentPriceLows[0].price && 
      recentRsiLows[1].rsi > recentRsiLows[0].rsi &&
      Math.abs(recentPriceLows[1].index - recentRsiLows[1].index) <= 3;
    
    // Divergence baissière: Prix fait des sommets plus hauts mais RSI fait des sommets plus bas
    const bearishDivergence = 
      recentPriceHighs[1].price > recentPriceHighs[0].price && 
      recentRsiHighs[1].rsi < recentRsiHighs[0].rsi &&
      Math.abs(recentPriceHighs[1].index - recentRsiHighs[1].index) <= 3;
    
    return { bullishDivergence, bearishDivergence };
  };

  return {
    getId: () => id,
    getName: () => name,
    getConfig: () => ({
      id,
      name,
      description: "Stratégie de trading basée sur la détection de divergences entre le prix et le RSI",
      parameters: config as unknown as Record<string, unknown>,
    }),

    processMarketData: async (data: MarketData): Promise<StrategySignal | null> => {
      try {
        logger.debug(`Processing market data for RSI Divergence: ${JSON.stringify(data)}`, { symbol: data.symbol });
        if (data.symbol !== config.symbol) return null;
        
        // Validation des données
        if (!data.price || data.price <= 0) {
          logger.warn("Prix de marché invalide reçu", { symbol: data.symbol, price: data.price });
          return null;
        }
        
        // Ajouter le prix actuel à l'historique
        state.priceHistory.push(data.price);
        logger.debug(`Price added to history`, { symbol: data.symbol, price: data.price, historyLength: state.priceHistory.length });
        
        // Garder un historique de taille raisonnable
        const maxHistorySize = config.rsiPeriod * 10;
        if (state.priceHistory.length > maxHistorySize) {
          state.priceHistory = state.priceHistory.slice(-maxHistorySize);
          logger.debug(`Price history trimmed`, { symbol: data.symbol, newLength: state.priceHistory.length });
        }
        
        // S'assurer que nous avons suffisamment de données pour calculer le RSI
        if (state.priceHistory.length > config.rsiPeriod) {
          // Calculer le RSI
          const rsiInput = {
            values: state.priceHistory,
            period: config.rsiPeriod
          };
          logger.debug(`RSI input data`, { symbol: data.symbol, valuesCount: rsiInput.values.length, period: rsiInput.period, lastFewPrices: rsiInput.values.slice(-5) });
          const rsiResult = RSI.calculate(rsiInput);
          
          // Ajouter le RSI actuel à l'historique
          if (rsiResult.length > 0) {
            const currentRsi = rsiResult[rsiResult.length - 1];
            state.rsiHistory.push(currentRsi);
            
            // Garder un historique RSI de taille raisonnable
            if (state.rsiHistory.length > maxHistorySize) {
              state.rsiHistory = state.rsiHistory.slice(-maxHistorySize);
            }
            logger.debug(`RSI calculated and added`, { symbol: data.symbol, rsi: currentRsi, rsiHistoryLength: state.rsiHistory.length });
          
          // Trouver les pivots sur les données de prix et de RSI
          const pricePivots = findPivots(state.priceHistory, config.divergenceWindow);
          const rsiPivots = findPivots(state.rsiHistory, config.divergenceWindow);
          logger.debug(`Pivots found`, { 
            symbol: data.symbol, 
            priceHighs: pricePivots.highs.length, 
            priceLows: pricePivots.lows.length,
            rsiHighs: rsiPivots.highs.length,
            rsiLows: rsiPivots.lows.length
          });
          
          // Mettre à jour les pivots dans l'état
          state.priceHighs = pricePivots.highs.map(h => ({ price: h.value, index: h.index }));
          state.priceLows = pricePivots.lows.map(l => ({ price: l.value, index: l.index }));
          state.rsiHighs = rsiPivots.highs.map(h => ({ rsi: h.value, index: h.index }));
          state.rsiLows = rsiPivots.lows.map(l => ({ rsi: l.value, index: l.index }));
          
          // Détecter les divergences
          const { bullishDivergence, bearishDivergence } = detectDivergences(state);
          logger.debug(`Divergence analysis`, { 
            symbol: data.symbol, 
            bullishDivergence, 
            bearishDivergence,
            currentRsi,
            oversoldLevel: config.oversoldLevel,
            overboughtLevel: config.overboughtLevel,
            position: state.position
          });
          
          // Générer des signaux basés sur les divergences et les niveaux de surachat/survente
          if (bullishDivergence && currentRsi < config.oversoldLevel && state.position !== "long") {
            logger.info(`Divergence haussière détectée sur ${data.symbol} avec RSI = ${currentRsi}`);
            // Signal d'entrée long
            state.position = "long";
            state.lastEntryPrice = data.price;
            return {
              type: "entry",
              direction: "long",
              price: data.price,
              reason: "Divergence haussière RSI-Prix",
            };
          } else if (bearishDivergence && currentRsi > config.overboughtLevel && state.position !== "short") {
            logger.info(`Divergence baissière détectée sur ${data.symbol} avec RSI = ${currentRsi}`);
            // Signal d'entrée short
            state.position = "short";
            state.lastEntryPrice = data.price;
            return {
              type: "entry",
              direction: "short",
              price: data.price,
              reason: "Divergence baissière RSI-Prix",
            };
          } else if (state.position === "long" && (bearishDivergence || currentRsi > config.overboughtLevel + 10)) {
            // Signal de sortie de position longue
            state.position = "none";
            return {
              type: "exit",
              direction: "long",
              price: data.price,
              reason: "Fin de divergence haussière ou surachat extrême",
            };
          } else if (state.position === "short" && (bullishDivergence || currentRsi < config.oversoldLevel - 10)) {
            // Signal de sortie de position courte
            state.position = "none";
            return {
              type: "exit",
              direction: "short",
              price: data.price,
              reason: "Fin de divergence baissière ou survente extrême",
            };
          }
        }
      } else {
        logger.debug("Insufficient data for RSI calculation", {
          currentLength: state.priceHistory.length,
          requiredLength: config.rsiPeriod
        });
      }
      
      // Limiter la taille de l'historique pour économiser la mémoire
      if (state.priceHistory.length > config.rsiPeriod * 3) {
        state.priceHistory = state.priceHistory.slice(-config.rsiPeriod * 3);
      }
      if (state.rsiHistory.length > config.rsiPeriod * 3) {
        state.rsiHistory = state.rsiHistory.slice(-config.rsiPeriod * 3);
      }
      
      return null;
      
    } catch (error) {
      logger.error("Error processing market data in RSI Divergence strategy", error as Error, {
        symbol: data.symbol,
        price: data.price,
        historyLength: state.priceHistory.length
      });
      return null;
    }
  },

    generateOrder: (signal: StrategySignal, marketData: MarketData): OrderParams | null => {
      if (marketData.symbol !== config.symbol) return null;

      // Déterminer le côté de l'ordre
      const orderSide =
        (signal.type === "entry" && signal.direction === "long") ||
        (signal.type === "exit" && signal.direction === "short")
          ? OrderSide.BUY
          : OrderSide.SELL;

      // Vérifier la liquidité disponible
      const liquidityPrice = orderSide === OrderSide.BUY ? marketData.ask : marketData.bid;
      const midPrice = (marketData.bid + marketData.ask) / 2;
      
      // Calculer la taille de l'ordre
      let adjustedSize = config.positionSize;
      
      // Vérifier si la liquidité est suffisante
      const availableLiquidity = marketData.volume * liquidityPrice;
      const orderValue = adjustedSize * liquidityPrice;
      
      // Réduire la taille de l'ordre si la liquidité est insuffisante
      if (availableLiquidity < orderValue * minLiquidityRatio) {
        const liquidityReductionFactor = (availableLiquidity / (orderValue * minLiquidityRatio));
        adjustedSize = adjustedSize * liquidityReductionFactor;
      }

      // Si la taille ajustée est trop petite, ne pas passer d'ordre
      if (adjustedSize < config.positionSize * 0.1) {
        return null;
      }

      // Arrondir la taille à 4 décimales
      adjustedSize = Math.floor(adjustedSize * 10000) / 10000;

      // Calculer le prix limite pour les ordres limites
      const slippageBuffer = config.limitOrderBuffer || 0.0005;
      const limitPrice =
        orderSide === OrderSide.BUY
          ? Math.round(marketData.bid * (1 + slippageBuffer) * 100) / 100
          : Math.round(marketData.ask * (1 - slippageBuffer) * 100) / 100;

      // Créer les paramètres de l'ordre
      const orderParams: OrderParams = {
        symbol: config.symbol,
        side: orderSide,
        type: useLimitOrders ? OrderType.LIMIT : OrderType.MARKET,
        size: adjustedSize,
      };

      // Ajouter le prix limite pour les ordres limites
      if (useLimitOrders && orderParams.type === OrderType.LIMIT) {
        orderParams.price = limitPrice;
        orderParams.postOnly = true;
      }

      return orderParams;
    },
  };
};
