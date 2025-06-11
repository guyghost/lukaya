/**
 * Enums partagés pour Lukaya Trading Bot
 */

// Statuts des services
export enum ServiceStatus {
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  ERROR = 'error',
}

// Statuts des acteurs
export enum ActorStatus {
  CREATED = 'created',
  ACTIVE = 'active',
  PAUSED = 'paused',
  TERMINATED = 'terminated',
}

// Statuts des stratégies
export enum StrategyStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  BACKTEST = 'backtest',
  DEPRECATED = 'deprecated',
}

// Types de stratégies
export enum StrategyType {
  RSI_DIVERGENCE = 'rsi-divergence',
  VOLUME_ANALYSIS = 'volume-analysis',
  ELLIOTT_WAVE = 'elliott-wave',
  HARMONIC_PATTERN = 'harmonic-pattern',
  SCALPING_ENTRY_EXIT = 'scalping-entry-exit',
  COORDINATED_MULTI_STRATEGY = 'coordinated-multi-strategy',
}

// Niveaux de log
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

// Statuts de santé
export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
  UNKNOWN = 'unknown',
}

// Types d'événements système
export enum SystemEventType {
  // Événements d'acteurs
  ACTOR_CREATED = 'actor.created',
  ACTOR_STARTED = 'actor.started',
  ACTOR_STOPPED = 'actor.stopped',
  ACTOR_ERROR = 'actor.error',
  
  // Événements de trading
  TRADE_OPENED = 'trade.opened',
  TRADE_CLOSED = 'trade.closed',
  TRADE_UPDATED = 'trade.updated',
  TRADE_CANCELLED = 'trade.cancelled',
  
  // Événements de marché
  MARKET_DATA_RECEIVED = 'market.data',
  ORDER_PLACED = 'market.order',
  ORDER_FILLED = 'market.fill',
  
  // Événements de stratégie
  STRATEGY_SIGNAL = 'strategy.signal',
  STRATEGY_ENABLED = 'strategy.enabled',
  STRATEGY_DISABLED = 'strategy.disabled',
  
  // Événements de risque
  RISK_WARNING = 'risk.warning',
  RISK_LIMIT_EXCEEDED = 'risk.limit_exceeded',
  
  // Événements système
  SYSTEM_STARTED = 'system.started',
  SYSTEM_STOPPED = 'system.stopped',
  SYSTEM_ERROR = 'system.error',
}

// Types de patterns harmoniques
export enum HarmonicPatternType {
  GARTLEY = 'gartley',
  BUTTERFLY = 'butterfly',
  BAT = 'bat',
  CRAB = 'crab',
  CYPHER = 'cypher',
  SHARK = 'shark',
}

// Types de vagues Elliott
export enum ElliottWaveType {
  IMPULSE_1 = 'impulse_1',
  IMPULSE_3 = 'impulse_3',
  IMPULSE_5 = 'impulse_5',
  CORRECTION_2 = 'correction_2',
  CORRECTION_4 = 'correction_4',
  CORRECTION_A = 'correction_a',
  CORRECTION_B = 'correction_b',
  CORRECTION_C = 'correction_c',
}

// Types de divergences RSI
export enum RSIDivergenceType {
  BULLISH_REGULAR = 'bullish_regular',
  BULLISH_HIDDEN = 'bullish_hidden',
  BEARISH_REGULAR = 'bearish_regular',
  BEARISH_HIDDEN = 'bearish_hidden',
}

// Types d'analyse de volume
export enum VolumeAnalysisType {
  ACCUMULATION = 'accumulation',
  DISTRIBUTION = 'distribution',
  BREAKOUT = 'breakout',
  CLIMAX = 'climax',
}

// Types de résolution de conflits entre stratégies
export enum ConflictResolutionMode {
  PERFORMANCE_WEIGHTED = 'performance_weighted',
  RISK_ADJUSTED = 'risk_adjusted',
  CONSENSUS = 'consensus',
}

// Niveaux de risque
export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

// Types de supervision d'acteurs
export enum SupervisorStrategy {
  RESUME = 'resume',
  RESTART = 'restart',
  STOP = 'stop',
  ESCALATE = 'escalate',
}
