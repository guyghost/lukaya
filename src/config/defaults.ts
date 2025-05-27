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
  
  // Intervalles et performance - ULTRA-OPTIMISÉ POUR MICRO-VARIATIONS
  pollInterval: 1000, // ms - Réduit de 1500 à 1000 pour une réactivité maximale aux micro-variations
  positionAnalysisInterval: 90000, // ms - Réduit de 2 minutes à 1.5 minutes
  
  // Gestion des risques - HYPER-AJUSTÉE POUR MICRO-TRADING
  maxSlippagePercent: 0.3, // Réduit de 0.5 à 0.3 pour limiter encore plus le slippage
  minLiquidityRatio: 6.0, // Réduit de 8.0 à 6.0 pour plus d'opportunités
  riskPerTrade: 0.003, // Réduit de 0.5% à 0.3% pour des micro-positions plus fréquentes
  stopLossPercent: 0.01, // Réduit de 1.5% à 1% pour un stop loss très serré
  defaultAccountSize: 10000, // taille du compte par défaut
  maxCapitalPerTrade: 0.10, // Réduit de 15% à 10% pour plus de diversification
  maxFundsPerOrder: 0.10, // Réduit de 15% à 10% pour plus de positions simultanées
  
  // Paramètres des ordres - HYPER-OPTIMISÉ POUR LA RAPIDITÉ
  limitOrderBuffer: 0.0001, // Réduit de 0.02% à 0.01% pour des ordres ultra-agressifs
  useLimitOrders: false, // FORCER les ordres MARKET pour éviter les erreurs DYDX
};

// Valeurs par défaut pour la configuration du système d'acteurs
export const DEFAULT_ACTORS_CONFIG = {
  // Gestionnaire de risques
  riskManager: {
    maxOpenPositions: 5, // Augmenté de 3 à 5 pour plus d'opportunités simultanées
    maxDrawdownPercent: 15, // Réduit de 20 à 15 pour une protection accrue
    dailyLossLimit: 3, // Réduit de 5% à 3% max de perte par jour
    tradingPauseMinutes: 30, // Réduit de 1h à 30min pour reprendre plus vite
  },
  
  // Gestionnaire de stratégies
  strategyManager: {
    autoAdjustWeights: true,
    maxActiveStrategies: 4,
    conflictResolutionMode: 'performance_weighted' as 'performance_weighted' | 'risk_adjusted' | 'consensus', // Change to valid value
    optimizationEnabled: true,
    optimizationInterval: 86400000, // 24h
  },
  
  // Tracker de performance - TEMPS RÉEL
  performanceTracker: {
    historyLength: 150, // Augmenté de 100 à 150 pour plus d'historique de micro-trades
    trackOpenPositions: true,
    realTimeUpdates: true,
    calculationInterval: 180000, // 3 minutes - Réduit de 5min pour plus de réactivité
  },
  
  // Gestionnaire de take profit - HYPER-RÉACTIF
  takeProfitManager: {
    enabled: true,
    checkInterval: 15000, // 15s - Réduit de 30s pour plus de réactivité
  }
};

// Valeurs par défaut pour les règles de Take Profit - OPTIMISÉ POUR MICRO-VARIATIONS
export const DEFAULT_TAKE_PROFIT_CONFIG = {
  enabled: process.env.TAKE_PROFIT_RULE_ENABLED === 'true',
  profitTiers: [
    { profitPercentage: 1.5, closePercentage: 25 }, // À 1.5% de profit, ferme 25% de la position
    { profitPercentage: 2.5, closePercentage: 35 }, // À 2.5% de profit, ferme 35% de la position
    { profitPercentage: 4, closePercentage: 40 } // À 4% de profit, ferme les 40% restants
  ],
  cooldownPeriod: 5 * 60 * 1000, // 5 minutes de cooldown entre les take profits (réduit de 10min)
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

// Valeurs par défaut pour la configuration des stratégies - HYPER-OPTIMISÉ POUR MICRO-VARIATIONS
export const DEFAULT_STRATEGY_CONFIGS = {
  'rsi-divergence': {
    rsiPeriod: 5, // Réduit de 6 à 5 pour une réactivité maximale aux changements
    divergenceWindow: 2, // Réduit de 3 à 2 pour détecter les divergences instantanément
    overboughtLevel: 65, // Réduit de 68 à 65 pour des signaux ultra-précoces
    oversoldLevel: 35, // Augmenté de 32 à 35 pour des signaux ultra-précoces
    positionSize: 0.006, // Réduit pour permettre encore plus de positions simultanées
    maxSlippagePercent: 0.3,
    minLiquidityRatio: 6.0,
    riskPerTrade: 0.003,
    stopLossPercent: 0.01,
    accountSize: 10000,
    maxCapitalPerTrade: 0.10,
    limitOrderBuffer: 0.0001,
    useLimitOrders: false,
  },
  'volume-analysis': {
    volumeThreshold: 1.1, // Réduit de 1.2 à 1.1 pour détecter des variations de volume encore plus subtiles
    volumeMALength: 12, // Réduit de 15 à 12 pour une moyenne mobile ultra-réactive
    priceMALength: 6, // Réduit de 8 à 6 pour une réactivité maximale
    positionSize: 0.006,
    volumeSpikeFactor: 1.8, // Réduit de 2.0 à 1.8 pour détecter des micro-pics
    priceSensitivity: 0.003, // Réduit de 0.005 à 0.003 pour une hyper-sensibilité (40% plus sensible)
    maxSlippagePercent: 0.3,
    minLiquidityRatio: 6.0,
    riskPerTrade: 0.003,
    stopLossPercent: 0.01,
    accountSize: 10000,
    maxCapitalPerTrade: 0.10,
    limitOrderBuffer: 0.0001,
    useLimitOrders: false,
  },
  'elliott-wave': {
    waveDetectionLength: 10, // Réduit de 12 à 10 pour détecter des micro-vagues
    priceSensitivity: 1.5, // Réduit de 2 à 1.5 pour une sensibilité maximale aux micro-mouvements
    positionSize: 0.006,
    zerolineBufferPercent: 0.2, // Réduit de 0.3 à 0.2 pour des signaux instantanés
    maxSlippagePercent: 0.3,
    minLiquidityRatio: 6.0,
    riskPerTrade: 0.003,
    stopLossPercent: 0.01,
    accountSize: 10000,
    maxCapitalPerTrade: 0.10,
    limitOrderBuffer: 0.0001,
    useLimitOrders: false,
  },
  'harmonic-pattern': {
    detectionLength: 12, // Réduit de 15 à 12 pour détecter des micro-patterns
    fibRetracementTolerance: 0.015, // Réduit de 0.02 à 0.015 pour des patterns ultra-stricts
    positionSize: 0.006,
    patternConfirmationPercentage: 80, // Réduit de 85 à 80 pour plus d'opportunités
    maxSlippagePercent: 0.3,
    minLiquidityRatio: 6.0,
    riskPerTrade: 0.003,
    stopLossPercent: 0.01,
    accountSize: 10000,
    maxCapitalPerTrade: 0.10,
    limitOrderBuffer: 0.0001,
    useLimitOrders: false,
  }
};
