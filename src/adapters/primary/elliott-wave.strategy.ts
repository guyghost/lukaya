import {
  MarketData,
  OrderParams,
  OrderSide,
  OrderType,
  Strategy,
  StrategyConfig,
  StrategySignal,
  Result,
} from "../../shared";
import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";
import { result } from "../../shared/utils";
import { SMA } from "technicalindicators";

interface ElliottWaveConfig {
  waveDetectionLength: number;
  priceSensitivity: number;
  symbol: string;
  positionSize: number;
  zerolineBufferPercent: number;
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
  confirmed: boolean;
}

interface ElliottWaveState {
  priceHistory: number[];
  pivots: PivotPoint[];
  waves: { start: number; end: number; type: number }[];
  position: "none" | "long" | "short";
  lastEntryPrice: number | null;
  accountSize: number | null;
  currentWaveCount: number;
  lastSignalIndex: number;
}

export const createElliottWaveStrategy = (
  config: ElliottWaveConfig,
): Strategy => {
  const logger = createContextualLogger("ElliottWaveStrategy");

  // État initial
  const state: ElliottWaveState = {
    priceHistory: [],
    pivots: [],
    waves: [],
    position: "none",
    lastEntryPrice: null,
    accountSize: config.accountSize || null,
    currentWaveCount: 0,
    lastSignalIndex: 0,
  };

  // ID et nom de la stratégie
  const id = `elliott-wave-${config.symbol}`;
  const name = `Elliott Wave (${config.waveDetectionLength})`;

  // Paramètres par défaut
  const maxSlippagePercent = config.maxSlippagePercent || 1.0;
  const minLiquidityRatio = config.minLiquidityRatio || 10.0;
  const useLimitOrders =
    config.useLimitOrders !== undefined ? config.useLimitOrders : false;
  const zerolineBuffer = config.zerolineBufferPercent || 0.5; // % au-dessus/dessous du milieu pour définir la zone neutre

  // Identifier les pivots dans la série de prix
  const identifyPivots = (
    prices: number[],
    sensitivity: number,
  ): PivotPoint[] => {
    if (prices.length < sensitivity * 2 + 1) return [];

    const pivots: PivotPoint[] = [];

    for (let i = sensitivity; i < prices.length - sensitivity; i++) {
      let isHigh = true;
      let isLow = true;

      // Vérifier si c'est un sommet
      for (let j = 1; j <= sensitivity; j++) {
        if (prices[i] <= prices[i - j] || prices[i] <= prices[i + j]) {
          isHigh = false;
          break;
        }
      }

      // Vérifier si c'est un creux
      if (!isHigh) {
        for (let j = 1; j <= sensitivity; j++) {
          if (prices[i] >= prices[i - j] || prices[i] >= prices[i + j]) {
            isLow = false;
            break;
          }
        }
      }

      if (isHigh) {
        pivots.push({
          price: prices[i],
          index: i,
          type: "high",
          confirmed: i < prices.length - sensitivity,
        });
      } else if (isLow) {
        pivots.push({
          price: prices[i],
          index: i,
          type: "low",
          confirmed: i < prices.length - sensitivity,
        });
      }
    }

    return pivots;
  };

  // Analyser les pivots pour identifier les vagues d'Elliott
  const analyzeElliottWaves = (
    pivots: PivotPoint[],
    currentPivotCount: number,
  ): {
    currentWave: number;
    actionableWave: boolean;
    impulsive: boolean;
    corrective: boolean;
  } => {
    // Pas assez de pivots pour une analyse complète
    if (pivots.length < 5) {
      return {
        currentWave: 0,
        actionableWave: false,
        impulsive: false,
        corrective: false,
      };
    }

    // Identifier la séquence de pivots (schéma d'alternance haut/bas)
    const confirmedPivots = pivots.filter((p) => p.confirmed).slice(-9); // Prendre les 9 derniers pivots confirmés

    // Déterminer où nous sommes dans le cycle de vagues
    // Généralement dans un cycle complet on a 9 pivots significatifs (5 vagues impulsives + 3 correctrices + début nouvelle impulsion)
    const waveCycle = (currentPivotCount % 8) + 1;

    // Vagues impulsives: 1, 3, 5 sont des mouvements dans la direction principale
    // Vagues correctives: 2, 4, A, B, C sont des mouvements contre la tendance principale
    let impulsive = false;
    let corrective = false;
    let actionableWave = false;

    // Détecter si nous sommes dans une vague impulsive ou corrective
    if (confirmedPivots.length >= 3) {
      const last3Pivots = confirmedPivots.slice(-3);

      // Structure impulsive: low -> high -> low (pour tendance haussière)
      if (
        last3Pivots[0].type === "low" &&
        last3Pivots[1].type === "high" &&
        last3Pivots[2].type === "low" &&
        last3Pivots[2].price > last3Pivots[0].price
      ) {
        impulsive = true;
        actionableWave = waveCycle === 1 || waveCycle === 3 || waveCycle === 5;
      }

      // Structure corrective: high -> low -> high (pour tendance baissière)
      else if (
        last3Pivots[0].type === "high" &&
        last3Pivots[1].type === "low" &&
        last3Pivots[2].type === "high" &&
        last3Pivots[2].price < last3Pivots[0].price
      ) {
        corrective = true;
        actionableWave = waveCycle === 2 || waveCycle === 4 || waveCycle === 7; // 7 correspond à vague C
      }
    }

    return {
      currentWave: waveCycle,
      actionableWave,
      impulsive,
      corrective,
    };
  };

  return {
    getId: () => id,
    getName: () => name,
    getConfig: () => ({
      id,
      name,
      description:
        "Stratégie basée sur la détection des vagues d'Elliott pour anticiper les mouvements de marché",
      parameters: config as unknown as Record<string, unknown>,
    }),

    processMarketData: async (
      data: MarketData,
    ): Promise<StrategySignal | null> => {
      if (data.symbol !== config.symbol) return null;

      // Ajouter le prix actuel à l'historique
      state.priceHistory.push(data.price);

      // Nous avons besoin de suffisamment de données pour l'analyse
      if (state.priceHistory.length > config.waveDetectionLength * 2) {
        // Identifier les pivots
        state.pivots = identifyPivots(
          state.priceHistory,
          config.priceSensitivity,
        );

        // Analyser les vagues d'Elliott
        const waveAnalysis = analyzeElliottWaves(
          state.pivots,
          state.currentWaveCount,
        );

        // Mettre à jour le compteur de vagues si une nouvelle vague est identifiée
        if (
          waveAnalysis.actionableWave &&
          state.pivots.length > 0 &&
          state.lastSignalIndex < state.pivots[state.pivots.length - 1].index
        ) {
          state.currentWaveCount = waveAnalysis.currentWave;

          // Signal d'entrée LONG: début de vague impulsive haussière (1, 3, 5)
          if (
            waveAnalysis.impulsive &&
            (waveAnalysis.currentWave === 1 ||
              waveAnalysis.currentWave === 3 ||
              waveAnalysis.currentWave === 5) &&
            state.position !== "long"
          ) {
            logger.info(
              `Vague d'Elliott impulsive ${waveAnalysis.currentWave} détectée sur ${data.symbol}`,
            );
            state.position = "long";
            state.lastEntryPrice = data.price;
            state.lastSignalIndex = state.priceHistory.length - 1;

            return {
              type: "entry",
              direction: "long",
              price: data.price,
              reason: `Vague d'Elliott impulsive ${waveAnalysis.currentWave} (hausse attendue)`,
            };
          }

          // Signal d'entrée SHORT: début de vague corrective (2, 4) ou corrective complète (A-B-C)
          else if (
            waveAnalysis.corrective &&
            (waveAnalysis.currentWave === 2 ||
              waveAnalysis.currentWave === 4 ||
              waveAnalysis.currentWave === 7) &&
            state.position !== "short"
          ) {
            logger.info(
              `Vague d'Elliott corrective ${waveAnalysis.currentWave === 7 ? "C" : waveAnalysis.currentWave} détectée sur ${data.symbol}`,
            );
            state.position = "short";
            state.lastEntryPrice = data.price;
            state.lastSignalIndex = state.priceHistory.length - 1;

            return {
              type: "entry",
              direction: "short",
              price: data.price,
              reason: `Vague d'Elliott corrective ${waveAnalysis.currentWave === 7 ? "C" : waveAnalysis.currentWave} (baisse attendue)`,
            };
          }

          // Signaux de sortie: fin de vague impulsive ou corrective
          else if (
            state.position === "long" &&
            (waveAnalysis.corrective || waveAnalysis.currentWave === 5)
          ) {
            logger.info(
              `Fin de vague impulsive sur ${data.symbol}, sortie de position longue`,
            );
            state.position = "none";
            state.lastSignalIndex = state.priceHistory.length - 1;

            return {
              type: "exit",
              direction: "long",
              price: data.price,
              reason: "Fin de vague impulsive",
            };
          } else if (
            state.position === "short" &&
            (waveAnalysis.impulsive || waveAnalysis.currentWave === 7)
          ) {
            logger.info(
              `Fin de vague corrective sur ${data.symbol}, sortie de position courte`,
            );
            state.position = "none";
            state.lastSignalIndex = state.priceHistory.length - 1;

            return {
              type: "exit",
              direction: "short",
              price: data.price,
              reason: "Fin de vague corrective",
            };
          }
        }
      }

      // Limiter la taille de l'historique
      const maxHistorySize = config.waveDetectionLength * 5;
      if (state.priceHistory.length > maxHistorySize) {
        state.priceHistory = state.priceHistory.slice(-maxHistorySize);
      }

      return null;
    },

    generateOrder: (
      signal: StrategySignal,
      marketData: MarketData,
    ): OrderParams | null => {
      if (marketData.symbol !== config.symbol) return null;

      // DEBUG: Log the incoming signal to trace order side calculation
      logger.info(`🔍 [DEBUG ELLIOTT] Generating order for signal:`, {
        signalType: signal.type,
        signalDirection: signal.direction,
        signalPrice: signal.price,
        signalReason: signal.reason,
        symbol: marketData.symbol,
      });

      // Déterminer le côté de l'ordre
      const orderSide =
        (signal.type === "entry" && signal.direction === "long") ||
        (signal.type === "exit" && signal.direction === "short")
          ? OrderSide.BUY
          : OrderSide.SELL;

      // DEBUG: Log the order side calculation
      logger.info(`🔍 [DEBUG ELLIOTT] Order side calculation:`, {
        symbol: marketData.symbol,
        signalType: signal.type,
        signalDirection: signal.direction,
        isEntryLong: signal.type === "entry" && signal.direction === "long",
        isExitShort: signal.type === "exit" && signal.direction === "short",
        calculatedOrderSide: orderSide,
        OrderSideBUY: OrderSide.BUY,
        OrderSideSELL: OrderSide.SELL,
      });

      // Vérifier la liquidité disponible
      const liquidityPrice =
        orderSide === OrderSide.BUY ? marketData.ask : marketData.bid;

      // Calculer la taille de l'ordre
      let adjustedSize = config.positionSize;

      // Vérifier la liquidité
      const availableLiquidity = marketData.volume * liquidityPrice;
      const orderValue = adjustedSize * liquidityPrice;

      if (availableLiquidity < orderValue * minLiquidityRatio) {
        const liquidityReductionFactor =
          availableLiquidity / (orderValue * minLiquidityRatio);
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

    initializeWithHistory: async (
      historicalData: MarketData[],
    ): Promise<void> => {
      if (!historicalData || historicalData.length === 0) {
        logger.info(
          `No historical data provided for Elliott Wave strategy on ${config.symbol}`,
        );
        return;
      }

      logger.info(
        `Initializing Elliott Wave strategy with ${historicalData.length} historical data points for ${config.symbol}`,
      );

      // Reset state
      state.priceHistory = [];
      state.pivots = [];
      state.waves = [];
      state.currentWaveCount = 0;
      state.lastSignalIndex = -1;

      // Process historical data
      for (const data of historicalData) {
        if (data.symbol === config.symbol && data.price && data.price > 0) {
          state.priceHistory.push(data.price);
        }
      }

      // Detect pivots and waves for historical data
      if (state.priceHistory.length > config.waveDetectionLength) {
        state.pivots = identifyPivots(
          state.priceHistory,
          Math.floor(config.priceSensitivity * 10),
        );
        // Analyze waves using existing function
        const waveAnalysis = analyzeElliottWaves(state.pivots, 0);
        state.currentWaveCount = waveAnalysis.currentWave;
      }

      logger.info(`Elliott Wave strategy initialized for ${config.symbol}`, {
        symbol: config.symbol,
        priceHistoryLength: state.priceHistory.length,
        pivotsDetected: state.pivots.length,
        currentWaveCount: state.currentWaveCount,
      });
    },
  };
};
