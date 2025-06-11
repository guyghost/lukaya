import {
  MarketData,
  OrderParams,
  OrderSide,
  OrderType,
  Strategy,
  StrategySignal,
} from "../../shared";
import { EMA, RSI } from 'technicalindicators';
import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";

interface ScalpingEntryExitConfig {
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  rsiPeriod: number;
  momentumPeriod: number;
  symbol: string;
  positionSize: number;
  maxHoldingPeriod: number; // En nombre de candles
  profitTargetPercent: number;
  stopLossPercent: number;
  rsiOverboughtLevel: number;
  rsiOversoldLevel: number;
  momentumThreshold: number;
  priceDeviationThreshold: number;
  maxSlippagePercent?: number;
  minLiquidityRatio?: number;
  riskPerTrade?: number;
  accountSize?: number;
  maxCapitalPerTrade?: number;
  limitOrderBuffer?: number;
  useLimitOrders?: boolean;
}

interface ScalpingEntryExitState {
  priceHistory: number[];
  fastEmaHistory: number[];
  slowEmaHistory: number[];
  rsiHistory: number[];
  momentumHistory: number[];
  position: "none" | "long" | "short";
  lastEntryPrice: number | null;
  entryCandle: number | null;
  accountSize: number | null;
  lastSignalCandle: number;
  priceDeviations: number[];
  trendStrength: number;
}

