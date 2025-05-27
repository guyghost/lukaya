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
import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";
import { result } from "../../shared/utils";

interface HarmonicPatternConfig {
  detectionLength: number;
  fibRetracementTolerance: number;
  symbol: string;
  positionSize: number;
  patternConfirmationPercentage: number;
  maxSlippagePercent?: number;
  minLiquidityRatio?: number;
  riskPerTrade?: number;
  stopLossPercent?: number;
  accountSize?: number;
  maxCapitalPerTrade?: number;
  limitOrderBuffer?: number;
  useLimitOrders?: boolean;
}

interface PivotPoint {
  price: number;
  index: number;
  type: "high" | "low";
}

interface HarmonicPattern {
  type: "gartley" | "butterfly" | "bat" | "crab" | "cypher" | "shark";
  direction: "bullish" | "bearish";
  points: { [key: string]: PivotPoint };
  completion: number; // Pourcentage de complétion du pattern
  targetPrice: number;
  potentialReversal: boolean;
  expectedMove: "up" | "down";
}

interface HarmonicPatternState {
  priceHistory: number[];
  pivots: PivotPoint[];
  currentPatterns: HarmonicPattern[];
  lastDetectedPattern: HarmonicPattern | null;
  position: "none" | "long" | "short";
  lastEntryPrice: number | null;
  accountSize: number | null;
  lastSignalIndex: number;
}

