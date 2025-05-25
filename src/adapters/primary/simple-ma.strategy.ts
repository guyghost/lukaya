/**
 * Stratégie Simple Moving Average (SMA) Crossover
 * Utilise le croisement de moyennes mobiles pour générer des signaux de trading
 */

import { 
  MarketData, 
  OrderParams,
  OrderSide,
  OrderType,
  TimeInForce,
  Strategy,
  StrategyConfig,
  StrategySignal,
  Result
} from "../../shared";
import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";
import { result } from "../../shared/utils";

export interface SimpleMAConfig {
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
  useLimitOrders?: boolean;
}

interface SimpleMAState {
  priceHistory: number[];
  position: "long" | "short" | "none";
  lastEntryPrice: number | null;
  accountSize: number | null;
}

export const createSimpleMAStrategy = (config: SimpleMAConfig): Strategy => {
  const logger = createContextualLogger('SimpleMA');
  
  // Create strategy state
  const state: SimpleMAState = {
    priceHistory: [],
    position: "none",
    lastEntryPrice: null,
    accountSize: config.accountSize || null
  };
  
  // Generate unique ID and name for the strategy
  const id = `simple-ma-${config.shortPeriod}-${config.longPeriod}-${config.symbol}`;
  const name = `Simple Moving Average (${config.shortPeriod}/${config.longPeriod})`;
  
  // Set default values for parameters
  const maxSlippagePercent = config.maxSlippagePercent || 1.0;
  const minLiquidityRatio = config.minLiquidityRatio || 10.0;
  const riskPerTrade = config.riskPerTrade || 0.01;
  const stopLossPercent = config.stopLossPercent || 0.02;
  const defaultAccountSize = config.accountSize || 10000;
  const maxCapitalPerTrade = config.maxCapitalPerTrade || 0.25;
  const limitOrderBuffer = config.limitOrderBuffer || 0.0005;
  const useLimitOrders = config.useLimitOrders || false;
  
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
      try {
        if (data.symbol !== config.symbol) return null;

        // Validation des données
        if (!data.price || data.price <= 0 || !isFinite(data.price)) {
          logger.warn("Prix de marché invalide reçu", { 
            symbol: data.symbol, 
            price: data.price 
          });
          return null;
        }

        // Add price to history
        state.priceHistory.push(data.price);

        // Keep only the required data points plus some buffer for memory efficiency
        const requiredLength = Math.max(config.shortPeriod, config.longPeriod);
        const maxHistorySize = requiredLength * 2;
        if (state.priceHistory.length > maxHistorySize) {
          state.priceHistory = state.priceHistory.slice(-maxHistorySize);
        }

        // Not enough data yet
        if (state.priceHistory.length < requiredLength) {
          logger.debug("Insufficient data for MA calculation", {
            currentLength: state.priceHistory.length,
            requiredLength
          });
          return null;
        }

        // Calculate moving averages
        const shortMA = calculateMA(config.shortPeriod);
        const longMA = calculateMA(config.longPeriod);

        // Validate MA calculations
        if (!isFinite(shortMA) || !isFinite(longMA)) {
          logger.warn("Invalid MA calculation result", { shortMA, longMA });
          return null;
        }

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
      
    } catch (error) {
      logger.error("Error processing market data in Simple MA strategy", error as Error, {
        symbol: data.symbol,
        price: data.price,
        historyLength: state.priceHistory.length
      });
      return null;
    }
  },
    
    generateOrder: (signal: StrategySignal, marketData: MarketData): OrderParams | null => {
      try {
        if (marketData.symbol !== config.symbol) return null;

        // Validation des données de marché
        if (!marketData.price || !marketData.bid || !marketData.ask || 
            marketData.price <= 0 || marketData.bid <= 0 || marketData.ask <= 0) {
          logger.warn("Données de marché invalides pour génération d'ordre", {
            symbol: marketData.symbol,
            price: marketData.price,
            bid: marketData.bid,
            ask: marketData.ask
          });
          return null;
        }

        // Déterminer le côté de l'ordre
        const orderSide = 
          (signal.type === "entry" && signal.direction === "long") || 
          (signal.type === "exit" && signal.direction === "short") 
            ? OrderSide.BUY 
            : OrderSide.SELL;
        
        // Vérifier la liquidité disponible
        const liquidityPrice = orderSide === OrderSide.BUY ? marketData.ask : marketData.bid;
        const midPrice = (marketData.bid + marketData.ask) / 2;
        
        // Utiliser la taille de compte configurée ou par défaut
        const currentAccountSize = state.accountSize || defaultAccountSize;
      
      // Calculer la taille de position basée sur le risque
      let positionSize: number;
      
      if (signal.type === "entry") {
        // Pour les ordres d'entrée, calculer la taille en fonction du risque et du stop loss
        const riskAmount = currentAccountSize * riskPerTrade;
        const entryPrice = marketData.price;
        const stopLossDistance = entryPrice * stopLossPercent;
        
        positionSize = stopLossDistance > 0 ? riskAmount / stopLossDistance : config.positionSize;
        
        // S'assurer que la taille est proportionnelle au buying power (max 25% du capital)
        const maxPositionValue = currentAccountSize * maxCapitalPerTrade;
        const calculatedPositionValue = positionSize * entryPrice;
        
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
      const currentSlippagePercent = Math.abs((liquidityPrice - midPrice) / midPrice) * 100;
      
      // Estimer la liquidité disponible
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
      
      // Si la taille ajustée est trop petite, ne pas passer d'ordre
      if (adjustedSize < positionSize * 0.1) {
        return null;
      }
      
      // Arrondir la taille à 4 décimales
      adjustedSize = Math.floor(adjustedSize * 10000) / 10000;
      
      // Calculer le prix limite
      const slippageBuffer = limitOrderBuffer;
      const limitPrice = orderSide === OrderSide.BUY 
        ? Math.round((marketData.bid * (1 + slippageBuffer)) * 100) / 100
        : Math.round((marketData.ask * (1 - slippageBuffer)) * 100) / 100;
      
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
        orderParams.timeInForce = TimeInForce.GOOD_TIL_CANCEL;
        orderParams.postOnly = true;
      }
      
      return orderParams;
      
    } catch (error) {
      logger.error("Error generating order in Simple MA strategy", error as Error, {
        symbol: marketData.symbol,
        signalType: signal.type,
        signalDirection: signal.direction
      });
      return null;
    }
  }
  };
};
