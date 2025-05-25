/**
 * Point d'entrée centralisé pour tous les exports partagés
 */

// Types principaux disponibles
export type {
  MarketData,
  OrderParams,
  StrategySignal,
  StrategyConfig,
  Strategy,
  Result,
  AsyncResult,
  Metrics,
  LogLevel,
  LogContext,
  SystemEvent,
  TradeEvent,
  MarketEvent,
  ActorEvent,
  ConfigType,
  ActorId,
  StrategyId,
  TradeId,
  PositionId
} from './types';

// Enums du marché
export {
  OrderSide,
  OrderType,
  TimeInForce
} from '../domain/models/market.model';

// Constantes
export * from './constants';

// Utilitaires
export * from './utils';

// Interfaces disponibles
export type {
  Service,
  ActorBase,
  StrategyBase,
  MetricsProvider,
  Configurable,
  EventEmitter,
  Lifecycle,
  HealthCheck,
  HealthDetails,
  HealthCheckResult
} from './interfaces';

// Enums principaux (exports explicites)
export {
  ServiceStatus,
  ActorStatus,
  StrategyStatus,
  StrategyType,
  SupervisorStrategy
} from './enums';

// Types de statut des interfaces (pour éviter les conflits)
export type {
  ServiceStatus as IServiceStatus,
  ActorStatus as IActorStatus,
  HealthStatus
} from './interfaces';