export const createScalpingEntryExitStrategy = (config: ScalpingEntryExitConfig): Strategy => {
  const logger = createContextualLogger('ScalpingEntryExitStrategy');
  
  // État initial
  const state: ScalpingEntryExitState = {
    priceHistory: [],
    fastEmaHistory: [],
    slowEmaHistory: [],
    rsiHistory: [],
    momentumHistory: [],
    position: "none",
    lastEntryPrice: null,
    entryCandle: null,
    accountSize: config.accountSize || null,
    lastSignalCandle: 0,
    priceDeviations: [],
    trendStrength: 0,
  };

  // ID et nom de la stratégie
  const id = `scalping-entry-exit-${config.symbol}`;
  const name = `Scalping EMA 20/50 + RSI 7 (${config.symbol})`;

  // Paramètres par défaut optimisés pour scalping ultra-rapide
  const maxSlippagePercent = config.maxSlippagePercent || 0.2; // Slippage très strict pour scalping
  const minLiquidityRatio = config.minLiquidityRatio || 8.0; // Liquidité élevée requise
  const useLimitOrders = config.useLimitOrders !== undefined ? config.useLimitOrders : true; // Ordres limite par défaut

  // Calculer le momentum des prix
  const calculateMomentum = (prices: number[], period: number): number => {
    if (prices.length < period + 1) return 0;
    
    const currentPrice = prices[prices.length - 1];
    const previousPrice = prices[prices.length - 1 - period];
    
    return ((currentPrice - previousPrice) / previousPrice) * 100;
  };

  // Calculer la force de la tendance
  const calculateTrendStrength = (fastEma: number[], slowEma: number[]): number => {
    if (fastEma.length === 0 || slowEma.length === 0) return 0;
    
    const fastEmaValue = fastEma[fastEma.length - 1];
    const slowEmaValue = slowEma[slowEma.length - 1];
    
    // Calcul de la différence relative entre les EMAs
    const emaDifference = ((fastEmaValue - slowEmaValue) / slowEmaValue) * 100;
    
    return Math.abs(emaDifference);
  };

  // Détecter les signaux de scalping selon la stratégie EMA 20/50 + RSI 7
  const detectScalpingSignal = (data: MarketData): StrategySignal | null => {
    const currentCandle = state.priceHistory.length;
    
    // Vérifier qu'on a assez de données
    if (state.fastEmaHistory.length === 0 || state.slowEmaHistory.length === 0 || 
        state.rsiHistory.length === 0) {
      return null;
    }

    const currentPrice = data.price;
    const fastEma = state.fastEmaHistory[state.fastEmaHistory.length - 1]; // EMA 20
    const slowEma = state.slowEmaHistory[state.slowEmaHistory.length - 1]; // EMA 50
    const previousFastEma = state.fastEmaHistory.length > 1 ? state.fastEmaHistory[state.fastEmaHistory.length - 2] : fastEma;
    const previousSlowEma = state.slowEmaHistory.length > 1 ? state.slowEmaHistory[state.slowEmaHistory.length - 2] : slowEma;
    const currentRsi = state.rsiHistory[state.rsiHistory.length - 1];
    const previousRsi = state.rsiHistory.length > 1 ? state.rsiHistory[state.rsiHistory.length - 2] : currentRsi;

    // Calculer la force de la tendance
    state.trendStrength = calculateTrendStrength(state.fastEmaHistory, state.slowEmaHistory);

    // Cooldown pour éviter trop de signaux consécutifs
    const signalCooldown = 2; // candles (réduit pour scalping)
    const canGenerateSignal = currentCandle - state.lastSignalCandle > signalCooldown;

    if (!canGenerateSignal) {
      return null;
    }

    // Signaux d'entrée selon la stratégie décrite
    if (state.position === "none") {
      // SIGNAL LONG: 
      // 1. Prix au-dessus des deux EMAs (20 et 50)
      // 2. RSI (7) a été sous 30 (survente) et commence à remonter
      // 3. Attendre une bougie verte qui clôture au-dessus des EMAs
      if (currentPrice > fastEma && 
          currentPrice > slowEma && 
          fastEma > slowEma && // Tendance haussière confirmée
          previousRsi <= config.rsiOversoldLevel && 
          currentRsi > previousRsi && // RSI remonte après survente
          currentRsi < config.rsiOverboughtLevel) {
        
        logger.info(`Signal d'entrée LONG détecté sur ${data.symbol} - EMA 20/50 + RSI survente/remontée`);
        state.position = "long";
        state.lastEntryPrice = currentPrice;
        state.entryCandle = currentCandle;
        state.lastSignalCandle = currentCandle;
        
        return {
          type: "entry",
          direction: "long",
          price: currentPrice,
          reason: `Scalping LONG: Prix>${fastEma.toFixed(2)}>${slowEma.toFixed(2)}, RSI ${previousRsi.toFixed(1)}->${currentRsi.toFixed(1)}`,
        };
      }
      
      // SIGNAL SHORT:
      // 1. Prix en-dessous des deux EMAs (20 et 50) 
      // 2. RSI (7) a été au-dessus de 70 (surachat) et commence à baisser
      // 3. Attendre une bougie rouge qui clôture en-dessous des EMAs
      else if (currentPrice < fastEma && 
               currentPrice < slowEma && 
               fastEma < slowEma && // Tendance baissière confirmée
               previousRsi >= config.rsiOverboughtLevel && 
               currentRsi < previousRsi && // RSI baisse après surachat
               currentRsi > config.rsiOversoldLevel) {
        
        logger.info(`Signal d'entrée SHORT détecté sur ${data.symbol} - EMA 20/50 + RSI surachat/baisse`);
        state.position = "short";
        state.lastEntryPrice = currentPrice;
        state.entryCandle = currentCandle;
        state.lastSignalCandle = currentCandle;
        
        return {
          type: "entry",
          direction: "short",
          price: currentPrice,
          reason: `Scalping SHORT: Prix<${fastEma.toFixed(2)}<${slowEma.toFixed(2)}, RSI ${previousRsi.toFixed(1)}->${currentRsi.toFixed(1)}`,
        };
      }
    }
    
    // Signaux de sortie optimisés pour scalping rapide
    else if (state.position === "long" && state.lastEntryPrice && state.entryCandle) {
      const profitPercent = ((currentPrice - state.lastEntryPrice) / state.lastEntryPrice) * 100;
      const holdingPeriod = currentCandle - state.entryCandle;
      
      // Sortie LONG: profit target atteint OU stop loss OU RSI surachat OU holding period dépassé OU prix sous EMA 20
      if (profitPercent >= config.profitTargetPercent ||
          profitPercent <= -config.stopLossPercent ||
          currentRsi >= config.rsiOverboughtLevel ||
          holdingPeriod >= config.maxHoldingPeriod ||
          currentPrice < fastEma) { // Prix retombe sous EMA 20
        
        const reason = profitPercent >= config.profitTargetPercent ? "Profit target atteint" :
                      profitPercent <= -config.stopLossPercent ? "Stop loss déclenché" :
                      currentRsi >= config.rsiOverboughtLevel ? "RSI surachat" :
                      holdingPeriod >= config.maxHoldingPeriod ? "Période de détention max atteinte" :
                      "Prix sous EMA 20";
        
        logger.info(`Signal de sortie LONG détecté sur ${data.symbol} - ${reason}`);
        state.position = "none";
        state.lastEntryPrice = null;
        state.entryCandle = null;
        state.lastSignalCandle = currentCandle;
        
        return {
          type: "exit",
          direction: "long",
          price: currentPrice,
          reason: `Scalping sortie LONG: ${reason} (P&L: ${profitPercent.toFixed(2)}%)`,
        };
      }
    }
    
    else if (state.position === "short" && state.lastEntryPrice && state.entryCandle) {
      const profitPercent = ((state.lastEntryPrice - currentPrice) / state.lastEntryPrice) * 100;
      const holdingPeriod = currentCandle - state.entryCandle;
      
      // Sortie SHORT: profit target atteint OU stop loss OU RSI survente OU holding period dépassé OU prix au-dessus EMA 20
      if (profitPercent >= config.profitTargetPercent ||
          profitPercent <= -config.stopLossPercent ||
          currentRsi <= config.rsiOversoldLevel ||
          holdingPeriod >= config.maxHoldingPeriod ||
          currentPrice > fastEma) { // Prix remonte au-dessus EMA 20
        
        const reason = profitPercent >= config.profitTargetPercent ? "Profit target atteint" :
                      profitPercent <= -config.stopLossPercent ? "Stop loss déclenché" :
                      currentRsi <= config.rsiOversoldLevel ? "RSI survente" :
                      holdingPeriod >= config.maxHoldingPeriod ? "Période de détention max atteinte" :
                      "Prix au-dessus EMA 20";
        
        logger.info(`Signal de sortie SHORT détecté sur ${data.symbol} - ${reason}`);
        state.position = "none";
        state.lastEntryPrice = null;
        state.entryCandle = null;
        state.lastSignalCandle = currentCandle;
        
        return {
          type: "exit",
          direction: "short",
          price: currentPrice,
          reason: `Scalping sortie SHORT: ${reason} (P&L: ${profitPercent.toFixed(2)}%)`,
        };
      }
    }

    return null;
  };

  return {
    getId: () => id,
    getName: () => name,
    getConfig: () => ({
      id,
      name,
      description: "Stratégie de scalping EMA 20/50 + RSI 7 - entrées sur retournements RSI après survente/surachat avec confirmation EMAs - optimisée pour ETH-USD sur timeframes 5min",
      parameters: config as unknown as Record<string, unknown>,
    }),

    processMarketData: async (data: MarketData): Promise<StrategySignal | null> => {
      try {
        if (data.symbol !== config.symbol) return null;
        
        // Validation des données
        if (!data.price || data.price <= 0) {
          logger.warn("Prix de marché invalide reçu", { symbol: data.symbol, price: data.price });
          return null;
        }
        
        // Ajouter le prix actuel à l'historique
        state.priceHistory.push(data.price);
        
        // Garder un historique de taille raisonnable
        const maxHistorySize = Math.max(config.slowEmaPeriod, config.rsiPeriod, config.momentumPeriod) * 3;
        if (state.priceHistory.length > maxHistorySize) {
          state.priceHistory = state.priceHistory.slice(-maxHistorySize);
        }
        
        // Calculer les indicateurs si on a assez de données
        if (state.priceHistory.length >= config.slowEmaPeriod) {
          // Calculer les EMAs
          if (state.priceHistory.length >= config.fastEmaPeriod) {
            const fastEmaInput = {
              values: state.priceHistory,
              period: config.fastEmaPeriod
            };
            const fastEmaResult = EMA.calculate(fastEmaInput);
            
            if (fastEmaResult.length > 0) {
              state.fastEmaHistory = fastEmaResult;
            }
          }
          
          const slowEmaInput = {
            values: state.priceHistory,
            period: config.slowEmaPeriod
          };
          const slowEmaResult = EMA.calculate(slowEmaInput);
          
          if (slowEmaResult.length > 0) {
            state.slowEmaHistory = slowEmaResult;
          }
          
          // Calculer le RSI
          if (state.priceHistory.length >= config.rsiPeriod) {
            const rsiInput = {
              values: state.priceHistory,
              period: config.rsiPeriod
            };
            const rsiResult = RSI.calculate(rsiInput);
            
            if (rsiResult.length > 0) {
              state.rsiHistory = rsiResult;
            }
          }
          
          // Calculer le momentum
          if (state.priceHistory.length >= config.momentumPeriod + 1) {
            const momentum = calculateMomentum(state.priceHistory, config.momentumPeriod);
            state.momentumHistory.push(momentum);
            
            // Garder un historique de momentum de taille raisonnable
            if (state.momentumHistory.length > maxHistorySize) {
              state.momentumHistory = state.momentumHistory.slice(-maxHistorySize);
            }
          }
          
          // Générer les signaux
          return detectScalpingSignal(data);
        }
        
        logger.debug("Données insuffisantes pour le calcul des indicateurs de scalping", {
          currentLength: state.priceHistory.length,
          requiredLength: config.slowEmaPeriod,
          symbol: data.symbol
        });
        
        return null;
        
      } catch (error) {
        logger.error("Erreur lors du traitement des données de marché dans la stratégie de scalping", error as Error, {
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
      logger.info(`🔍 [DEBUG SCALPING] Génération d'ordre pour le signal :`, {
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
      logger.info(`🔍 [DEBUG SCALPING] Calcul du côté de l'ordre :`, {
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
      
      // Vérifier la liquidité
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

      // Calculer le prix limite pour les ordres limites (agressif pour scalping)
      const slippageBuffer = config.limitOrderBuffer || 0.0002; // Buffer minimal pour exécution rapide
      const limitPrice =
        orderSide === OrderSide.BUY
          ? Math.round(marketData.ask * (1 + slippageBuffer) * 100) / 100
          : Math.round(marketData.bid * (1 - slippageBuffer) * 100) / 100;

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
        logger.info(`Aucune donnée historique fournie pour la stratégie Scalping Entry/Exit sur ${config.symbol}`);
        return;
      }

      logger.info(`Initialisation de la stratégie Scalping Entry/Exit avec ${historicalData.length} points de données historiques pour ${config.symbol}`);

      // Reset state
      state.priceHistory = [];
      state.fastEmaHistory = [];
      state.slowEmaHistory = [];
      state.rsiHistory = [];
      state.momentumHistory = [];

      // Process historical data
      for (const data of historicalData) {
        if (data.symbol === config.symbol && data.price && data.price > 0) {
          state.priceHistory.push(data.price);
          
          // Calculer les indicateurs si on a assez de données
          if (state.priceHistory.length >= config.slowEmaPeriod) {
            // Calculer les EMAs
            if (state.priceHistory.length >= config.fastEmaPeriod) {
              const fastEmaInput = {
                values: state.priceHistory,
                period: config.fastEmaPeriod
              };
              const fastEmaResult = EMA.calculate(fastEmaInput);
              if (fastEmaResult.length > 0) {
                state.fastEmaHistory = fastEmaResult;
              }
            }
            
            const slowEmaInput = {
              values: state.priceHistory,
              period: config.slowEmaPeriod
            };
            const slowEmaResult = EMA.calculate(slowEmaInput);
            if (slowEmaResult.length > 0) {
              state.slowEmaHistory = slowEmaResult;
            }
            
            // Calculer le RSI
            if (state.priceHistory.length >= config.rsiPeriod) {
              const rsiInput = {
                values: state.priceHistory,
                period: config.rsiPeriod
              };
              const rsiResult = RSI.calculate(rsiInput);
              if (rsiResult.length > 0) {
                state.rsiHistory = rsiResult;
              }
            }
            
            // Calculer le momentum
            if (state.priceHistory.length >= config.momentumPeriod + 1) {
              const momentum = calculateMomentum(state.priceHistory, config.momentumPeriod);
              state.momentumHistory.push(momentum);
            }
          }
        }
      }

      logger.info(`Stratégie Scalping Entry/Exit initialisée pour ${config.symbol}`, {
        symbol: config.symbol,
        priceHistoryLength: state.priceHistory.length,
        fastEmaLength: state.fastEmaHistory.length,
        slowEmaLength: state.slowEmaHistory.length,
        rsiLength: state.rsiHistory.length,
        momentumLength: state.momentumHistory.length
      });
    },
  };
};
