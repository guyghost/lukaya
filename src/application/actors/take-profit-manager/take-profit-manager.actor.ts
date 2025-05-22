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

  // Configuration par défaut - Règle 3-5-7 pour maximiser les revenus et réduire le risque
  const defaultConfig: TakeProfitConfig = {
    enabled: true,
    profitTiers: [
      { profitPercentage: 3, closePercentage: 30 }, // Premier niveau: 3% de profit -> fermer 30%
      { profitPercentage: 5, closePercentage: 50 }, // Deuxième niveau: 5% de profit -> fermer 50% du reste
      { profitPercentage: 7, closePercentage: 100 }, // Troisième niveau: 7% de profit -> fermer le reste
    ],
    cooldownPeriod: 1 * 60 * 1000, // 1 minute pour réagir rapidement aux mouvements de prix
    priceTolerance: 0.5, // 0.5% de tolérance pour exécution précise
    trailingMode: false, // Désactiver le mode trailing pour appliquer strictement la règle 3-5-7
    minOrderSizePercent: 1.0 // Taille minimale d'ordre: 1% de la position initiale
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

  // Analyser une position pour déterminer si une prise de profit selon la règle 3-5-7 doit être exécutée
  const analyzePositionForTakeProfit = (
    state: TakeProfitState,
    symbol: string,
    currentPrice: number
  ): TakeProfitAnalysisResult => {
    const position = state.positions[symbol];
    
    // Position non trouvée ou déjà fermée
    if (!position || position.currentSize <= 0) {
      logger.debug(`[TAKE_PROFIT] Skipping analysis for ${symbol}: position not found or already closed`);
      return {
        shouldTakeProfit: false,
        symbol,
        reason: "Position non trouvée ou déjà fermée",
      };
    }

    // Calculer le profit actuel en pourcentage
    const profitPercentage = calculateProfitPercentage(position, currentPrice);
    
    logger.debug(`[TAKE_PROFIT] Règle 3-5-7 pour ${symbol}: ${position.direction} position, size: ${position.currentSize}, entry: ${position.entryPrice}, current: ${currentPrice}, profit: ${profitPercentage.toFixed(2)}%`);
    
    // Vérifier si nous sommes en période de refroidissement
    // Pour la règle 3-5-7, nous utilisons une période de refroidissement plus courte
    const now = Date.now();
    if (
      position.lastTakeProfit &&
      now - position.lastTakeProfit < state.config.cooldownPeriod
    ) {
      return {
        shouldTakeProfit: false,
        symbol,
        reason: "En période de refroidissement (3-5-7)",
        currentProfitPercentage: profitPercentage,
      };
    }
    
    // La règle 3-5-7 n'utilise généralement pas le mode trailing, mais nous gardons ce code
    // au cas où la configuration l'active
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

    // Calculer la taille de l'ordre de prise de profit selon la règle 3-5-7
    // Les pourcentages seront automatiquement 30%, 50% du reste, et 100% du reste final
    const closeSize = position.currentSize * (tierToTrigger.closePercentage / 100);
    
    // Pour la règle 3-5-7, nous sommes légèrement plus permissifs sur la taille minimale
    // afin de s'assurer que tous les niveaux de prise de profit sont exécutés
    const minSize = position.initialSize * (state.config.minOrderSizePercent / 100);
    if (closeSize < minSize && position.currentSize >= minSize) {
      // Si la taille calculée est trop petite mais qu'il reste assez de position,
      // on utilise au moins la taille minimum pour ne pas rater de prise de profit
      logger.debug(`[TAKE_PROFIT] Règle 3-5-7: Ajustement taille minimale pour ${symbol}: ${closeSize} -> ${minSize}`);
      return {
        shouldTakeProfit: true,
        triggerTier: tierIndex,
        orderSize: minSize,
        symbol,
        orderSide: position.direction === "long" ? OrderSide.SELL : OrderSide.BUY,
        reason: `Niveau de profit ${tierToTrigger.profitPercentage}% atteint (taille ajustée)`,
        targetPrice: currentPrice,
        currentProfitPercentage: profitPercentage,
      };
    } else if (closeSize < minSize) {
      return {
        shouldTakeProfit: false,
        symbol,
        reason: "Taille d'ordre trop petite pour règle 3-5-7",
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

  // Exécuter une prise de profit selon la règle 3-5-7
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
      // Pour la règle 3-5-7, nous identifions clairement à quel niveau de profit nous sommes
      const profitLevel = result.currentProfitPercentage && result.currentProfitPercentage >= 7 ? "7%" : 
                         (result.currentProfitPercentage && result.currentProfitPercentage >= 5 ? "5%" : "3%");
      
      // Calculer combien il reste de la position après cette prise de profit
      const remainingAfterClose = position.currentSize - result.orderSize;
      const remainingPct = (remainingAfterClose / position.initialSize) * 100;
      
      logger.info(`[TAKE_PROFIT] Règle 3-5-7: Niveau ${profitLevel} pour ${result.symbol}`, {
        tier: result.triggerTier,
        niveau: profitLevel,
        profit: result.currentProfitPercentage ? result.currentProfitPercentage.toFixed(2) + '%' : 'N/A',
        size: result.orderSize,
        restant: remainingPct.toFixed(1) + '%',
        direction: position.direction,
        currentSize: position.currentSize,
        entryPrice: position.entryPrice,
        currentPrice: result.targetPrice,
        reason: result.reason,
        tierHistory: position.triggeredTiers.join(',')
      });

      // Utilisation d'ordres limite avec un buffer plus agressif pour garantir l'exécution
      // dans le cadre de la règle 3-5-7
      
      // Calculer le prix limite en fonction de la direction avec un buffer plus agressif
      const priceBuffer = 0.003; // 0.3% de buffer pour une exécution garantie
      // Assurer que nous avons un prix valide, en utilisant le prix d'entrée comme fallback
      const basePrice = result.targetPrice || position.entryPrice;
      let limitPrice: number;
      
      if (result.orderSide === OrderSide.BUY) {
        // Pour un achat (clôture d'un short), nous voulons un prix légèrement supérieur pour garantir l'exécution
        limitPrice = basePrice * (1 + priceBuffer);
      } else {
        // Pour une vente (clôture d'un long), nous voulons un prix légèrement inférieur pour garantir l'exécution
        limitPrice = basePrice * (1 - priceBuffer);
      }
      
      // Pour la règle 3-5-7, nous utilisons des ordres IOC (Immediate-Or-Cancel)
      // plus agressifs pour garantir l'exécution à chaque niveau
      const orderParams: OrderParams = {
        symbol: result.symbol,
        side: result.orderSide,
        type: OrderType.LIMIT,
        size: result.orderSize,
        price: limitPrice,
        timeInForce: TimeInForce.IMMEDIATE_OR_CANCEL,
        reduceOnly: true, // S'assurer que cet ordre ne fera que réduire la position existante
      };

      // Placer l'ordre via le TradingPort
      const order = await tradingPort.placeOrder(orderParams);
      
      if (order) {
        // Mettre à jour l'état de la position
        position.currentSize -= result.orderSize;
        position.triggeredTiers.push(result.triggerTier);
        position.lastTakeProfit = Date.now();

        // Déterminer quel niveau de la règle 3-5-7 a été atteint
        const level = result.currentProfitPercentage && result.currentProfitPercentage >= 7 ? 3 :
                     (result.currentProfitPercentage && result.currentProfitPercentage >= 5 ? 2 : 1);
        
        // Calculer le pourcentage restant de la position initiale
        const remainingPercent = (position.currentSize / position.initialSize) * 100;
        
        logger.info(`Règle 3-5-7: Niveau ${level}/3 atteint pour ${result.symbol}`, {
          orderId: order.id,
          niveau: level,
          profit: result.currentProfitPercentage?.toFixed(2) + '%',
          remainingSize: position.currentSize,
          remainingPercent: remainingPercent.toFixed(1) + '%',
          nextTarget: level < 3 ? (level === 1 ? "5%" : "7%") : "Complété"
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