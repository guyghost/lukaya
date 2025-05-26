import { OrderParams, Order, OrderSide, OrderType, OrderStatus } from '../../../domain/models/market.model';
import { ActorAddress } from '../../../actor/models/actor.model';
import { RiskLevel } from '../risk-manager/risk-manager.model';

/**
 * État de l'OrderManager
 */
export interface OrderManagerState {
  // Ordres en attente d'exécution
  pendingOrders: Record<string, OrderRequest>;
  
  // Ordres placés
  activeOrders: Record<string, Order>;
  
  // Historique des ordres (pour référence)
  orderHistory: Order[];
  
  // Ordres rejetés
  rejectedOrders: OrderRejection[];
  
  // Adresse de l'acteur RiskManager
  riskManagerAddress: ActorAddress | null;
  
  // Adresse de l'acteur TradingBot
  tradingBotAddress: ActorAddress | null;
  
  // Configuration
  config: OrderManagerConfig;
  
  // Compteur pour les IDs des ordres locaux
  orderIdCounter: number;
}

/**
 * Configuration de l'OrderManager
 */
export interface OrderManagerConfig {
  // Délai maximum d'attente pour un ordre (ms)
  orderTimeout: number;
  
  // Nombre maximum de tentatives pour un ordre
  maxRetryAttempts: number;
  
  // Délai entre les tentatives (ms)
  retryDelay: number;
  
  // Taille maximale de l'historique des ordres
  maxOrderHistorySize: number;
  
  // Limite de taux d'ordres par minute
  orderRateLimit: number;
}

/**
 * Requête d'ordre avec métadonnées
 */
export interface OrderRequest {
  // Paramètres de l'ordre
  orderParams: OrderParams;
  
  // ID de la stratégie qui a généré l'ordre
  strategyId: string;
  
  // Horodatage de la demande
  requestTimestamp: number;
  
  // Adresse de réponse (acteur à notifier)
  replyToAddress: ActorAddress;
  
  // Nombre de tentatives
  attempts: number;
  
  // ID de demande local
  requestId: string;
  
  // Évaluation de risque associée
  riskAssessment?: RiskAssessment;
}

/**
 * Évaluation de risque pour un ordre
 */
export interface RiskAssessment {
  // Ordre approuvé ou non
  approved: boolean;
  
  // Taille ajustée si nécessaire
  adjustedSize?: number;
  
  // Prix ajusté si nécessaire
  adjustedPrice?: number;
  
  // Raison de l'ajustement/rejet
  reason?: string;
  
  // Niveau de risque
  riskLevel: RiskLevel;
}

/**
 * Informations sur un ordre rejeté
 */
export interface OrderRejection {
  // Requête d'ordre originale
  orderRequest: OrderRequest;
  
  // Raison du rejet
  reason: string;
  
  // Horodatage du rejet
  timestamp: number;
}

/**
 * Messages pour l'OrderManager
 */
export type OrderManagerMessage =
  | { type: 'PLACE_ORDER'; orderRequest: OrderRequest }
  | { type: 'CANCEL_ORDER'; orderId: string; reason: string }
  | { type: 'ORDER_FILLED'; order: Order }
  | { type: 'ORDER_STATUS_UPDATE'; orderId: string; status: OrderStatus; filledSize?: number; avgFillPrice?: number }
  | { type: 'ORDER_REJECTED'; requestId: string; reason: string }
  | { type: 'GET_ORDER_STATUS'; orderId: string }
  | { type: 'GET_ACTIVE_ORDERS'; symbol?: string }
  | { type: 'CLEANUP_ORDERS'; olderThan?: number }
  | { type: 'REGISTER_RISK_MANAGER'; riskManagerAddress: ActorAddress }
  | { type: 'REGISTER_TRADING_BOT'; tradingBotAddress: ActorAddress }
  | { type: 'UPDATE_CONFIG'; config: Partial<OrderManagerConfig> }
  | { type: 'RISK_ASSESSMENT_RESULT'; requestId: string; riskAssessment: RiskAssessment };

/**
 * Port exposé par l'OrderManager
 */
export interface OrderManagerPort {
  placeOrder(orderParams: OrderParams, strategyId: string): Promise<Order | null>;
  cancelOrder(orderId: string, reason: string): Promise<boolean>;
  getOrderStatus(orderId: string): Promise<Order | null>;
  getActiveOrders(symbol?: string): Promise<Order[]>;
  getOrderHistory(limit?: number): Promise<Order[]>;
}
