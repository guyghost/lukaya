/**
 * Configuration par défaut centralisée pour Lukaya Trading Bot
 * Ces valeurs serviront de fallback quand les valeurs ne sont pas définies ailleurs
 */

// Valeurs par défaut pour la configuration de trading
export const DEFAULT_TRADING_CONFIG = {
  // Symboles et tailles
  defaultSymbols: ['BTC-USD'],
  defaultPositionSize: 0.01,
  maxLeverage: 2,
  
  // Intervalles et performance
  pollInterval: 5000, // ms
  positionAnalysisInterval: 300000, // ms - 5 minutes
  
  // Gestion des risques
  maxSlippagePercent: 1.0,
  minLiquidityRatio: 10.0,
  riskPerTrade: 0.01, // 1% du capital
  stopLossPercent: 0.02, // 2% de stop loss
  defaultAccountSize: 10000, // taille du compte par défaut
  maxCapitalPerTrade: 0.25, // max 25% du capital par trade
  maxFundsPerOrder: 0.25, // max 25% des fonds disponibles par ordre
  
  // Paramètres des ordres
  limitOrderBuffer: 0.0005, // 0.05% buffer pour les ordres limite
  useLimitOrders: false, // FORCER les ordres MARKET pour éviter les erreurs DYDX
};

// Valeurs par défaut pour la configuration du système d'acteurs
export const DEFAULT_ACTORS_CONFIG = {
  // Gestionnaire de risques
  riskManager: {
    maxOpenPositions: 3,
    maxDrawdownPercent: 20,
    dailyLossLimit: 5, // 5% max de perte par jour
    tradingPauseMinutes: 60, // Pause de 1h après atteinte de la limite
  },
  
  // Gestionnaire de stratégies
  strategyManager: {
    autoAdjustWeights: true,
    maxActiveStrategies: 4,
    conflictResolutionMode: 'performance_weighted' as 'performance_weighted' | 'risk_adjusted' | 'consensus', // Change to valid value
    optimizationEnabled: true,
    optimizationInterval: 86400000, // 24h
  },
  
  // Tracker de performance
  performanceTracker: {
    historyLength: 100, // Nombre de trades à conserver dans l'historique
    trackOpenPositions: true,
    realTimeUpdates: true,
    calculationInterval: 300000, // 5 minutes
  },
  
  // Gestionnaire de take profit
  takeProfitManager: {
    enabled: true,
    checkInterval: 30000, // 30s
  }
};

// Valeurs par défaut pour les règles de Take Profit
export const DEFAULT_TAKE_PROFIT_CONFIG = {
  enabled: process.env.TAKE_PROFIT_RULE_ENABLED === 'true',
  profitTiers: [
    { profitPercentage: 3, closePercentage: 30 }, // À 3% de profit, ferme 30% de la position
    { profitPercentage: 5, closePercentage: 30 }, // À 5% de profit, ferme 30% de la position
    { profitPercentage: 10, closePercentage: 40 } // À 10% de profit, ferme les 40% restants
  ],
  cooldownPeriod: 10 * 60 * 1000, // 10 minutes de cooldown entre les take profits
  trailingMode: false // Mode trailing stop pour les take profits
};

// Valeurs par défaut pour la configuration de logging
export const DEFAULT_LOGGING_CONFIG = {
  level: "info" as "debug" | "info" | "warn" | "error",
  fileOutput: false,
  logFilePath: './logs/lukaya.log',
  maxFileSize: 10 * 1024 * 1024, // 10 MB
  maxFiles: 5
};

// Valeurs par défaut pour la configuration des stratégies
export const DEFAULT_STRATEGY_CONFIGS = {
  'rsi-divergence': {
    rsiPeriod: 8,
    divergenceWindow: 5,
    overboughtLevel: 70,
    oversoldLevel: 30,
    positionSize: 0.015,
    maxSlippagePercent: 1.0,
    minLiquidityRatio: 10.0,
    riskPerTrade: 0.01,
    stopLossPercent: 0.02,
    accountSize: 10000,
    maxCapitalPerTrade: 0.25,
    limitOrderBuffer: 0.0005,
    useLimitOrders: false,
  },
  'volume-analysis': {
    volumeThreshold: 1.5,
    volumeMALength: 20,
    priceMALength: 10,
    positionSize: 0.015,
    volumeSpikeFactor: 2.5,
    priceSensitivity: 0.01,
    maxSlippagePercent: 1.0,
    minLiquidityRatio: 10.0,
    riskPerTrade: 0.01,
    stopLossPercent: 0.02,
    accountSize: 10000,
    maxCapitalPerTrade: 0.25,
    limitOrderBuffer: 0.0005,
    useLimitOrders: false,
  },
  'elliott-wave': {
    waveDetectionLength: 15,
    priceSensitivity: 3,
    positionSize: 0.015,
    zerolineBufferPercent: 0.5,
    maxSlippagePercent: 1.0,
    minLiquidityRatio: 10.0,
    riskPerTrade: 0.01,
    stopLossPercent: 0.02,
    accountSize: 10000,
    maxCapitalPerTrade: 0.25,
    limitOrderBuffer: 0.0005,
    useLimitOrders: false,
  },
  'harmonic-pattern': {
    detectionLength: 20,
    fibRetracementTolerance: 0.03,
    positionSize: 0.015,
    patternConfirmationPercentage: 90,
    maxSlippagePercent: 1.0,
    minLiquidityRatio: 10.0,
    riskPerTrade: 0.01,
    stopLossPercent: 0.02,
    accountSize: 10000,
    maxCapitalPerTrade: 0.25,
    limitOrderBuffer: 0.0005,
    useLimitOrders: false,
  }
};
