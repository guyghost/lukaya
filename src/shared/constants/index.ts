/**
 * Constantes centralisées pour Lukaya Trading Bot
 */

// Constantes de trading
export const TRADING_CONSTANTS = {
  // Tailles par défaut
  DEFAULT_POSITION_SIZE: 0.015,
  MIN_POSITION_SIZE: 0.001,
  MAX_POSITION_SIZE: 1.0,
  
  // Gestion du risque
  DEFAULT_RISK_PER_TRADE: 0.01,
  MAX_RISK_PER_TRADE: 0.05,
  DEFAULT_STOP_LOSS_PERCENT: 0.02,
  DEFAULT_LEVERAGE: 2,
  MAX_LEVERAGE: 10,
  
  // Liquidité et slippage
  DEFAULT_SLIPPAGE_PERCENT: 1.0,
  MAX_SLIPPAGE_PERCENT: 5.0,
  MIN_LIQUIDITY_RATIO: 5.0,
  
  // Intervalles de mise à jour
  MARKET_DATA_INTERVAL: 1000,
  POSITION_CHECK_INTERVAL: 30000,
  RISK_ASSESSMENT_INTERVAL: 60000,
  
  // Compte par défaut
  DEFAULT_ACCOUNT_SIZE: 10000,
  MAX_CAPITAL_PER_TRADE: 0.25,
} as const;

// Constantes de stratégies
export const STRATEGY_CONSTANTS = {
  // RSI Divergence
  RSI: {
    DEFAULT_PERIOD: 14,
    OVERBOUGHT_LEVEL: 70,
    OVERSOLD_LEVEL: 30,
    DIVERGENCE_LOOKBACK: 20,
  },
  
  // Volume Analysis
  VOLUME: {
    MA_PERIOD: 20,
    SPIKE_THRESHOLD: 2.0,
    ACCUMULATION_THRESHOLD: 1.5,
  },
  
  // Elliott Wave
  ELLIOTT: {
    MIN_WAVE_LENGTH: 5,
    MAX_WAVE_LENGTH: 50,
    FIBONACCI_LEVELS: [0.236, 0.382, 0.5, 0.618, 0.786],
  },
  
  // Harmonic Patterns
  HARMONIC: {
    GARTLEY_RATIOS: { XA: 0.618, AB: 0.382, BC: 0.886, CD: 1.272 },
    BUTTERFLY_RATIOS: { XA: 0.786, AB: 0.382, BC: 0.886, CD: 1.618 },
    BAT_RATIOS: { XA: 0.382, AB: 0.382, BC: 0.886, CD: 2.618 },
    CRAB_RATIOS: { XA: 0.382, AB: 0.382, BC: 0.886, CD: 3.618 },
    TOLERANCE: 0.03,
  },
} as const;

// Constantes de prise de profit (règle 3-5-7)
export const TAKE_PROFIT_CONSTANTS = {
  PROFIT_LEVELS: [
    { profitPercentage: 3, closePercentage: 30 },
    { profitPercentage: 5, closePercentage: 50 },
    { profitPercentage: 7, closePercentage: 100 },
  ],
  COOLDOWN_PERIOD: 10 * 60 * 1000, // 10 minutes
  TRAILING_STOP_ACTIVATION: 0.05, // 5%
} as const;

// Constantes d'acteurs
export const ACTOR_CONSTANTS = {
  // Timeouts
  MESSAGE_TIMEOUT: 5000,
  ACTOR_RESTART_DELAY: 1000,
  SUPERVISOR_ESCALATION_TIMEOUT: 30000,
  
  // Limites
  MAX_MAILBOX_SIZE: 1000,
  MAX_ACTOR_CHILDREN: 100,
  MAX_RESTART_ATTEMPTS: 3,
  
  // Intervalles
  HEARTBEAT_INTERVAL: 30000,
  HEALTH_CHECK_INTERVAL: 60000,
} as const;

// Constantes de performance
export const PERFORMANCE_CONSTANTS = {
  HISTORY_LENGTH: 1000,
  METRICS_CALCULATION_INTERVAL: 60000,
  REPORT_GENERATION_INTERVAL: 24 * 60 * 60 * 1000, // 24h
  MAX_TRADE_HISTORY: 10000,
} as const;

// Constantes de réseau
export const NETWORK_CONSTANTS = {
  DEFAULT_TIMEOUT: 10000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  BACKOFF_MULTIPLIER: 2,
} as const;

// Messages d'erreur standardisés
export const ERROR_MESSAGES = {
  INVALID_CONFIGURATION: 'Configuration invalide',
  ACTOR_NOT_FOUND: 'Acteur non trouvé',
  STRATEGY_NOT_FOUND: 'Stratégie non trouvée',
  INSUFFICIENT_BALANCE: 'Solde insuffisant',
  MARKET_CLOSED: 'Marché fermé',
  RISK_LIMIT_EXCEEDED: 'Limite de risque dépassée',
  POSITION_SIZE_INVALID: 'Taille de position invalide',
  SYMBOL_NOT_SUPPORTED: 'Symbole non supporté',
} as const;
