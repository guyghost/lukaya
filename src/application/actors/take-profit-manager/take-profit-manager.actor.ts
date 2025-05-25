import { ActorDefinition, ActorContext } from "../../../actor/models/actor.model";
import { OrderParams, OrderSide, OrderType, TimeInForce } from "../../../domain/models/market.model";
import { createContextualLogger } from "../../../infrastructure/logging/enhanced-logger";
import { PositionRisk } from "../risk-manager/risk-manager.model";
import { TradingPort } from "../../../application/ports/trading.port";
import {
  ProfitTier,
  PositionProfitState,
  TakeProfitAnalysisResult,
  TakeProfitConfig,
  TakeProfitMessage,
  TakeProfitPort,
  TakeProfitState,
} from "./take-profit-manager.model";

export const createTakeProfitManagerActorDefinition = (
  tradingPort: TradingPort,
  config?: Partial<TakeProfitConfig>
): ActorDefinition<TakeProfitState, TakeProfitMessage> => {
  const logger = createContextualLogger("TakeProfitManager");

  // Configuration par défaut - Règle 3-5-7 pour la gestion des prises de profit
  const defaultConfig: TakeProfitConfig = {
    enabled: true,
    profitTiers: [
      { profitPercentage: 3, closePercentage: 30 },  // 3% de profit = fermer 30% de la position
      { profitPercentage: 5, closePercentage: 30 },  // 5% de profit = fermer 30% supplémentaires
      { profitPercentage: 7, closePercentage: 100 }, // 7% de profit = fermer le reste de la position
    ],
    cooldownPeriod: 5 * 60 * 1000, // 5 minutes (réduit pour plus de réactivité)
    priceTolerance: 0.2, // 0.2% de tolérance (plus précis)
    trailingMode: false,
    minOrderSizePercent: 5, // Taille minimale d'ordre: 5% de la position initiale
  };

  // Fusionner avec la configuration fournie
  const mergedConfig: TakeProfitConfig = {
    ...defaultConfig,
    ...(config || {}),
    profitTiers: config?.profitTiers || defaultConfig.profitTiers,
  };

  // État initial
  const initialState: TakeProfitState = {
    config: mergedConfig,
    positions: {},
  };

  // Tri des niveaux de profit par ordre croissant
  const getSortedProfitTiers = (config: TakeProfitConfig): ProfitTier[] => {
    return [...config.profitTiers].sort((a, b) => a.profitPercentage - b.profitPercentage);
  };

  // Calculer le pourcentage de profit actuel pour une position
  const calculateProfitPercentage = (
    position: PositionProfitState,
    currentPrice: number
  ): number => {
    if (position.direction === "long") {
      return ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    } else {
      return ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
    }
  };

  // Analyser une position pour déterminer si une prise de profit doit être exécutée
  const analyzePositionForTakeProfit = (
    state: TakeProfitState,
    symbol: string,
    currentPrice: number
  ): TakeProfitAnalysisResult => {
    const position = state.positions[symbol];
    
    // Position non trouvée ou déjà fermée
    if (!position || position.currentSize <= 0) {
      return {
        shouldTakeProfit: false,
        symbol,
        reason: "Position non trouvée ou déjà fermée",
      };
    }

    // Calculer le profit actuel en pourcentage
    const profitPercentage = calculateProfitPercentage(position, currentPrice);
    
    // Vérifier si nous sommes en période de refroidissement
    const now = Date.now();
    if (
      position.lastTakeProfit &&
      now - position.lastTakeProfit < state.config.cooldownPeriod
    ) {
      return {
        shouldTakeProfit: false,
        symbol,
        reason: "En période de refroidissement",
        currentProfitPercentage: profitPercentage,
      };
    }

    // Mettre à jour le highWatermark pour le trailing take profit
    if (state.config.trailingMode) {
      if (position.direction === "long" && currentPrice > (position.highWatermark || 0)) {
        position.highWatermark = currentPrice;
      } else if (position.direction === "short" && currentPrice < (position.highWatermark || Infinity)) {
        position.highWatermark = currentPrice;
      }
    }

    // Obtenir les niveaux de profit triés
    const sortedTiers = getSortedProfitTiers(state.config);
    
    // Identifier le niveau de profit à déclencher
    let tierToTrigger: ProfitTier | null = null;
    let tierIndex = -1;

    for (let i = sortedTiers.length - 1; i >= 0; i--) {
      const tier = sortedTiers[i];
      
      // Vérifier si le niveau est éligible
      if (
        profitPercentage >= tier.profitPercentage &&
        !position.triggeredTiers.includes(i)
      ) {
        tierToTrigger = tier;
        tierIndex = i;
        break;
      }
    }

    // Aucun niveau éligible trouvé
    if (!tierToTrigger || tierIndex === -1) {
      return {
        shouldTakeProfit: false,
        symbol,
        reason: "Aucun niveau de profit éligible",
        currentProfitPercentage: profitPercentage,
      };
    }

    // Calculer la taille de l'ordre de prise de profit
    const closeSize = position.currentSize * (tierToTrigger.closePercentage / 100);
    
    // Vérifier si la taille est suffisante
    const minSize = position.initialSize * (state.config.minOrderSizePercent / 100);
    if (closeSize < minSize) {
      return {
        shouldTakeProfit: false,
        symbol,
        reason: "Taille d'ordre trop petite",
        currentProfitPercentage: profitPercentage,
      };
    }

    // Déterminer le côté de l'ordre (inverse de la position)
    const orderSide = position.direction === "long" ? OrderSide.SELL : OrderSide.BUY;

    return {
      shouldTakeProfit: true,
      triggerTier: tierIndex,
      orderSize: closeSize,
      symbol,
      orderSide,
      reason: `Niveau de profit ${tierToTrigger.profitPercentage}% atteint`,
      targetPrice: currentPrice,
      currentProfitPercentage: profitPercentage,
    };
  };

  // Obtenir le statut des règles de prise de profit pour une position
  const getTakeProfitStatus = (
    state: TakeProfitState,
    symbol: string
  ): { 
    symbol: string; 
    status: { 
      level: number; 
      percentage: number; 
      triggered: boolean; 
      currentProfit: number | null;
    }[];
    enabled: boolean;
    trailingMode: boolean;
  } | null => {
    const position = state.positions[symbol];
    if (!position) return null;
    
    // Calculer le profit actuel si on a un prix récent
    let currentProfit = null;
    if (position.highWatermark) {
      currentProfit = calculateProfitPercentage(position, position.highWatermark);
    }
    
    // Statut pour chaque niveau de la règle 3-5-7
    const status = state.config.profitTiers.map((tier, index) => ({
      level: index + 1,
      percentage: tier.profitPercentage,
      triggered: position.triggeredTiers.includes(index),
      currentProfit,
    }));
    
    return {
      symbol,
      status,
      enabled: state.config.enabled,
      trailingMode: state.config.trailingMode
    };
  };

  // Exécuter une prise de profit
  const executeTakeProfit = async (
    state: TakeProfitState,
    result: TakeProfitAnalysisResult
  ) => {
    if (!result.shouldTakeProfit || !result.orderSide || !result.orderSize || !result.triggerTier) {
      return;
    }

    const position = state.positions[result.symbol];
    if (!position) return;

    try {
      logger.info(`[Règle 3-5-7] Exécution de prise de profit pour ${result.symbol}`, {
        niveau: `${result.currentProfitPercentage?.toFixed(2)}%`,
        palier: result.triggerTier === 0 ? "1er (3%)" : result.triggerTier === 1 ? "2ème (5%)" : "3ème (7%)",
        tailleFermee: `${(result.orderSize / position.initialSize * 100).toFixed(2)}% de la position initiale`,
        tailleRestante: `${(position.currentSize - result.orderSize) / position.initialSize * 100}% restant`,
      });

      // Créer les paramètres de l'ordre
      const orderParams: OrderParams = {
        symbol: result.symbol,
        side: result.orderSide,
        type: OrderType.MARKET,
        size: result.orderSize,
        // Pour les ordres au marché, ne pas spécifier timeInForce
        // car cela peut causer des problèmes de compatibilité avec l'API dYdX
      };

      // Placer l'ordre via le TradingPort
      const order = await tradingPort.placeOrder(orderParams);
      
      if (order) {
        // Mettre à jour l'état de la position
        position.currentSize -= result.orderSize;
        position.triggeredTiers.push(result.triggerTier);
        position.lastTakeProfit = Date.now();

        logger.info(`[Règle 3-5-7] Prise de profit exécutée avec succès pour ${result.symbol}`, {
          orderId: order.id,
          profit: `${result.currentProfitPercentage?.toFixed(2)}%`,
          palier: result.triggerTier === 0 ? "1er palier (3%)" : result.triggerTier === 1 ? "2ème palier (5%)" : "3ème palier (7%)",
          ferme: `${(result.orderSize / position.initialSize * 100).toFixed(2)}% de la position initiale`,
          restant: `${(position.currentSize / position.initialSize * 100).toFixed(2)}% restant`,
        });
      }
    } catch (error) {
      logger.error(`Erreur lors de l'exécution de prise de profit pour ${result.symbol}`, error as Error);
    }
  };

  // Créer un service pour exposer les fonctionnalités
  const createService = (context: ActorContext<TakeProfitState>): TakeProfitPort => {
    return {
      updateConfig: async (configUpdate: Partial<TakeProfitConfig>) => {
        context.send(context.self, {
          type: "UPDATE_CONFIG",
          config: configUpdate,
        });
      },

      positionOpened: async (position: PositionRisk) => {
        context.send(context.self, {
          type: "POSITION_OPENED",
          position,
        });
      },

      positionUpdated: async (position: PositionRisk) => {
        context.send(context.self, {
          type: "POSITION_UPDATED",
          position,
        });
      },

      positionClosed: async (symbol: string) => {
        context.send(context.self, {
          type: "POSITION_CLOSED",
          symbol,
        });
      },

      analyzePosition: async (symbol: string, currentPrice: number) => {
        const state = context.state();
        return analyzePositionForTakeProfit(state, symbol, currentPrice);
      },

      getPositionState: async (symbol: string) => {
        const state = context.state();
        return state.positions[symbol] || null;
      },

      getAllPositions: async () => {
        const state = context.state();
        return state.positions;
      },
      
      getTakeProfitStatus: async (symbol: string) => {
        const state = context.state();
        return getTakeProfitStatus(state, symbol);
      },
    };
  };

  // Définition de l'acteur
  return {
    initialState,

    // Gestion des messages
    behavior: async (state: TakeProfitState, message: { payload: TakeProfitMessage }, context: ActorContext<TakeProfitState>) => {
      const msg = message.payload;
      switch (msg.type) {
        case "UPDATE_CONFIG":
          return {
            state: {
              ...state,
              config: {
                ...state.config,
                ...msg.config,
                profitTiers: msg.config.profitTiers || state.config.profitTiers,
              },
            },
          };

        case "POSITION_OPENED":
          // Convertir PositionRisk en PositionProfitState
          const newPosition: PositionProfitState = {
            symbol: msg.position.symbol,
            direction: msg.position.direction === "none" ? "long" : msg.position.direction,
            initialSize: Math.abs(msg.position.size),
            currentSize: Math.abs(msg.position.size),
            entryPrice: msg.position.entryPrice,
            triggeredTiers: [],
            highWatermark: msg.position.direction === "long" 
              ? msg.position.currentPrice 
              : msg.position.currentPrice,
            lastTakeProfit: 0,
          };

          return {
            state: {
              ...state,
              positions: {
                ...state.positions,
                [msg.position.symbol]: newPosition,
              },
            },
          };

        case "POSITION_UPDATED":
          const existingPosition = state.positions[msg.position.symbol];
          
          // Si la position n'existe pas, la créer
          if (!existingPosition) {
            context.send(context.self, {
              type: "POSITION_OPENED",
              position: msg.position,
            });
            return { state };
          }

          // Si la taille change, mettre à jour l'état
          if (Math.abs(msg.position.size) !== existingPosition.currentSize) {
            const updatedPosition: PositionProfitState = {
              ...existingPosition,
              currentSize: Math.abs(msg.position.size),
            };

            return {
              state: {
                ...state,
                positions: {
                  ...state.positions,
                  [msg.position.symbol]: updatedPosition,
                },
              },
            };
          }
          
          return { state };

        case "POSITION_CLOSED":
          // Supprimer la position des positions suivies
          const { [msg.symbol]: positionToRemove, ...remainingPositions } = state.positions;
          
          return {
            state: {
              ...state,
              positions: remainingPositions,
            },
          };

        case "MARKET_UPDATE":
          // Si la fonctionnalité est désactivée, ne rien faire
          if (!state.config.enabled) return { state };

          // Si nous n'avons pas de position sur ce symbole, ne rien faire
          if (!state.positions[msg.symbol]) return { state };

          // Analyser la position pour une prise de profit potentielle
          const result = analyzePositionForTakeProfit(state, msg.symbol, msg.price);
          
          // Si une prise de profit est recommandée, l'exécuter
          if (result.shouldTakeProfit) {
            await executeTakeProfit(state, result);
          }
          
          return { state };

        case "ANALYZE_POSITION":
          // Analyser une position spécifique
          return { state };

        default:
          return { state };
      }
    },
  };
};