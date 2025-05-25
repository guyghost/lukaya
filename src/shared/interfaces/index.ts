/**
 * Interfaces partagées pour Lukaya Trading Bot
 */

import { Result, LogLevel } from '../types';

// Interface de base pour les services
export interface Service {
  readonly name: string;
  readonly status: ServiceStatus;
  start(): Promise<Result<void>>;
  stop(): Promise<Result<void>>;
  isRunning(): boolean;
  getHealth(): Promise<HealthStatus>;
}

// Interface pour les acteurs
export interface ActorBase {
  readonly id: string;
  readonly type: string;
  readonly status: ActorStatus;
  readonly parent?: string;
  readonly children: string[];
}

// Interface pour les stratégies
export interface StrategyBase {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly weight: number;
}

// Interface pour les métriques
export interface MetricsProvider {
  getMetrics(): Promise<Record<string, any>>;
  resetMetrics(): void;
}

// Interface pour la configuration
export interface Configurable {
  updateConfig(config: any): Promise<Result<void>>;
  getConfig(): any;
  validateConfig(config: any): Result<void>;
}

// Interface pour les événements
export interface EventEmitter<T = any> {
  emit(event: string, data: T): void;
  on(event: string, handler: (data: T) => void): void;
  off(event: string, handler: (data: T) => void): void;
  once(event: string, handler: (data: T) => void): void;
}

// Interface pour le cycle de vie
export interface Lifecycle {
  initialize(): Promise<Result<void>>;
  start(): Promise<Result<void>>;
  stop(): Promise<Result<void>>;
  destroy(): Promise<Result<void>>;
}

// Interface pour la surveillance de santé
export interface HealthCheck {
  checkHealth(): Promise<HealthStatus>;
  getHealthDetails(): Promise<HealthDetails>;
}

// Types de statut
export type ServiceStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
export type ActorStatus = 'created' | 'active' | 'paused' | 'terminated';
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

// Détails de santé
export interface HealthDetails {
  status: HealthStatus;
  timestamp: number;
  checks: HealthCheckResult[];
  uptime: number;
  version: string;
}

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message?: string;
  data?: any;
  duration: number;
}
