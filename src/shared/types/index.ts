/**
 * Types partagés centralisés pour Lukaya Trading Bot
 * Centralise tous les types et interfaces utilisés à travers l'application
 */

// Re-export des types de domaine
export * from '../../domain/models/market.model';
export * from '../../domain/models/strategy.model';

// Re-export des types d'acteurs
export * from '../../actor/models/actor.model';

// Re-export des types de configuration
export type { ConfigType } from '../../infrastructure/config/enhanced-config';

// Types d'ID unifiés
export type ActorId = string & { readonly __actorBrand: unique symbol };
export type StrategyId = string & { readonly __strategyBrand: unique symbol };
export type TradeId = string & { readonly __tradeBrand: unique symbol };
export type PositionId = string & { readonly __positionBrand: unique symbol };

// Types de résultats standardisés
export interface Result<T, E = Error> {
  success: boolean;
  data?: T;
  error?: E;
  message?: string;
}

export interface AsyncResult<T, E = Error> extends Promise<Result<T, E>> {}

// Types de métriques
export interface Metrics {
  timestamp: number;
  [key: string]: any;
}

// Types de logging
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: any;
}

// Types de statut
export type ServiceStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
export type ActorStatus = 'created' | 'active' | 'paused' | 'terminated';
export type StrategyStatus = 'active' | 'paused' | 'backtest' | 'deprecated';

// Types d'événements
export interface SystemEvent {
  type: string;
  timestamp: number;
  source: string;
  data?: any;
}

export interface TradeEvent extends SystemEvent {
  type: 'trade.opened' | 'trade.closed' | 'trade.updated' | 'trade.cancelled';
  tradeId: TradeId;
}

export interface MarketEvent extends SystemEvent {
  type: 'market.data' | 'market.order' | 'market.fill';
  symbol: string;
}

export interface ActorEvent extends SystemEvent {
  type: 'actor.created' | 'actor.started' | 'actor.stopped' | 'actor.error';
  actorId: ActorId;
}
