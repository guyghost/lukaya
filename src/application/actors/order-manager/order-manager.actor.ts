import { ActorContext, ActorMessage, ActorDefinition, ActorAddress } from "../../../actor/models/actor.model";
import { 
  OrderManagerMessage,
  OrderManagerState,
  OrderManagerConfig,
  OrderRequest,
  OrderRejection,
  RiskAssessment
} from "./order-manager.model";
import { Order, OrderParams, OrderStatus } from "../../../domain/models/market.model";
import { createContextualLogger } from "../../../infrastructure/logging/enhanced-logger";
import { TradingPort } from "../../ports/trading.port";

/**
 * Crée la définition de l'acteur OrderManager
 */
export const createOrderManagerActorDefinition = (
  tradingPort: TradingPort,
  config?: Partial<OrderManagerConfig>
): ActorDefinition<OrderManagerState, OrderManagerMessage> => {
  const logger = createContextualLogger("OrderManager");
  
  // Configuration par défaut
  const defaultConfig: OrderManagerConfig = {
    orderTimeout: 30000, // 30 secondes
    maxRetryAttempts: 3,
    retryDelay: 1000, // 1 seconde
    maxOrderHistorySize: 1000,
    orderRateLimit: 60 // 60 ordres par minute
  };
  
  // Fusionner avec la configuration fournie
  const mergedConfig: OrderManagerConfig = {
    ...defaultConfig,
    ...config
  };
  
  // État initial
  const initialState: OrderManagerState = {
    pendingOrders: {},
    activeOrders: {},
    orderHistory: [],
    rejectedOrders: [],
    riskManagerAddress: null,
    tradingBotAddress: null,
    config: mergedConfig,
    orderIdCounter: 1
  };
  
  // Fonctions utilitaires
  
  /**
   * Génère un ID de requête unique
   */
  const generateRequestId = (state: OrderManagerState): string => {
    return `req_${Date.now()}_${state.orderIdCounter++}`;
  };
  
  /**
   * Enregistre un ordre dans l'historique et gère sa taille maximale
   */
  const addToOrderHistory = (state: OrderManagerState, order: Order): OrderManagerState => {
    const updatedHistory = [order, ...state.orderHistory];
    
    // Limiter la taille de l'historique
    const trimmedHistory = updatedHistory.slice(0, state.config.maxOrderHistorySize);
    
    return {
      ...state,
      orderHistory: trimmedHistory
    };
  };
  
  /**
   * Supprime un ordre des ordres en attente
   */
  const removeFromPendingOrders = (state: OrderManagerState, requestId: string): OrderManagerState => {
    const { [requestId]: _, ...remainingOrders } = state.pendingOrders;
    
    return {
      ...state,
      pendingOrders: remainingOrders
    };
  };
  
  /**
   * Supprime un ordre des ordres actifs
   */
  const removeFromActiveOrders = (state: OrderManagerState, orderId: string): OrderManagerState => {
    const { [orderId]: _, ...remainingOrders } = state.activeOrders;
    
    return {
      ...state,
      activeOrders: remainingOrders
    };
  };
  
  /**
   * Comportement de l'acteur
   */
  const behavior = async (
    state: OrderManagerState,
    message: ActorMessage<OrderManagerMessage>,
    context: ActorContext<OrderManagerState>
  ) => {
    const { payload } = message;
    
    switch (payload.type) {
      case "PLACE_ORDER": {
        const { orderRequest } = payload;
        const { orderParams, strategyId, requestId } = orderRequest;
        
        logger.info(`Traitement de la demande d'ordre ${requestId} pour ${orderParams.symbol}`, {
          strategyId,
          side: orderParams.side,
          size: orderParams.size,
          type: orderParams.type,
          price: orderParams.price
        });
        
        // Ajouter aux ordres en attente
        const updatedPendingOrders = {
          ...state.pendingOrders,
          [requestId]: orderRequest
        };
        
        try {
          // Si nous avons un risk manager, demander l'évaluation du risque
          if (state.riskManagerAddress) {
            logger.debug(`Demande d'évaluation de risque pour l'ordre ${requestId}`);
            context.send(state.riskManagerAddress, {
              type: "ASSESS_ORDER",
              order: orderParams,
              requestId
            });
            
            // Mettre à jour l'état avec l'ordre en attente
            return {
              state: {
                ...state,
                pendingOrders: updatedPendingOrders
              }
            };
          }
          
          // Sinon, placer l'ordre directement
          logger.info(`Placement direct de l'ordre ${requestId} sans évaluation de risque`);
          const placedOrder = await tradingPort.placeOrder(orderParams);
          
          if (placedOrder) {
            logger.info(`Ordre ${requestId} placé avec succès: ${placedOrder.id}`);
            
            // Notifier l'expéditeur
            context.send(orderRequest.replyToAddress, {
              type: "ORDER_PLACED",
              order: placedOrder,
              requestId
            });
            
            // Mettre à jour l'état avec l'ordre placé
            return {
              state: {
                ...state,
                activeOrders: {
                  ...state.activeOrders,
                  [placedOrder.id]: placedOrder
                },
                orderHistory: [placedOrder, ...state.orderHistory].slice(0, state.config.maxOrderHistorySize),
                pendingOrders: removeFromPendingOrders(state, requestId).pendingOrders
              }
            };
          } else {
            logger.error(`Échec du placement de l'ordre ${requestId}`);
            
            // Ajouter aux ordres rejetés
            const rejection: OrderRejection = {
              orderRequest,
              reason: "Échec du placement de l'ordre",
              timestamp: Date.now()
            };
            
            // Notifier l'expéditeur
            context.send(orderRequest.replyToAddress, {
              type: "ORDER_REJECTED",
              requestId,
              reason: "Échec du placement de l'ordre"
            });
            
            return {
              state: {
                ...state,
                rejectedOrders: [rejection, ...state.rejectedOrders],
                pendingOrders: removeFromPendingOrders(state, requestId).pendingOrders
              }
            };
          }
        } catch (error) {
          logger.error(`Erreur lors du placement de l'ordre ${requestId}:`, error as Error);
          
          // Ajouter aux ordres rejetés
          const rejection: OrderRejection = {
            orderRequest,
            reason: `Erreur: ${(error as Error).message}`,
            timestamp: Date.now()
          };
          
          // Notifier l'expéditeur
          context.send(orderRequest.replyToAddress, {
            type: "ORDER_REJECTED",
            requestId,
            reason: `Erreur: ${(error as Error).message}`
          });
          
          return {
            state: {
              ...state,
              rejectedOrders: [rejection, ...state.rejectedOrders],
              pendingOrders: removeFromPendingOrders(state, requestId).pendingOrders
            }
          };
        }
      }
      
      case "CANCEL_ORDER": {
        const { orderId, reason } = payload;
        logger.info(`Annulation de l'ordre ${orderId}: ${reason}`);
        
        // Vérifier si l'ordre existe
        if (!state.activeOrders[orderId]) {
          logger.warn(`Ordre ${orderId} introuvable pour annulation`);
          return { state };
        }
        
        try {
          const success = await tradingPort.cancelOrder(orderId);
          
          if (success) {
            logger.info(`Ordre ${orderId} annulé avec succès`);
            
            // Mettre à jour l'ordre dans l'historique
            const cancelledOrder: Order = {
              ...state.activeOrders[orderId],
              status: OrderStatus.CANCELED,
              updatedAt: Date.now()
            };
            
            // Notifier l'acteur TradingBot
            if (state.tradingBotAddress) {
              context.send(state.tradingBotAddress, {
                type: "ORDER_CANCELLED",
                order: cancelledOrder,
                reason
              });
            }
            
            return {
              state: {
                ...state,
                activeOrders: removeFromActiveOrders(state, orderId).activeOrders,
                orderHistory: addToOrderHistory(state, cancelledOrder).orderHistory
              }
            };
          } else {
            logger.error(`Échec de l'annulation de l'ordre ${orderId}`);
            return { state };
          }
        } catch (error) {
          logger.error(`Erreur lors de l'annulation de l'ordre ${orderId}:`, error as Error);
          return { state };
        }
      }
      
      case "ORDER_FILLED": {
        const { order } = payload;
        logger.info(`Ordre ${order.id} exécuté: ${order.symbol} ${order.side} ${order.filledSize}/${order.size} @ ${order.avgFillPrice || 'market'}`);
        
        // Mettre à jour l'état
        return {
          state: {
            ...state,
            activeOrders: removeFromActiveOrders(state, order.id).activeOrders,
            orderHistory: addToOrderHistory(state, order).orderHistory
          }
        };
      }
      
      case "ORDER_STATUS_UPDATE": {
        const { orderId, status, filledSize, avgFillPrice } = payload;
        
        // Vérifier si l'ordre existe
        if (!state.activeOrders[orderId]) {
          logger.warn(`Ordre ${orderId} introuvable pour mise à jour du statut`);
          return { state };
        }
        
        logger.debug(`Mise à jour du statut de l'ordre ${orderId}: ${status}`);
        
        // Mettre à jour l'ordre
        const updatedOrder: Order = {
          ...state.activeOrders[orderId],
          status,
          updatedAt: Date.now(),
          ...(filledSize !== undefined && { filledSize }),
          ...(avgFillPrice !== undefined && { avgFillPrice })
        };
        
        // Si l'ordre est terminé (exécuté ou annulé), le supprimer des ordres actifs
        if (status === OrderStatus.FILLED || status === OrderStatus.CANCELED || status === OrderStatus.EXPIRED) {
          // Notifier l'acteur TradingBot
          if (state.tradingBotAddress) {
            context.send(state.tradingBotAddress, {
              type: status === OrderStatus.FILLED ? "ORDER_FILLED" : "ORDER_CANCELLED",
              order: updatedOrder,
              reason: status === OrderStatus.FILLED ? "Ordre exécuté" : "Ordre annulé/expiré"
            });
          }
          
          return {
            state: {
              ...state,
              activeOrders: removeFromActiveOrders(state, orderId).activeOrders,
              orderHistory: addToOrderHistory(state, updatedOrder).orderHistory
            }
          };
        }
        
        // Sinon, mettre à jour l'ordre dans les ordres actifs
        return {
          state: {
            ...state,
            activeOrders: {
              ...state.activeOrders,
              [orderId]: updatedOrder
            }
          }
        };
      }
      
      case "ORDER_REJECTED": {
        const { requestId, reason } = payload;
        
        // Vérifier si la demande existe
        if (!state.pendingOrders[requestId]) {
          logger.warn(`Demande d'ordre ${requestId} introuvable pour rejet`);
          return { state };
        }
        
        logger.warn(`Ordre ${requestId} rejeté: ${reason}`);
        
        const orderRequest = state.pendingOrders[requestId];
        
        // Créer un objet de rejet
        const rejection: OrderRejection = {
          orderRequest,
          reason,
          timestamp: Date.now()
        };
        
        // Notifier l'expéditeur
        context.send(orderRequest.replyToAddress, {
          type: "ORDER_REJECTED",
          requestId,
          reason
        });
        
        return {
          state: {
            ...state,
            pendingOrders: removeFromPendingOrders(state, requestId).pendingOrders,
            rejectedOrders: [rejection, ...state.rejectedOrders]
          }
        };
      }
      
      case "GET_ORDER_STATUS": {
        const { orderId } = payload;
        
        // Vérifier dans les ordres actifs
        if (state.activeOrders[orderId]) {
          return { state };
        }
        
        // Vérifier dans l'historique
        const historicalOrder = state.orderHistory.find(order => order.id === orderId);
        if (historicalOrder) {
          return { state };
        }
        
        // Ordre introuvable, demander à l'API
        try {
          const order = await tradingPort.getOrder(orderId);
          
          if (order) {
            // Mettre à jour l'historique si l'ordre est trouvé
            return {
              state: {
                ...state,
                orderHistory: addToOrderHistory(state, order).orderHistory
              }
            };
          }
        } catch (error) {
          logger.error(`Erreur lors de la récupération du statut de l'ordre ${orderId}:`, error as Error);
        }
        
        return { state };
      }
      
      case "GET_ACTIVE_ORDERS": {
        const { symbol } = payload;
        
        // Filtrer par symbole si spécifié
        if (symbol) {
          const filteredOrders = Object.values(state.activeOrders).filter(
            order => order.symbol === symbol
          );
          
          logger.debug(`${filteredOrders.length} ordres actifs trouvés pour ${symbol}`);
        } else {
          logger.debug(`${Object.keys(state.activeOrders).length} ordres actifs au total`);
        }
        
        return { state };
      }
      
      case "CLEANUP_ORDERS": {
        const { olderThan = 24 * 60 * 60 * 1000 } = payload; // Par défaut, nettoyer les ordres de plus de 24h
        const cutoffTime = Date.now() - olderThan;
        
        // Filtrer l'historique des ordres
        const updatedHistory = state.orderHistory.filter(
          order => order.updatedAt > cutoffTime
        );
        
        // Filtrer les rejets
        const updatedRejections = state.rejectedOrders.filter(
          rejection => rejection.timestamp > cutoffTime
        );
        
        logger.info(`Nettoyage des ordres: ${state.orderHistory.length - updatedHistory.length} ordres et ${state.rejectedOrders.length - updatedRejections.length} rejets supprimés`);
        
        return {
          state: {
            ...state,
            orderHistory: updatedHistory,
            rejectedOrders: updatedRejections
          }
        };
      }
      
      case "REGISTER_RISK_MANAGER": {
        const { riskManagerAddress } = payload;
        logger.info("Enregistrement du RiskManager");
        
        return {
          state: {
            ...state,
            riskManagerAddress
          }
        };
      }
      
      case "REGISTER_TRADING_BOT": {
        const { tradingBotAddress } = payload;
        logger.info("Enregistrement du TradingBot");
        
        return {
          state: {
            ...state,
            tradingBotAddress
          }
        };
      }
      
      case "UPDATE_CONFIG": {
        const { config } = payload;
        logger.info("Mise à jour de la configuration", { config });
        
        return {
          state: {
            ...state,
            config: {
              ...state.config,
              ...config
            }
          }
        };
      }
      
      case "RISK_ASSESSMENT_RESULT": {
        const { requestId, riskAssessment } = payload;
        logger.info(`Réception du résultat d'évaluation de risque pour la requête ${requestId}: ${riskAssessment.approved ? 'APPROUVÉ' : 'REJETÉ'}`, {
          riskLevel: riskAssessment.riskLevel,
          adjustedSize: riskAssessment.adjustedSize,
          reason: riskAssessment.reason
        });
        
        // Vérifier si la requête est toujours en attente
        if (!state.pendingOrders[requestId]) {
          logger.warn(`Requête ${requestId} non trouvée dans les ordres en attente, ignorée`);
          return { state };
        }
        
        const orderRequest = state.pendingOrders[requestId];
        
        // Si l'ordre est rejeté par le RiskManager
        if (!riskAssessment.approved) {
          logger.warn(`Ordre ${requestId} rejeté par le RiskManager: ${riskAssessment.reason}`);
          
          // Créer un rejet d'ordre
          const rejection: OrderRejection = {
            orderRequest,
            reason: riskAssessment.reason || "Rejeté par l'évaluation de risque",
            timestamp: Date.now()
          };
          
          // Notifier l'expéditeur
          if (orderRequest.replyToAddress) {
            context.send(orderRequest.replyToAddress, {
              type: "ORDER_REJECTED",
              requestId,
              reason: riskAssessment.reason || "Rejeté par l'évaluation de risque"
            });
          }
          
          // Mettre à jour l'état
          return {
            state: {
              ...state,
              rejectedOrders: [rejection, ...state.rejectedOrders],
              pendingOrders: removeFromPendingOrders(state, requestId).pendingOrders
            }
          };
        }
        
        // Appliquer les ajustements suggérés par le RiskManager
        let adjustedOrderParams = { ...orderRequest.orderParams };
        
        if (riskAssessment.adjustedSize) {
          logger.info(`Ajustement de la taille de l'ordre ${requestId} de ${orderRequest.orderParams.size} à ${riskAssessment.adjustedSize}`);
          adjustedOrderParams.size = riskAssessment.adjustedSize;
        }
        
        if (riskAssessment.adjustedPrice) {
          logger.info(`Ajustement du prix de l'ordre ${requestId} de ${orderRequest.orderParams.price} à ${riskAssessment.adjustedPrice}`);
          adjustedOrderParams.price = riskAssessment.adjustedPrice;
        }
        
        // Mettre à jour l'ordre en attente avec l'évaluation de risque
        const updatedOrderRequest = {
          ...orderRequest,
          orderParams: adjustedOrderParams,
          riskAssessment
        };
        
        // Placer l'ordre avec les paramètres ajustés
        try {
          logger.info(`Placement de l'ordre ${requestId} après évaluation de risque`);
          const placedOrder = await tradingPort.placeOrder(adjustedOrderParams);
          
          if (placedOrder) {
            logger.info(`Ordre ${requestId} placé avec succès: ${placedOrder.id}`);
            
            // Notifier l'expéditeur
            if (orderRequest.replyToAddress) {
              context.send(orderRequest.replyToAddress, {
                type: "ORDER_PLACED",
                order: placedOrder,
                requestId
              });
            }
            
            // Mettre à jour l'état avec l'ordre placé
            return {
              state: {
                ...state,
                activeOrders: {
                  ...state.activeOrders,
                  [placedOrder.id]: placedOrder
                },
                orderHistory: [placedOrder, ...state.orderHistory].slice(0, state.config.maxOrderHistorySize),
                pendingOrders: removeFromPendingOrders(state, requestId).pendingOrders
              }
            };
          } else {
            logger.error(`Échec du placement de l'ordre ${requestId} après évaluation de risque`);
            
            // Ajouter aux ordres rejetés
            const rejection: OrderRejection = {
              orderRequest: updatedOrderRequest,
              reason: "Échec du placement de l'ordre après évaluation de risque",
              timestamp: Date.now()
            };
            
            // Notifier l'expéditeur
            if (orderRequest.replyToAddress) {
              context.send(orderRequest.replyToAddress, {
                type: "ORDER_REJECTED",
                requestId,
                reason: "Échec du placement de l'ordre après évaluation de risque"
              });
            }
            
            return {
              state: {
                ...state,
                rejectedOrders: [rejection, ...state.rejectedOrders],
                pendingOrders: removeFromPendingOrders(state, requestId).pendingOrders
              }
            };
          }
        } catch (error) {
          logger.error(`Erreur lors du placement de l'ordre ${requestId} après évaluation de risque:`, error as Error);
          
          // Ajouter aux ordres rejetés
          const rejection: OrderRejection = {
            orderRequest: updatedOrderRequest,
            reason: `Erreur: ${(error as Error).message}`,
            timestamp: Date.now()
          };
          
          // Notifier l'expéditeur
          if (orderRequest.replyToAddress) {
            context.send(orderRequest.replyToAddress, {
              type: "ORDER_REJECTED",
              requestId,
              reason: `Erreur: ${(error as Error).message}`
            });
          }
          
          return {
            state: {
              ...state,
              rejectedOrders: [rejection, ...state.rejectedOrders],
              pendingOrders: removeFromPendingOrders(state, requestId).pendingOrders
            }
          };
        }
      }
      
      default:
        return { state };
    }
  };
  
  return {
    initialState,
    behavior,
    supervisorStrategy: { type: "restart" }
  };
};

/**
 * Crée un service OrderManager
 */
export const createOrderManagerService = (
  tradingPort: TradingPort,
  config?: Partial<OrderManagerConfig>
) => {
  const actorDefinition = createOrderManagerActorDefinition(tradingPort, config);
  
  return {
    getActorDefinition: () => actorDefinition
  };
};
