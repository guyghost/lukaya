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
  // Enhanced sensitivity parameters
  microMomentumThreshold?: number; // Minimum price slope change to detect micro-momentum
  cumulativeScoreThreshold?: number; // Threshold for cumulative weak signals to trigger entry
  weakSignalDecay?: number; // Rate at which weak signals decay over time
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
  // Enhanced sensitivity state
  priceSlopes: number[]; // Track price slope changes for micro-momentum
  cumulativeScore: number; // Cumulative score for weak signals
  lastSignalTime: number; // Timestamp of last signal for decay calculation
  microSignals: Array<{type: 'bullish' | 'bearish', strength: number, timestamp: number}>; // Recent micro-signals
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
    // Enhanced sensitivity state initialization
    priceSlopes: [],
    cumulativeScore: 0,
    lastSignalTime: 0,
    microSignals: [],
  };

  // Génerer un ID et un nom uniques pour la stratégie
  const id = `rsi-div-${config.rsiPeriod}-${config.symbol}`;
  const name = `RSI Divergence (${config.rsiPeriod})`;

  // Paramètres par défaut
  const maxSlippagePercent = config.maxSlippagePercent || 1.0;
  const minLiquidityRatio = config.minLiquidityRatio || 10.0;
  const useLimitOrders = config.useLimitOrders !== undefined ? config.useLimitOrders : false;
  
  // Enhanced sensitivity parameters with defaults
  const microMomentumThreshold = config.microMomentumThreshold || 0.001; // 0.1% price slope change
  const cumulativeScoreThreshold = config.cumulativeScoreThreshold || 3.0; // Cumulative score to trigger entry
  const weakSignalDecay = config.weakSignalDecay || 0.95; // 5% decay per tick

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
  
  // Enhanced micro-momentum detection based on price slope changes
  const detectMicroMomentum = (prices: number[]): {type: 'bullish' | 'bearish' | 'neutral', strength: number} => {
    if (prices.length < 3) return {type: 'neutral', strength: 0};
    
    // Calculate recent price slopes (rate of change)
    const recentPrices = prices.slice(-3);
    const slope1 = (recentPrices[1] - recentPrices[0]) / recentPrices[0];
    const slope2 = (recentPrices[2] - recentPrices[1]) / recentPrices[1];
    
    // Detect acceleration/deceleration in price movement
    const slopeChange = slope2 - slope1;
    const avgPrice = recentPrices.reduce((sum, p) => sum + p, 0) / recentPrices.length;
    const normalizedSlopeChange = Math.abs(slopeChange) / (avgPrice * microMomentumThreshold);
    
    // Store the slope for analysis
    state.priceSlopes.push(slopeChange);
    if (state.priceSlopes.length > 10) {
      state.priceSlopes = state.priceSlopes.slice(-10);
    }
    
    // Determine momentum type and strength
    if (Math.abs(slopeChange) > microMomentumThreshold) {
      const strength = Math.min(normalizedSlopeChange, 2.0); // Cap strength at 2.0
      if (slopeChange > 0) {
        logger.debug(`Bullish micro-momentum detected`, {
          slope1: (slope1 * 100).toFixed(4),
          slope2: (slope2 * 100).toFixed(4),
          slopeChange: (slopeChange * 100).toFixed(4),
          strength: strength.toFixed(2)
        });
        return {type: 'bullish', strength};
      } else {
        logger.debug(`Bearish micro-momentum detected`, {
          slope1: (slope1 * 100).toFixed(4),
          slope2: (slope2 * 100).toFixed(4),
          slopeChange: (slopeChange * 100).toFixed(4),
          strength: strength.toFixed(2)
        });
        return {type: 'bearish', strength};
      }
    }
    
    return {type: 'neutral', strength: 0};
  };
  
  // Enhanced cumulative scoring system for weak signals
  const updateCumulativeScore = (momentum: {type: 'bullish' | 'bearish' | 'neutral', strength: number}, 
                                 divergence: {bullishDivergence: boolean, bearishDivergence: boolean},
                                 rsi: number, currentTime: number) => {
    // Apply decay to existing score based on time elapsed
    const timeDelta = currentTime - state.lastSignalTime;
    if (timeDelta > 0 && state.lastSignalTime > 0) {
      const decayFactor = Math.pow(weakSignalDecay, timeDelta / 1000); // Decay per second
      state.cumulativeScore *= decayFactor;
    }
    state.lastSignalTime = currentTime;
    
    // Add momentum contribution
    if (momentum.type === 'bullish') {
      state.cumulativeScore += momentum.strength * 0.5; // Weight momentum at 50% of divergence
    } else if (momentum.type === 'bearish') {
      state.cumulativeScore -= momentum.strength * 0.5;
    }
    
    // Add divergence contribution (stronger weight)
    if (divergence.bullishDivergence) {
      state.cumulativeScore += 1.5;
      logger.debug(`Bullish divergence added to cumulative score`, {
        contribution: 1.5,
        newScore: state.cumulativeScore.toFixed(2)
      });
    }
    if (divergence.bearishDivergence) {
      state.cumulativeScore -= 1.5;
      logger.debug(`Bearish divergence added to cumulative score`, {
        contribution: -1.5,
        newScore: state.cumulativeScore.toFixed(2)
      });
    }
    
    // Add RSI extremes contribution (weaker signals in neutral zones)
    const rsiNeutralZone = config.overboughtLevel - config.oversoldLevel;
    const rsiMidpoint = (config.overboughtLevel + config.oversoldLevel) / 2;
    const rsiDeviation = Math.abs(rsi - rsiMidpoint) / (rsiNeutralZone / 2);
    
    if (rsi < config.oversoldLevel) {
      state.cumulativeScore += 0.3 * rsiDeviation; // Bullish RSI contribution
    } else if (rsi > config.overboughtLevel) {
      state.cumulativeScore -= 0.3 * rsiDeviation; // Bearish RSI contribution
    }
    
    // Record micro-signal for analysis
    if (momentum.type !== 'neutral' || divergence.bullishDivergence || divergence.bearishDivergence) {
      const signalType = state.cumulativeScore > 0 ? 'bullish' : 'bearish';
      state.microSignals.push({
        type: signalType,
        strength: Math.abs(state.cumulativeScore),
        timestamp: currentTime
      });
      
      // Keep only recent micro-signals (last 20)
      if (state.microSignals.length > 20) {
        state.microSignals = state.microSignals.slice(-20);
      }
    }
    
    // Log cumulative score for debugging
    logger.debug(`Cumulative score updated`, {
      momentum: momentum.type,
      momentumStrength: momentum.strength.toFixed(2),
      bullishDiv: divergence.bullishDivergence,
      bearishDiv: divergence.bearishDivergence,
      rsi: rsi.toFixed(2),
      rsiContribution: rsi < config.oversoldLevel ? `+${(0.3 * rsiDeviation).toFixed(2)}` : 
                       rsi > config.overboughtLevel ? `-${(0.3 * rsiDeviation).toFixed(2)}` : '0',
      cumulativeScore: state.cumulativeScore.toFixed(2),
      threshold: cumulativeScoreThreshold
    });
    
    return state.cumulativeScore;
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
          
          // Détecter le micro-momentum
          const microMomentum = detectMicroMomentum(state.priceHistory);
          
          // Mettre à jour le score cumulatif
          const cumulativeScore = updateCumulativeScore(
            microMomentum, 
            { bullishDivergence, bearishDivergence }, 
            currentRsi,
            Date.now()
          );
          
          logger.debug(`Enhanced signal analysis`, { 
            symbol: data.symbol, 
            bullishDivergence, 
            bearishDivergence,
            microMomentum: microMomentum.type,
            momentumStrength: microMomentum.strength.toFixed(2),
            cumulativeScore: cumulativeScore.toFixed(2),
            threshold: cumulativeScoreThreshold,
            currentRsi: currentRsi.toFixed(2),
            oversoldLevel: config.oversoldLevel,
            overboughtLevel: config.overboughtLevel,
            position: state.position
          });
          
          // Enhanced signal generation: Traditional divergence signals + cumulative score signals
          
          // Strong traditional signals (keep existing logic)
          if (bullishDivergence && currentRsi < config.oversoldLevel && state.position !== "long") {
            logger.info(`🔥 Strong bullish divergence detected on ${data.symbol} with RSI = ${currentRsi} - GENERATING LONG SIGNAL`);
            state.position = "long";
            state.lastEntryPrice = data.price;
            state.cumulativeScore = 0; // Reset after signal
            const signal: StrategySignal = {
              type: "entry" as const,
              direction: "long" as const,
              price: data.price,
              reason: "Strong bullish RSI-Price divergence",
            };
            logger.debug("📤 Returning STRONG LONG signal", { signal, symbol: data.symbol });
            return signal;
          } else if (bearishDivergence && currentRsi > config.overboughtLevel && state.position !== "short") {
            logger.info(`🔥 Strong bearish divergence detected on ${data.symbol} with RSI = ${currentRsi} - GENERATING SHORT SIGNAL`);
            state.position = "short";
            state.lastEntryPrice = data.price;
            state.cumulativeScore = 0; // Reset after signal
            const signal: StrategySignal = {
              type: "entry" as const,
              direction: "short" as const,
              price: data.price,
              reason: "Strong bearish RSI-Price divergence",
            };
            logger.debug("📤 Returning STRONG SHORT signal", { signal, symbol: data.symbol });
            return signal;
          }
          
          // Enhanced sensitivity: Cumulative weak signals
          else if (cumulativeScore >= cumulativeScoreThreshold && state.position !== "long") {
            logger.info(`🌟 Cumulative bullish signals exceeded threshold on ${data.symbol} (score: ${cumulativeScore.toFixed(2)}) - GENERATING LONG SIGNAL`);
            state.position = "long";
            state.lastEntryPrice = data.price;
            state.cumulativeScore = 0; // Reset after signal
            
            // Determine the dominant signal type for reason
            const reasons = [];
            if (microMomentum.type === 'bullish') reasons.push(`bullish micro-momentum (${microMomentum.strength.toFixed(2)})`);
            if (bullishDivergence) reasons.push('weak bullish divergence');
            if (currentRsi < config.oversoldLevel + 10) reasons.push(`RSI approaching oversold (${currentRsi.toFixed(1)})`);
            
            const signal: StrategySignal = {
              type: "entry" as const,
              direction: "long" as const,
              price: data.price,
              reason: `Cumulative bullish signals: ${reasons.join(', ')}`,
            };
            logger.debug("📤 Returning CUMULATIVE LONG signal", { signal, symbol: data.symbol, score: cumulativeScore.toFixed(2) });
            return signal;
          } else if (cumulativeScore <= -cumulativeScoreThreshold && state.position !== "short") {
            logger.info(`🌟 Cumulative bearish signals exceeded threshold on ${data.symbol} (score: ${cumulativeScore.toFixed(2)}) - GENERATING SHORT SIGNAL`);
            state.position = "short";
            state.lastEntryPrice = data.price;
            state.cumulativeScore = 0; // Reset after signal
            
            // Determine the dominant signal type for reason
            const reasons = [];
            if (microMomentum.type === 'bearish') reasons.push(`bearish micro-momentum (${microMomentum.strength.toFixed(2)})`);
            if (bearishDivergence) reasons.push('weak bearish divergence');
            if (currentRsi > config.overboughtLevel - 10) reasons.push(`RSI approaching overbought (${currentRsi.toFixed(1)})`);
            
            const signal: StrategySignal = {
              type: "entry" as const,
              direction: "short" as const,
              price: data.price,
              reason: `Cumulative bearish signals: ${reasons.join(', ')}`,
            };
            logger.debug("📤 Returning CUMULATIVE SHORT signal", { signal, symbol: data.symbol, score: cumulativeScore.toFixed(2) });
            return signal;
          }
          
          // Exit signals (enhanced with cumulative scoring)
          else if (state.position === "long" && (bearishDivergence || currentRsi > config.overboughtLevel + 10 || cumulativeScore <= -1.0)) {
            state.position = "none";
            state.cumulativeScore = 0; // Reset after exit
            const exitReason = bearishDivergence ? "bearish divergence" : 
                              currentRsi > config.overboughtLevel + 10 ? "extreme overbought RSI" : 
                              "bearish signal accumulation";
            const signal: StrategySignal = {
              type: "exit" as const,
              direction: "long" as const,
              price: data.price,
              reason: `Long position exit: ${exitReason}`,
            };
            logger.debug("📤 Returning LONG EXIT signal", { signal, symbol: data.symbol, reason: exitReason });
            return signal;
          } else if (state.position === "short" && (bullishDivergence || currentRsi < config.oversoldLevel - 10 || cumulativeScore >= 1.0)) {
            state.position = "none";
            state.cumulativeScore = 0; // Reset after exit
            const exitReason = bullishDivergence ? "bullish divergence" : 
                              currentRsi < config.oversoldLevel - 10 ? "extreme oversold RSI" : 
                              "bullish signal accumulation";
            const signal: StrategySignal = {
              type: "exit" as const,
              direction: "short" as const,
              price: data.price,
              reason: `Short position exit: ${exitReason}`,
            };
            logger.debug("📤 Returning SHORT EXIT signal", { signal, symbol: data.symbol, reason: exitReason });
            return signal;
          } else {
            logger.debug("🔍 Enhanced analysis - no signal conditions met", {
              symbol: data.symbol,
              traditionalSignals: {
                bullishDivergence,
                bearishDivergence,
                rsiOversold: currentRsi < config.oversoldLevel,
                rsiOverbought: currentRsi > config.overboughtLevel
              },
              enhancedSignals: {
                microMomentum: microMomentum.type,
                momentumStrength: microMomentum.strength.toFixed(2),
                cumulativeScore: cumulativeScore.toFixed(2),
                scoreThreshold: cumulativeScoreThreshold,
                bullishThresholdReached: cumulativeScore >= cumulativeScoreThreshold,
                bearishThresholdReached: cumulativeScore <= -cumulativeScoreThreshold
              },
              currentRsi: currentRsi.toFixed(2),
              position: state.position,
              blockingReasons: {
                longBlocked: state.position === "long",
                shortBlocked: state.position === "short",
                insufficientBullishSignals: cumulativeScore < cumulativeScoreThreshold,
                insufficientBearishSignals: cumulativeScore > -cumulativeScoreThreshold
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

      // DEBUG: Log the incoming signal to trace order side calculation
      logger.info(`🔍 [DEBUG RSI] Generating order for signal:`, {
        signalType: signal.type,
        signalDirection: signal.direction,
        signalPrice: signal.price,
        signalReason: signal.reason,
        symbol: marketData.symbol
      });

      // Déterminer le côté de l'ordre
      const orderSide =
        (signal.type === "entry" && signal.direction === "long") ||
        (signal.type === "exit" && signal.direction === "short")
          ? OrderSide.BUY
          : OrderSide.SELL;

      // DEBUG: Log the order side calculation
      logger.info(`🔍 [DEBUG RSI] Order side calculation:`, {
        symbol: marketData.symbol,
        signalType: signal.type,
        signalDirection: signal.direction,
        isEntryLong: signal.type === "entry" && signal.direction === "long",
        isExitShort: signal.type === "exit" && signal.direction === "short",
        calculatedOrderSide: orderSide,
        OrderSideBUY: OrderSide.BUY,
        OrderSideSELL: OrderSide.SELL
      });

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
