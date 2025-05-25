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
import { SMA } from 'technicalindicators';

interface VolumeAnalysisConfig {
  volumeThreshold: number;
  volumeMALength: number;
  priceMALength: number;
  symbol: string;
  positionSize: number;
  volumeSpikeFactor: number;
  priceSensitivity: number;
  maxSlippagePercent?: number;
  minLiquidityRatio?: number;
  riskPerTrade?: number;
  stopLossPercent?: number;
  accountSize?: number;
  maxCapitalPerTrade?: number;
  limitOrderBuffer?: number;
  useLimitOrders?: boolean;
}

interface VolumeAnalysisState {
  priceHistory: number[];
  volumeHistory: number[];
  volumeMA: number[];
  priceMA: number[];
  previousPrice: number | null;
  previousVolume: number | null;
  position: "none" | "long" | "short";
  lastEntryPrice: number | null;
  accountSize: number | null;
  volumeDelta: number[];
  cumulativeDelta: number;
  lastVolumeSignal: number;
}

export const createVolumeAnalysisStrategy = (config: VolumeAnalysisConfig): Strategy => {
  const logger = createContextualLogger('VolumeAnalysisStrategy');
  
  // État initial
  const state: VolumeAnalysisState = {
    priceHistory: [],
    volumeHistory: [],
    volumeMA: [],
    priceMA: [],
    previousPrice: null,
    previousVolume: null,
    position: "none",
    lastEntryPrice: null,
    accountSize: config.accountSize || null,
    volumeDelta: [],
    cumulativeDelta: 0,
    lastVolumeSignal: 0,
  };

  // ID et nom de la stratégie
  const id = `volume-analysis-${config.symbol}-${config.volumeMALength}`;
  const name = `Volume Analysis (${config.volumeMALength})`;

  // Paramètres par défaut
  const maxSlippagePercent = config.maxSlippagePercent || 1.0;
  const minLiquidityRatio = config.minLiquidityRatio || 10.0;
  const useLimitOrders = config.useLimitOrders !== undefined ? config.useLimitOrders : true;

  // Calcul du delta de volume (différence entre volume acheteur et vendeur)
  const calculateVolumeDelta = (price: number, prevPrice: number, volume: number): number => {
    if (prevPrice === null) return 0;
    // Estimer le delta de volume basé sur l'évolution du prix
    return price > prevPrice ? volume : -volume;
  };

  // Détection des anomalies de volume
  const detectVolumeAnomalies = (state: VolumeAnalysisState): {
    volumeSpike: boolean,
    buyingPressure: boolean,
    sellingPressure: boolean,
    deltaChange: number,
    volumeRatio: number
  } => {
    if (state.volumeMA.length === 0 || state.priceMA.length === 0) {
      return { 
        volumeSpike: false, 
        buyingPressure: false, 
        sellingPressure: false,
        deltaChange: 0,
        volumeRatio: 1
      };
    }

    // Calculer le ratio du volume actuel par rapport à la moyenne
    const latestVolume = state.volumeHistory[state.volumeHistory.length - 1];
    const volumeMA = state.volumeMA[state.volumeMA.length - 1];
    const volumeRatio = latestVolume / volumeMA;
    
    // Spike de volume = volume actuel > X fois la moyenne
    const volumeSpike = volumeRatio > config.volumeSpikeFactor;
    
    // Calculer la pression d'achat/vente basée sur les 5 derniers deltas de volume
    const recentDeltas = state.volumeDelta.slice(-5);
    const deltasSum = recentDeltas.reduce((sum, delta) => sum + delta, 0);
    const deltaChange = state.volumeDelta.length > 0 ? 
      state.volumeDelta[state.volumeDelta.length - 1] - 
      (state.volumeDelta.length > 1 ? state.volumeDelta[state.volumeDelta.length - 2] : 0) : 0;
    
    // Forte pression d'achat
    const buyingPressure = deltasSum > 0 && deltaChange > 0 && volumeSpike;
    
    // Forte pression de vente
    const sellingPressure = deltasSum < 0 && deltaChange < 0 && volumeSpike;
    
    return { 
      volumeSpike, 
      buyingPressure, 
      sellingPressure,
      deltaChange,
      volumeRatio
    };
  };

  return {
    getId: () => id,
    getName: () => name,
    getConfig: () => ({
      id,
      name,
      description: "Stratégie basée sur l'analyse du volume et de son delta pour détecter les changements d'intérêt",
      parameters: config as unknown as Record<string, unknown>,
    }),

    processMarketData: async (data: MarketData): Promise<StrategySignal | null> => {
      try {
        logger.debug(`Processing market data for Volume Analysis: ${JSON.stringify(data)}`, { symbol: data.symbol });
        if (data.symbol !== config.symbol) return null;
        
        // Validation des données
        if (!data.price || data.price <= 0 || !data.volume || data.volume < 0) {
          logger.warn(`Prix ou volume de marché invalide reçu ${JSON.stringify(data)}`, { symbol: data.symbol, price: data.price, volume: data.volume });
          return null;
        }
      
        // Ajouter le prix et le volume actuels à l'historique
        state.priceHistory.push(data.price);
        state.volumeHistory.push(data.volume);
        logger.debug(`Price and volume added to history`, { 
          symbol: data.symbol, 
          price: data.price, 
          volume: data.volume,
          priceHistoryLength: state.priceHistory.length,
          volumeHistoryLength: state.volumeHistory.length
        });
        
        // Calculer le delta de volume
        const volumeDelta = calculateVolumeDelta(
          data.price,
          state.previousPrice || data.price,
          data.volume
        );
        logger.debug(`Volume delta calculated`, { 
          symbol: data.symbol, 
          volumeDelta, 
          currentPrice: data.price, 
          previousPrice: state.previousPrice, 
          volume: data.volume 
        });
        
        // Mettre à jour l'état
        state.volumeDelta.push(volumeDelta);
        state.cumulativeDelta += volumeDelta;
        state.previousPrice = data.price;
        state.previousVolume = data.volume;
        logger.debug(`Volume state updated`, { 
          symbol: data.symbol, 
          cumulativeDelta: state.cumulativeDelta, 
          volumeDeltaHistoryLength: state.volumeDelta.length 
        });
        
        // Calculer les moyennes mobiles si suffisamment de données
        if (state.priceHistory.length >= config.priceMALength) {
          const priceMAInput = {
            values: state.priceHistory.slice(-config.priceMALength),
            period: config.priceMALength
          };
          const priceMAResult = SMA.calculate(priceMAInput);
          if (priceMAResult.length > 0) {
            const newPriceMA = priceMAResult[priceMAResult.length - 1];
            state.priceMA.push(newPriceMA);
            logger.debug(`Price MA calculated`, { 
              symbol: data.symbol, 
              priceMA: newPriceMA, 
              period: config.priceMALength,
              inputValues: priceMAInput.values.slice(-3) // dernières 3 valeurs pour debug
            });
          }
        }
        
        if (state.volumeHistory.length >= config.volumeMALength) {
          const volumeMAInput = {
            values: state.volumeHistory.slice(-config.volumeMALength),
            period: config.volumeMALength
          };
          const volumeMAResult = SMA.calculate(volumeMAInput);
          if (volumeMAResult.length > 0) {
            const newVolumeMA = volumeMAResult[volumeMAResult.length - 1];
            state.volumeMA.push(newVolumeMA);
            logger.debug(`Volume MA calculated`, { 
              symbol: data.symbol, 
              volumeMA: newVolumeMA, 
              period: config.volumeMALength,
              inputValues: volumeMAInput.values.slice(-3) // dernières 3 valeurs pour debug
            });
          }
        }
        
        // Détecter les anomalies de volume
        const volumeAnalysis = detectVolumeAnomalies(state);
        logger.debug(`Volume analysis result`, { 
          symbol: data.symbol, 
          volumeSpike: volumeAnalysis.volumeSpike,
          buyingPressure: volumeAnalysis.buyingPressure,
          sellingPressure: volumeAnalysis.sellingPressure,
          volumeRatio: volumeAnalysis.volumeRatio,
          deltaChange: volumeAnalysis.deltaChange,
          lastVolumeSignal: state.lastVolumeSignal,
          volumeHistoryLength: state.volumeHistory.length
        });
        
        // Vérifier si nous avons assez de données pour générer des signaux
        if (state.priceMA.length > 3 && state.volumeMA.length > 3) {
          // Pour éviter de générer trop de signaux, imposer un délai minimal entre les signaux
          const signalCooldown = 10; // candles
          const canGenerateSignal = state.lastVolumeSignal === 0 || 
            state.volumeHistory.length - state.lastVolumeSignal > signalCooldown;
          
          if (canGenerateSignal) {
            // La tendance de prix est déterminée par la direction de la MA
            const priceTrend = state.priceMA[state.priceMA.length - 1] > state.priceMA[state.priceMA.length - 3] ? "up" : "down";
            logger.debug(`Signal analysis`, { 
              symbol: data.symbol, 
              priceTrend,
              canGenerateSignal,
              position: state.position,
              priceMALength: state.priceMA.length,
              volumeMALength: state.volumeMA.length,
              currentPriceMA: state.priceMA[state.priceMA.length - 1],
              previousPriceMA: state.priceMA[state.priceMA.length - 3]
            });
            
            // Signal d'entrée LONG: pression d'achat + tendance prix haussière ou neutre
            if (volumeAnalysis.buyingPressure && 
                priceTrend === "up" && 
                state.position !== "long") {
              logger.info(`Forte pression d'achat détectée sur ${data.symbol} avec ratio de volume ${volumeAnalysis.volumeRatio.toFixed(2)}`);
              state.position = "long";
              state.lastEntryPrice = data.price;
              state.lastVolumeSignal = state.volumeHistory.length;
              return {
                type: "entry",
                direction: "long",
                price: data.price,
                reason: `Forte pression d'achat (Volume ${Math.round(volumeAnalysis.volumeRatio * 100)}% de la moyenne)`,
              };
            }
            
            // Signal d'entrée SHORT: pression de vente + tendance prix baissière
            else if (volumeAnalysis.sellingPressure && 
                     priceTrend === "down" && 
                     state.position !== "short") {
              logger.info(`Forte pression de vente détectée sur ${data.symbol} avec ratio de volume ${volumeAnalysis.volumeRatio.toFixed(2)}`);
              state.position = "short";
              state.lastEntryPrice = data.price;
              state.lastVolumeSignal = state.volumeHistory.length;
              return {
                type: "entry",
                direction: "short",
                price: data.price,
                reason: `Forte pression de vente (Volume ${Math.round(volumeAnalysis.volumeRatio * 100)}% de la moyenne)`,
              };
            }
            
            // Signaux de sortie
            else if (state.position === "long" && 
                    (priceTrend === "down" || volumeAnalysis.sellingPressure)) {
              logger.info(`Sortie de position longue sur ${data.symbol} due à un changement de pression`);
              state.position = "none";
              state.lastVolumeSignal = state.volumeHistory.length;
              return {
                type: "exit",
                direction: "long",
                price: data.price,
                reason: "Changement de pression du marché",
              };
            }
            
            else if (state.position === "short" && 
                    (priceTrend === "up" || volumeAnalysis.buyingPressure)) {
              logger.info(`Sortie de position courte sur ${data.symbol} due à un changement de pression`);
              state.position = "none";
              state.lastVolumeSignal = state.volumeHistory.length;
              return {
                type: "exit",
                direction: "short",
                price: data.price,
                reason: "Changement de pression du marché",
              };
            }
          }
        }
        
        // Limiter la taille des historiques
        const maxHistorySize = Math.max(config.volumeMALength, config.priceMALength) * 3;
        if (state.priceHistory.length > maxHistorySize) {
          state.priceHistory = state.priceHistory.slice(-maxHistorySize);
        }
        if (state.volumeHistory.length > maxHistorySize) {
          state.volumeHistory = state.volumeHistory.slice(-maxHistorySize);
        }
        if (state.volumeDelta.length > maxHistorySize) {
          state.volumeDelta = state.volumeDelta.slice(-maxHistorySize);
        }
        if (state.volumeMA.length > maxHistorySize) {
          state.volumeMA = state.volumeMA.slice(-maxHistorySize);
        }
        if (state.priceMA.length > maxHistorySize) {
          state.priceMA = state.priceMA.slice(-maxHistorySize);
        }
        
        return null;
      } catch (error) {
        logger.error("Erreur dans le traitement des données de marché", error as Error);
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
  };
};