export const createHarmonicPatternStrategy = (config: HarmonicPatternConfig): Strategy => {
  const logger = createContextualLogger('HarmonicPatternStrategy');
  
  // État initial
  const state: HarmonicPatternState = {
    priceHistory: [],
    pivots: [],
    currentPatterns: [],
    lastDetectedPattern: null,
    position: "none",
    lastEntryPrice: null,
    accountSize: config.accountSize || null,
    lastSignalIndex: 0
  };

  // ID et nom de la stratégie
  const id = `harmonic-pattern-${config.symbol}`;
  const name = `Harmonic Pattern (${config.detectionLength})`;

  // Paramètres par défaut
  const maxSlippagePercent = config.maxSlippagePercent || 1.0;
  const minLiquidityRatio = config.minLiquidityRatio || 10.0;
  const useLimitOrders = config.useLimitOrders !== undefined ? config.useLimitOrders : false;
  const tolerance = config.fibRetracementTolerance || 0.03; // Tolérance pour les niveaux de Fibonacci (±3%)
  
  // Ratios de Fibonacci pour les patterns harmoniques
  const fibRatios = {
    r0: 0,
    r236: 0.236,
    r382: 0.382,
    r5: 0.5,
    r618: 0.618,
    r786: 0.786,
    r886: 0.886,
    r1: 1.0,
    r1272: 1.272,
    r1414: 1.414,
    r1618: 1.618,
    r2: 2.0,
    r2618: 2.618,
    r3618: 3.618,
    r4236: 4.236,
  };

  // Identifier les pivots dans la série de prix
  const identifyPivots = (prices: number[], windowSize: number): PivotPoint[] => {
    if (prices.length < windowSize * 2 + 1) return [];
    
    const pivots: PivotPoint[] = [];
    
    for (let i = windowSize; i < prices.length - windowSize; i++) {
      let isHigh = true;
      let isLow = true;
      
      for (let j = 1; j <= windowSize; j++) {
        if (prices[i] <= prices[i - j] || prices[i] <= prices[i + j]) {
          isHigh = false;
        }
        if (prices[i] >= prices[i - j] || prices[i] >= prices[i + j]) {
          isLow = false;
        }
        if (!isHigh && !isLow) break;
      }
      
      if (isHigh) {
        pivots.push({ price: prices[i], index: i, type: "high" });
      } else if (isLow) {
        pivots.push({ price: prices[i], index: i, type: "low" });
      }
    }
    
    return pivots;
  };

  // Calculer le ratio entre deux segments de prix
  const calculateRatio = (start: number, end: number, point: number): number => {
    if (end === start) return 0;
    return Math.abs((point - end) / (end - start));
  };

  // Vérifier si un ratio est proche d'un niveau de Fibonacci
  const isNearFibLevel = (ratio: number, targetRatio: number, tolerance: number): boolean => {
    return Math.abs(ratio - targetRatio) <= tolerance;
  };

  // Détecter les patterns harmoniques
  const detectHarmonicPatterns = (pivots: PivotPoint[]): HarmonicPattern[] => {
    if (pivots.length < 5) return [];
    
    const patterns: HarmonicPattern[] = [];
    
    // Prendre les derniers pivots pour l'analyse
    const recentPivots = pivots.slice(-9);
    
    // Parcourir les combinaisons possibles de 5 points (X, A, B, C, D)
    for (let i = 0; i < recentPivots.length - 4; i++) {
      const X = recentPivots[i];
      
      for (let j = i + 1; j < recentPivots.length - 3; j++) {
        if (X.type === recentPivots[j].type) continue; // A doit être de type opposé à X
        const A = recentPivots[j];
        
        for (let k = j + 1; k < recentPivots.length - 2; k++) {
          if (A.type === recentPivots[k].type) continue; // B doit être de type opposé à A
          const B = recentPivots[k];
          
          for (let l = k + 1; l < recentPivots.length - 1; l++) {
            if (B.type === recentPivots[l].type) continue; // C doit être de type opposé à B
            const C = recentPivots[l];
            
            for (let m = l + 1; m < recentPivots.length; m++) {
              if (C.type === recentPivots[m].type) continue; // D doit être de type opposé à C
              const D = recentPivots[m];
              
              // Calculer les ratios pour les patterns
              const AB_XA = calculateRatio(X.price, A.price, B.price);
              const BC_AB = calculateRatio(A.price, B.price, C.price);
              const CD_BC = calculateRatio(B.price, C.price, D.price);
              const XD_AD = calculateRatio(A.price, D.price, X.price);
              
              // Déterminer si c'est un pattern bullish ou bearish
              // Bullish: X bas, A haut, B milieu, C bas, D haut
              // Bearish: X haut, A bas, B milieu, C haut, D bas
              const isBullish = X.type === "low" && D.price > C.price;
              const isBearish = X.type === "high" && D.price < C.price;
              
              // Vérifier les patterns harmoniques connus
              
              // Pattern Gartley
              if ((isNearFibLevel(AB_XA, fibRatios.r618, tolerance) || isNearFibLevel(AB_XA, fibRatios.r786, tolerance)) &&
                  (isNearFibLevel(BC_AB, fibRatios.r382, tolerance) || isNearFibLevel(BC_AB, fibRatios.r886, tolerance)) &&
                  isNearFibLevel(CD_BC, fibRatios.r1272, tolerance) &&
                  isNearFibLevel(XD_AD, fibRatios.r786, tolerance)) {
                
                patterns.push({
                  type: "gartley",
                  direction: isBullish ? "bullish" : "bearish",
                  points: { X, A, B, C, D },
                  completion: 100, // Pattern complet
                  targetPrice: D.price,
                  potentialReversal: true,
                  expectedMove: isBullish ? "up" : "down"
                });
              }
              
              // Pattern Butterfly
              else if ((isNearFibLevel(AB_XA, fibRatios.r786, tolerance) || isNearFibLevel(AB_XA, fibRatios.r886, tolerance)) &&
                      isNearFibLevel(BC_AB, fibRatios.r382, tolerance) &&
                      isNearFibLevel(CD_BC, fibRatios.r1618, tolerance) &&
                      isNearFibLevel(XD_AD, fibRatios.r1272, tolerance)) {
                
                patterns.push({
                  type: "butterfly",
                  direction: isBullish ? "bullish" : "bearish",
                  points: { X, A, B, C, D },
                  completion: 100,
                  targetPrice: D.price,
                  potentialReversal: true,
                  expectedMove: isBullish ? "up" : "down"
                });
              }
              
              // Pattern Bat
              else if (isNearFibLevel(AB_XA, fibRatios.r382, tolerance) &&
                      isNearFibLevel(BC_AB, fibRatios.r886, tolerance) &&
                      isNearFibLevel(CD_BC, fibRatios.r2618, tolerance) &&
                      isNearFibLevel(XD_AD, fibRatios.r886, tolerance)) {
                
                patterns.push({
                  type: "bat",
                  direction: isBullish ? "bullish" : "bearish",
                  points: { X, A, B, C, D },
                  completion: 100,
                  targetPrice: D.price,
                  potentialReversal: true,
                  expectedMove: isBullish ? "up" : "down"
                });
              }
              
              // Pattern Crab
              else if (isNearFibLevel(AB_XA, fibRatios.r382, tolerance) &&
                      isNearFibLevel(BC_AB, fibRatios.r618, tolerance) &&
                      isNearFibLevel(CD_BC, fibRatios.r3618, tolerance) &&
                      isNearFibLevel(XD_AD, fibRatios.r1618, tolerance)) {
                
                patterns.push({
                  type: "crab",
                  direction: isBullish ? "bullish" : "bearish",
                  points: { X, A, B, C, D },
                  completion: 100,
                  targetPrice: D.price,
                  potentialReversal: true,
                  expectedMove: isBullish ? "up" : "down"
                });
              }
            }
          }
        }
      }
    }
    
    return patterns;
  };

  return {
    getId: () => id,
    getName: () => name,
    getConfig: () => ({
      id,
      name,
      description: "Stratégie basée sur la détection des patterns harmoniques de Fibonacci pour anticiper les retournements de marché",
      parameters: config as unknown as Record<string, unknown>,
    }),

    processMarketData: async (data: MarketData): Promise<StrategySignal | null> => {
      if (data.symbol !== config.symbol) return null;
      
      // Ajouter le prix actuel à l'historique
      state.priceHistory.push(data.price);
      
      // Nous avons besoin de suffisamment de données pour l'analyse
      if (state.priceHistory.length > config.detectionLength * 2) {
        // Identifier les pivots
        state.pivots = identifyPivots(state.priceHistory, Math.floor(config.detectionLength / 5));
        
        // Détecter les patterns harmoniques
        state.currentPatterns = detectHarmonicPatterns(state.pivots);
        
        // S'il y a au moins un pattern détecté et que nous n'avons pas généré de signal récemment
        if (state.currentPatterns.length > 0 && 
            state.lastSignalIndex < state.priceHistory.length - config.detectionLength / 2) {
          
          // Prendre le pattern le plus récent et complet
          const pattern = state.currentPatterns.filter(p => p.completion >= config.patternConfirmationPercentage)
            .sort((a, b) => {
              const maxIndexA = Math.max(...Object.values(a.points).map(p => p.index));
              const maxIndexB = Math.max(...Object.values(b.points).map(p => p.index));
              return maxIndexB - maxIndexA;
            })[0];
          
          if (pattern) {
            state.lastDetectedPattern = pattern;
            
            // Signal d'entrée LONG: pattern bullish
            if (pattern.direction === "bullish" && state.position !== "long") {
              logger.info(`Pattern harmonique ${pattern.type} haussier détecté sur ${data.symbol}`);
              state.position = "long";
              state.lastEntryPrice = data.price;
              state.lastSignalIndex = state.priceHistory.length - 1;
              
              return {
                type: "entry",
                direction: "long",
                price: data.price,
                reason: `Pattern harmonique ${pattern.type.toUpperCase()} haussier détecté (hausse attendue)`,
              };
            }
            
            // Signal d'entrée SHORT: pattern bearish
            else if (pattern.direction === "bearish" && state.position !== "short") {
              logger.info(`Pattern harmonique ${pattern.type} baissier détecté sur ${data.symbol}`);
              state.position = "short";
              state.lastEntryPrice = data.price;
              state.lastSignalIndex = state.priceHistory.length - 1;
              
              return {
                type: "entry",
                direction: "short",
                price: data.price,
                reason: `Pattern harmonique ${pattern.type.toUpperCase()} baissier détecté (baisse attendue)`,
              };
            }
            
            // Signaux de sortie basés sur les objectifs de prix
            else if (state.position === "long" && pattern.direction !== "bullish") {
              logger.info(`Sortie de position longue sur ${data.symbol} - changement de pattern`);
              state.position = "none";
              state.lastSignalIndex = state.priceHistory.length - 1;
              
              return {
                type: "exit",
                direction: "long",
                price: data.price,
                reason: "Changement de pattern harmonique",
              };
            }
            
            else if (state.position === "short" && pattern.direction !== "bearish") {
              logger.info(`Sortie de position courte sur ${data.symbol} - changement de pattern`);
              state.position = "none";
              state.lastSignalIndex = state.priceHistory.length - 1;
              
              return {
                type: "exit",
                direction: "short",
                price: data.price,
                reason: "Changement de pattern harmonique",
              };
            }
          }
        }
      }
      
      // Limiter la taille de l'historique
      const maxHistorySize = config.detectionLength * 5;
      if (state.priceHistory.length > maxHistorySize) {
        state.priceHistory = state.priceHistory.slice(-maxHistorySize);
      }
      
      return null;
    },

    generateOrder: (signal: StrategySignal, marketData: MarketData): OrderParams | null => {
      if (marketData.symbol !== config.symbol) return null;

      // DEBUG: Log the incoming signal to trace order side calculation
      logger.info(`🔍 [DEBUG HARMONIC] Génération d'un ordre pour le signal :`, {
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
      logger.info(`🔍 [DEBUG HARMONIC] Calcul du côté de l'ordre :`, {
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
      
      // Calculer la taille de l'ordre
      let adjustedSize = config.positionSize;
      
      // Ajuster en fonction de la liquidité
      const availableLiquidity = marketData.volume * liquidityPrice;
      const orderValue = adjustedSize * liquidityPrice;
      
      if (availableLiquidity < orderValue * minLiquidityRatio) {
        const liquidityReductionFactor = (availableLiquidity / (orderValue * minLiquidityRatio));
        adjustedSize = adjustedSize * liquidityReductionFactor;
      }

      // Si la taille est trop petite, annuler
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
        logger.info(`Aucune donnée historique fournie pour la stratégie Harmonic Pattern sur ${config.symbol}`);
        return;
      }

      logger.info(`Initialisation de la stratégie Harmonic Pattern avec ${historicalData.length} points de données historiques pour ${config.symbol}`);

      // Reset state
      state.priceHistory = [];
      state.pivots = [];
      state.currentPatterns = [];
      state.lastSignalIndex = -1;

      // Process historical data
      for (const data of historicalData) {
        if (data.symbol === config.symbol && data.price && data.price > 0) {
          state.priceHistory.push(data.price);
        }
      }

      // Detect pivots and patterns for historical data
      if (state.priceHistory.length > config.detectionLength) {
        state.pivots = identifyPivots(state.priceHistory, Math.floor(config.detectionLength / 10));
        
        // Detect harmonic patterns
        state.currentPatterns = detectHarmonicPatterns(state.pivots);
      }

      logger.info(`Stratégie Harmonic Pattern initialisée pour ${config.symbol}`, {
        symbol: config.symbol,
        priceHistoryLength: state.priceHistory.length,
        pivotsDetected: state.pivots.length,
        patternsDetected: state.currentPatterns.length
      });
    },
  };
};
