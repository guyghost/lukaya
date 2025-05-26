import {
  MarketData,
  OrderParams,
  OrderSide,
  OrderType,
  Strategy,
  StrategySignal
} from "../../shared";
import { RSI } from 'technicalindicators';
import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";

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
  
  // Réduire la taille de la fenêtre de divergence si elle est trop grande
  // Une fenêtre plus petite détectera plus facilement des pivots
  if (config.divergenceWindow > 5) {
    logger.info(`Réduction de la taille de fenêtre de divergence de ${config.divergenceWindow} à 3 pour améliorer la détection des pivots`);
    config.divergenceWindow = 3;
  }
  
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

  // Recherche des pivots locaux (sommets/creux) avec une approche très souple
  const findPivots = (data: number[], window: number): { highs: {value: number, index: number}[], lows: {value: number, index: number}[] } => {
    const highs: {value: number, index: number}[] = [];
    const lows: {value: number, index: number}[] = [];
    
    // Utiliser une fenêtre minimale de 1 pour permettre la détection des pivots même avec peu de données
    const effectiveWindow = Math.max(1, Math.min(window, Math.floor(data.length / 5)));
    
    logger.debug(`Finding pivots with window ${effectiveWindow} in ${data.length} data points`, {
      originalWindow: window,
      effectiveWindow,
      dataLength: data.length
    });
    
    // On a besoin d'au moins 2*effectiveWindow+1 points pour trouver un pivot
    if (data.length < 2 * effectiveWindow + 1) {
      logger.debug(`Not enough data for pivot detection: ${data.length} points, need ${2 * effectiveWindow + 1}`);
      
      // Si nous avons trop peu de données, mais au moins 3 points, essayons de détecter les pivots avec une fenêtre de 1
      if (data.length >= 3) {
        logger.debug(`Attempting simplified pivot detection with only ${data.length} points`);
        return findSimplePivots(data);
      }
      
      return { highs, lows };
    }
    
    // Parcourir les données en ignorant les effectiveWindow premiers et derniers éléments
    for (let i = effectiveWindow; i < data.length - effectiveWindow; i++) {
      // Pour être un sommet/creux, le point doit être supérieur/inférieur à un certain pourcentage des points dans la fenêtre
      let higherCount = 0;
      let lowerCount = 0;
      
      for (let j = 1; j <= effectiveWindow; j++) {
        if (data[i] > data[i-j]) higherCount++;
        if (data[i] > data[i+j]) higherCount++;
        if (data[i] < data[i-j]) lowerCount++;
        if (data[i] < data[i+j]) lowerCount++;
      }
      
      // Calculer le pourcentage de points qui sont inférieurs/supérieurs
      const totalPoints = effectiveWindow * 2;
      const higherPercentage = (higherCount / totalPoints) * 100;
      const lowerPercentage = (lowerCount / totalPoints) * 100;
      
      // Seuil réduit pour considérer un point comme un sommet ou un creux (60%)
      const pivotThreshold = 60;
      
      if (higherPercentage >= pivotThreshold) {
        logger.debug(`Found HIGH pivot at index ${i} with value ${data[i]} (${higherPercentage.toFixed(1)}% higher)`);
        highs.push({ value: data[i], index: i });
      }
      
      if (lowerPercentage >= pivotThreshold) {
        logger.debug(`Found LOW pivot at index ${i} with value ${data[i]} (${lowerPercentage.toFixed(1)}% lower)`);
        lows.push({ value: data[i], index: i });
      }
    }
    
    logger.debug(`Pivot detection complete: found ${highs.length} highs and ${lows.length} lows`);
    
    // Si aucun pivot n'a été trouvé avec l'approche normale, essayer l'approche simplifiée
    if (highs.length === 0 && lows.length === 0 && data.length >= 3) {
      logger.debug(`No pivots found with normal method, trying simplified detection`);
      return findSimplePivots(data);
    }
    
    return { highs, lows };
  };
  
  // Méthode simplifiée pour trouver les pivots dans une série très courte
  const findSimplePivots = (data: number[]): { highs: {value: number, index: number}[], lows: {value: number, index: number}[] } => {
    const highs: {value: number, index: number}[] = [];
    const lows: {value: number, index: number}[] = [];
    
    // Trouver le max et min global
    let maxValue = -Infinity;
    let minValue = Infinity;
    let maxIndex = 0;
    let minIndex = 0;
    
    for (let i = 0; i < data.length; i++) {
      if (data[i] > maxValue) {
        maxValue = data[i];
        maxIndex = i;
      }
      if (data[i] < minValue) {
        minValue = data[i];
        minIndex = i;
      }
    }
    
    // Ajouter les pivots globaux
    highs.push({ value: maxValue, index: maxIndex });
    lows.push({ value: minValue, index: minIndex });
    
    // Essayer de trouver des pivots locaux (pour les séries plus longues)
    if (data.length >= 5) {
      for (let i = 1; i < data.length - 1; i++) {
        // Un sommet local simple
        if (data[i] > data[i-1] && data[i] > data[i+1] && i !== maxIndex) {
          highs.push({ value: data[i], index: i });
        }
        // Un creux local simple
        if (data[i] < data[i-1] && data[i] < data[i+1] && i !== minIndex) {
          lows.push({ value: data[i], index: i });
        }
      }
    }
    
    logger.debug(`Simple pivot detection: found ${highs.length} highs and ${lows.length} lows`);
    return { highs, lows };
  };

  // Détection des divergences
  const detectDivergences = (state: RsiDivergenceState): { 
    bullishDivergence: boolean, 
    bearishDivergence: boolean 
  } => {
    if (state.priceHistory.length < config.divergenceWindow * 2 || 
        state.rsiHistory.length < config.divergenceWindow * 2) {
      logger.debug(`Insufficient data for divergence detection: price history=${state.priceHistory.length}, rsi history=${state.rsiHistory.length}, need at least ${config.divergenceWindow * 2} for both`);
      return { bullishDivergence: false, bearishDivergence: false };
    }
    
    // Obtenir les deux derniers creux de prix et de RSI
    const recentPriceLows = state.priceLows.slice(-2);
    const recentRsiLows = state.rsiLows.slice(-2);
    
    // Obtenir les deux derniers sommets de prix et de RSI
    const recentPriceHighs = state.priceHighs.slice(-2);
    const recentRsiHighs = state.rsiHighs.slice(-2);
    
    // Log détaillé des pivots pour le débogage
    logger.debug(`Divergence analysis data:`, {
      priceHighsCount: state.priceHighs.length,
      priceHighs: state.priceHighs.slice(-2),
      priceLowsCount: state.priceLows.length,
      priceLows: state.priceLows.slice(-2),
      rsiHighsCount: state.rsiHighs.length,
      rsiHighs: state.rsiHighs.slice(-2),
      rsiLowsCount: state.rsiLows.length,
      rsiLows: state.rsiLows.slice(-2)
    });
    
    // Vérifier s'il y a suffisamment de pivots pour l'analyse
    if (recentPriceLows.length < 2 || recentRsiLows.length < 2 || 
        recentPriceHighs.length < 2 || recentRsiHighs.length < 2) {
      logger.debug(`Insufficient pivots for divergence detection`);
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
    
    logger.debug(`Divergence detection result: bullish=${bullishDivergence}, bearish=${bearishDivergence}`);
    
    if (bullishDivergence) {
      logger.debug(`BULLISH DIVERGENCE DETAILS:`, {
        priceLow1: recentPriceLows[0].price,
        priceLow2: recentPriceLows[1].price,
        rsiLow1: recentRsiLows[0].rsi,
        rsiLow2: recentRsiLows[1].rsi,
        indexDiff: Math.abs(recentPriceLows[1].index - recentRsiLows[1].index)
      });
    }
    
    if (bearishDivergence) {
      logger.debug(`BEARISH DIVERGENCE DETAILS:`, {
        priceHigh1: recentPriceHighs[0].price,
        priceHigh2: recentPriceHighs[1].price,
        rsiHigh1: recentRsiHighs[0].rsi,
        rsiHigh2: recentRsiHighs[1].rsi,
        indexDiff: Math.abs(recentPriceHighs[1].index - recentRsiHighs[1].index)
      });
    }
    
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
            
            // Déboguer les valeurs d'entrée pour la fonction findPivots
            logger.debug(`Pivot input data`, {
              priceDataLength: state.priceHistory.length,
              rsiDataLength: state.rsiHistory.length,
              window: config.divergenceWindow,
              lastPrices: state.priceHistory.slice(-5),
              lastRSI: state.rsiHistory.slice(-5)
            });
            
            logger.debug(`Pivots found`, { 
              symbol: data.symbol, 
              priceHighs: pricePivots.highs.length, 
              priceLows: pricePivots.lows.length,
              rsiHighs: rsiPivots.highs.length,
              rsiLows: rsiPivots.lows.length,
              source: "RsiDivergenceStrategy"
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
            logger.info(`🔥 Divergence haussière détectée sur ${data.symbol} avec RSI = ${currentRsi} - GENERATING LONG SIGNAL`);
            // Signal d'entrée long
            state.position = "long";
            state.lastEntryPrice = data.price;
            const signal: StrategySignal = {
              type: "entry" as const,
              direction: "long" as const,
              price: data.price,
              reason: "Divergence haussière RSI-Prix",
            };
            logger.debug("📤 Returning LONG signal", { signal, symbol: data.symbol });
            return signal;
          } else if (bearishDivergence && currentRsi > config.overboughtLevel && state.position !== "short") {
            logger.info(`🔥 Divergence baissière détectée sur ${data.symbol} avec RSI = ${currentRsi} - GENERATING SHORT SIGNAL`);
            // Signal d'entrée short
            state.position = "short";
            state.lastEntryPrice = data.price;
            const signal: StrategySignal = {
              type: "entry" as const,
              direction: "short" as const,
              price: data.price,
              reason: "Divergence baissière RSI-Prix",
            };
            logger.debug("📤 Returning SHORT signal", { signal, symbol: data.symbol });
            return signal;
          } else if (state.position === "long" && (bearishDivergence || currentRsi > config.overboughtLevel + 10)) {
            // Signal de sortie de position longue
            state.position = "none";
            const signal: StrategySignal = {
              type: "exit" as const,
              direction: "long" as const,
              price: data.price,
              reason: "Fin de divergence haussière ou surachat extrême",
            };
            logger.debug("📤 Returning LONG EXIT signal", { signal, symbol: data.symbol });
            return signal;
          } else if (state.position === "short" && (bullishDivergence || currentRsi < config.oversoldLevel - 10)) {
            // Signal de sortie de position courte
            state.position = "none";
            const signal: StrategySignal = {
              type: "exit" as const,
              direction: "short" as const,
              price: data.price,
              reason: "Fin de divergence baissière ou survente extrême",
            };
            logger.debug("📤 Returning SHORT EXIT signal", { signal, symbol: data.symbol });
            return signal;
          } else {
            logger.debug("🔍 No signal conditions met", {
              symbol: data.symbol,
              bullishDivergence,
              bearishDivergence,
              currentRsi,
              oversoldLevel: config.oversoldLevel,
              overboughtLevel: config.overboughtLevel,
              position: state.position,
              reasons: {
                bullishBlocked: bullishDivergence && (currentRsi >= config.oversoldLevel || state.position === "long"),
                bearishBlocked: bearishDivergence && (currentRsi <= config.overboughtLevel || state.position === "short")
              }
            });
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

    initializeWithHistory: async (historicalData: MarketData[]): Promise<void> => {
      if (!historicalData || historicalData.length === 0) {
        logger.info(`No historical data provided for RSI Divergence strategy on ${config.symbol}`);
        return;
      }

      logger.info(`Initializing RSI Divergence strategy with ${historicalData.length} historical data points for ${config.symbol}`);

      // Reset state
      state.priceHistory = [];
      state.rsiHistory = [];
      state.priceHighs = [];
      state.priceLows = [];
      state.rsiHighs = [];
      state.rsiLows = [];

      // Process historical data
      for (const data of historicalData) {
        if (data.symbol === config.symbol && data.price && data.price > 0) {
          // Add price to history
          state.priceHistory.push(data.price);

          // Calculate RSI if we have enough data
          if (state.priceHistory.length >= config.rsiPeriod) {
            const rsiInput = {
              values: state.priceHistory,
              period: config.rsiPeriod
            };
            const rsiResult = RSI.calculate(rsiInput);
            
            if (rsiResult.length > 0) {
              const currentRsi = rsiResult[rsiResult.length - 1];
              state.rsiHistory.push(currentRsi);
            }
          }
        }
      }

      logger.info(`Processed historical data: price history=${state.priceHistory.length}, rsi history=${state.rsiHistory.length}`);

      // Calculate pivots for the historical data
      if (state.priceHistory.length > config.divergenceWindow * 2 && state.rsiHistory.length > config.divergenceWindow * 2) {
        const pricePivots = findPivots(state.priceHistory, config.divergenceWindow);
        const rsiPivots = findPivots(state.rsiHistory, config.divergenceWindow);
        
        state.priceHighs = pricePivots.highs.map(h => ({ price: h.value, index: h.index }));
        state.priceLows = pricePivots.lows.map(l => ({ price: l.value, index: l.index }));
        state.rsiHighs = rsiPivots.highs.map(h => ({ rsi: h.value, index: h.index }));
        state.rsiLows = rsiPivots.lows.map(l => ({ rsi: l.value, index: l.index }));
        
        logger.info(`Found pivots in historical data:`, {
          priceHighs: state.priceHighs.length,
          priceLows: state.priceLows.length,
          rsiHighs: state.rsiHighs.length,
          rsiLows: state.rsiLows.length
        });
      } else {
        logger.warn(`Not enough historical data for pivot detection: price history=${state.priceHistory.length}, rsi history=${state.rsiHistory.length}, need at least ${config.divergenceWindow * 2} for both`);
      }

      logger.info(`RSI Divergence strategy initialized for ${config.symbol}`, {
        symbol: config.symbol,
        priceHistoryLength: state.priceHistory.length,
        rsiHistoryLength: state.rsiHistory.length,
        priceHighs: state.priceHighs.length,
        priceLows: state.priceLows.length,
        rsiHighs: state.rsiHighs.length,
        rsiLows: state.rsiLows.length
      });
    },
  };
};
