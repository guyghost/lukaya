import { ActorDefinition, ActorContext } from "../../../actor/models/actor.model";
import { OrderParams, OrderSide, OrderType, TimeInForce } from "../../../domain/models/market.model";
import { getLogger } from "../../../infrastructure/logger";
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
  const logger = getLogger();

  // Configuration par défaut - Mise à jour pour une stratégie plus agressive
  const defaultConfig: TakeProfitConfig = {
    enabled: true,
    profitTiers: [
      { profitPercentage: 15, closePercentage: 20 }, // Objectif plus élevé avant la première sortie partielle
      { profitPercentage: 30, closePercentage: 30 }, // Sortie partielle plus petite
      { profitPercentage: 45, closePercentage: 40 }, // Objectifs plus ambitieux
      { profitPercentage: 75, closePercentage: 100 }, // Objectif final beaucoup plus élevé
    ],
    cooldownPeriod: 5 * 60 * 1000, // 5 minutes (réduit)
    priceTolerance: 0.8, // 0.8% de tolérance (augmenté)
    trailingMode: true, // Activer le mode trailing pour capturer plus de hausse
    minOrderSizePercent: 3, // Taille minimale d'ordre: 3% de la position initiale (réduit)
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
      logger.info(`Exécution de prise de profit pour ${result.symbol}`, {
        tier: result.triggerTier,
        profit: result.currentProfitPercentage,
        size: result.orderSize,
      });

      // Créer les paramètres de l'ordre - Version plus agressive
      // Utilise des ordres LIMIT au lieu de MARKET pour potentiellement obtenir un meilleur prix
      // et ajoute un décalage de prix agressif en faveur de l'ordre
      
      // Calculer le prix limite en fonction de la direction (avec un buffer de prix favorable)
      const priceBuffer = 0.002; // 0.2% de buffer de prix
      // Assurer que nous avons un prix valide, en utilisant le prix d'entrée comme fallback
      const basePrice = result.targetPrice || position.entryPrice;
      let limitPrice: number;
      
      if (result.orderSide === OrderSide.BUY) {
        // Pour un achat (clôture d'un short), nous voulons un prix légèrement inférieur
        limitPrice = basePrice * (1 - priceBuffer);
      } else {
        // Pour une vente (clôture d'un long), nous voulons un prix légèrement supérieur
        limitPrice = basePrice * (1 + priceBuffer);
      }
      
      const orderParams: OrderParams = {
        symbol: result.symbol,
        side: result.orderSide,
        type: OrderType.LIMIT,
        size: result.orderSize,
        price: limitPrice,
        timeInForce: TimeInForce.IMMEDIATE_OR_CANCEL, // Exécuter immédiatement ou annuler
      };

      // Placer l'ordre via le TradingPort
      const order = await tradingPort.placeOrder(orderParams);
      
      if (order) {
        // Mettre à jour l'état de la position
        position.currentSize -= result.orderSize;
        position.triggeredTiers.push(result.triggerTier);
        position.lastTakeProfit = Date.now();

        logger.info(`Prise de profit exécutée avec succès pour ${result.symbol}`, {
          orderId: order.id,
          remainingSize: position.currentSize,
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