/**
 * Configuration centralisée et améliorée pour Lukaya Trading Bot
 */

import { z } from "zod";
import { Network } from "@dydxprotocol/v4-client-js";
import { TRADING_CONSTANTS, STRATEGY_CONSTANTS, TAKE_PROFIT_CONSTANTS } from "../../shared/constants";
import { LogLevel } from "../../shared/types";
import { 
  DEFAULT_TRADING_CONFIG, 
  DEFAULT_ACTORS_CONFIG, 
  DEFAULT_TAKE_PROFIT_CONFIG, 
  DEFAULT_LOGGING_CONFIG,
  DEFAULT_STRATEGY_CONFIGS
} from "../../config/defaults";

// Schema de validation pour les stratégies
const strategyConfigSchema = z.object({
  type: z.enum(['rsi-div', 'rsi-divergence', 'volume-analysis', 'elliott-wave', 'harmonic-pattern']), // Added rsi-div, kept rsi-divergence for backwards compatibility
  enabled: z.boolean().default(true),
  weight: z.number().min(0).max(1).default(0.25),
  parameters: z.record(z.unknown()).default({}),
});

// Schema de validation pour la configuration de trading
const tradingConfigSchema = z.object({
  // Symboles et positions
  defaultSymbols: z.array(z.string()).default(DEFAULT_TRADING_CONFIG.defaultSymbols),
  defaultPositionSize: z.number()
    .min(TRADING_CONSTANTS.MIN_POSITION_SIZE)
    .max(TRADING_CONSTANTS.MAX_POSITION_SIZE)
    .default(DEFAULT_TRADING_CONFIG.defaultPositionSize),
  
  // Gestion du risque
  riskPerTrade: z.number()
    .min(0)
    .max(TRADING_CONSTANTS.MAX_RISK_PER_TRADE)
    .default(DEFAULT_TRADING_CONFIG.riskPerTrade),
  stopLossPercent: z.number()
    .min(0)
    .max(0.1)
    .default(DEFAULT_TRADING_CONFIG.stopLossPercent),
  maxLeverage: z.number()
    .min(1)
    .max(TRADING_CONSTANTS.MAX_LEVERAGE)
    .default(DEFAULT_TRADING_CONFIG.maxLeverage),
  
  // Tailles et limites
  defaultAccountSize: z.number()
    .positive()
    .default(DEFAULT_TRADING_CONFIG.defaultAccountSize),
  maxCapitalPerTrade: z.number()
    .min(0)
    .max(1)
    .default(DEFAULT_TRADING_CONFIG.maxCapitalPerTrade),
  maxFundsPerOrder: z.number()
    .min(0)
    .max(1)
    .default(DEFAULT_TRADING_CONFIG.maxFundsPerOrder),
  
  // Liquidité et slippage
  maxSlippagePercent: z.number()
    .min(0)
    .max(TRADING_CONSTANTS.MAX_SLIPPAGE_PERCENT)
    .default(DEFAULT_TRADING_CONFIG.maxSlippagePercent),
  minLiquidityRatio: z.number()
    .positive()
    .default(DEFAULT_TRADING_CONFIG.minLiquidityRatio),
  
  // Intervalles et timing
  pollInterval: z.number()
    .positive()
    .default(DEFAULT_TRADING_CONFIG.pollInterval),
  positionAnalysisInterval: z.number()
    .positive()
    .default(DEFAULT_TRADING_CONFIG.positionAnalysisInterval),
  
  // Ordres
  limitOrderBuffer: z.number()
    .min(0)
    .max(0.01)
    .default(0.0005),
  useLimitOrders: z.boolean().default(false), // Toujours utiliser des ordres market pour dYdX
});

// Schema de validation pour dYdX
const dydxConfigSchema = z.object({
  mnemonic: z.string().optional(),
  defaultSubaccountNumber: z.number().min(0).default(0),
});

// Schema de validation pour le logging
const loggingConfigSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"] as const).default(DEFAULT_LOGGING_CONFIG.level),
  fileOutput: z.boolean().default(DEFAULT_LOGGING_CONFIG.fileOutput),
  logFilePath: z.string().optional().default(DEFAULT_LOGGING_CONFIG.logFilePath),
  maxFileSize: z.number().positive().default(DEFAULT_LOGGING_CONFIG.maxFileSize),
  maxFiles: z.number().positive().default(DEFAULT_LOGGING_CONFIG.maxFiles),
});

// Schema de validation pour la prise de profit
const takeProfitConfigSchema = z.object({
  enabled: z.boolean().default(DEFAULT_TAKE_PROFIT_CONFIG.enabled),
  profitTiers: z.array(z.object({
    profitPercentage: z.number().positive(),
    closePercentage: z.number().min(0).max(100),
  })).default(DEFAULT_TAKE_PROFIT_CONFIG.profitTiers),
  cooldownPeriod: z.number().positive().default(DEFAULT_TAKE_PROFIT_CONFIG.cooldownPeriod),
  trailingMode: z.boolean().default(DEFAULT_TAKE_PROFIT_CONFIG.trailingMode),
  trailingStopActivation: z.number().positive().default(TAKE_PROFIT_CONSTANTS.TRAILING_STOP_ACTIVATION),
});

// Schema de validation pour les acteurs
const actorsConfigSchema = z.object({
  riskManager: z.object({
    maxOpenPositions: z.number().positive().default(DEFAULT_ACTORS_CONFIG.riskManager.maxOpenPositions),
    maxDailyLoss: z.number().positive().default(DEFAULT_ACTORS_CONFIG.riskManager.dailyLossLimit / 100), // Convertir de % à décimal
    diversificationWeight: z.number().min(0).max(1).default(0.3),
    volatilityAdjustment: z.boolean().default(true),
  }).default({}),
  
  strategyManager: z.object({
    autoAdjustWeights: z.boolean().default(DEFAULT_ACTORS_CONFIG.strategyManager.autoAdjustWeights),
    maxActiveStrategies: z.number().positive().default(DEFAULT_ACTORS_CONFIG.strategyManager.maxActiveStrategies),
    conflictResolutionMode: z.enum(['performance_weighted', 'risk_adjusted', 'consensus']).default('performance_weighted'),
    optimizationEnabled: z.boolean().default(DEFAULT_ACTORS_CONFIG.strategyManager.optimizationEnabled),
  }).default({}),
  
  performanceTracker: z.object({
    historyLength: z.number().positive().default(DEFAULT_ACTORS_CONFIG.performanceTracker.historyLength),
    trackOpenPositions: z.boolean().default(DEFAULT_ACTORS_CONFIG.performanceTracker.trackOpenPositions),
    realTimeUpdates: z.boolean().default(DEFAULT_ACTORS_CONFIG.performanceTracker.realTimeUpdates),
    calculationInterval: z.number().positive().default(DEFAULT_ACTORS_CONFIG.performanceTracker.calculationInterval),
  }).default({}),
});

// Schema principal de configuration
const configSchema = z.object({
  network: z.enum(["mainnet", "testnet"]).default("testnet"),
  dydx: dydxConfigSchema.default({}),
  trading: tradingConfigSchema.default({}),
  strategies: z.array(strategyConfigSchema).default([]),
  takeProfit: takeProfitConfigSchema.default({}),
  actors: actorsConfigSchema.default({}),
  logging: loggingConfigSchema.default({}),
});

export type ConfigType = z.infer<typeof configSchema>;
export type TradingConfig = z.infer<typeof tradingConfigSchema>;
export type StrategyConfig = z.infer<typeof strategyConfigSchema>;
export type LoggingConfig = z.infer<typeof loggingConfigSchema>;
export type TakeProfitConfig = z.infer<typeof takeProfitConfigSchema>;

/**
 * Charge la configuration depuis les variables d'environnement
 */
export const loadConfig = (): ConfigType => {
  const symbols = (process.env.DEFAULT_SYMBOLS || "BTC-USD,ETH-USD,SOL-USD,LTC-USD")
    .split(",")
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const rawConfig = {
    network: process.env.DYDX_NETWORK || "testnet",
    dydx: {
      mnemonic: process.env.DYDX_MNEMONIC,
      defaultSubaccountNumber: Number(process.env.DYDX_SUBACCOUNT || 0),
    },
    trading: {
      defaultSymbols: symbols,
      defaultPositionSize: Number(process.env.DEFAULT_POSITION_SIZE || DEFAULT_TRADING_CONFIG.defaultPositionSize),
      riskPerTrade: Number(process.env.RISK_PER_TRADE || DEFAULT_TRADING_CONFIG.riskPerTrade),
      stopLossPercent: Number(process.env.STOP_LOSS_PERCENT || DEFAULT_TRADING_CONFIG.stopLossPercent),
      maxLeverage: Number(process.env.MAX_LEVERAGE || DEFAULT_TRADING_CONFIG.maxLeverage),
      defaultAccountSize: Number(process.env.DEFAULT_ACCOUNT_SIZE || DEFAULT_TRADING_CONFIG.defaultAccountSize),
      maxCapitalPerTrade: Number(process.env.MAX_CAPITAL_PER_TRADE || DEFAULT_TRADING_CONFIG.maxCapitalPerTrade),
      maxFundsPerOrder: Number(process.env.MAX_FUNDS_PER_ORDER || DEFAULT_TRADING_CONFIG.maxFundsPerOrder),
      maxSlippagePercent: Number(process.env.MAX_SLIPPAGE_PERCENT || DEFAULT_TRADING_CONFIG.maxSlippagePercent),
      minLiquidityRatio: Number(process.env.MIN_LIQUIDITY_RATIO || DEFAULT_TRADING_CONFIG.minLiquidityRatio),
      pollInterval: Number(process.env.POLL_INTERVAL || DEFAULT_TRADING_CONFIG.pollInterval),
      positionAnalysisInterval: Number(process.env.POSITION_ANALYSIS_INTERVAL || DEFAULT_TRADING_CONFIG.positionAnalysisInterval),
      limitOrderBuffer: Number(process.env.LIMIT_ORDER_BUFFER || DEFAULT_TRADING_CONFIG.limitOrderBuffer),
      useLimitOrders: process.env.USE_LIMIT_ORDERS === 'true' ? true : DEFAULT_TRADING_CONFIG.useLimitOrders,
    },
    strategies: symbols.map(symbol => [
      {
        type: "rsi-div" as const,
        enabled: process.env.RSI_DIVERGENCE_ENABLED !== 'false',
        weight: Number(process.env.RSI_DIVERGENCE_WEIGHT || 0.25),
        parameters: {
          rsiPeriod: Number(process.env.RSI_PERIOD || DEFAULT_STRATEGY_CONFIGS["rsi-divergence"].rsiPeriod),
          overboughtLevel: Number(process.env.RSI_OVERBOUGHT || DEFAULT_STRATEGY_CONFIGS["rsi-divergence"].overboughtLevel),
          oversoldLevel: Number(process.env.RSI_OVERSOLD || DEFAULT_STRATEGY_CONFIGS["rsi-divergence"].oversoldLevel),
          divergenceWindow: Number(process.env.RSI_DIVERGENCE_LOOKBACK || DEFAULT_STRATEGY_CONFIGS["rsi-divergence"].divergenceWindow),
          symbol: symbol.trim(),
          positionSize: Number(process.env.RSI_POSITION_SIZE || DEFAULT_STRATEGY_CONFIGS["rsi-divergence"].positionSize),
        },
      },
      {
        type: "volume-analysis" as const,
        enabled: process.env.VOLUME_ANALYSIS_ENABLED !== 'false',
        weight: Number(process.env.VOLUME_ANALYSIS_WEIGHT || 0.25),
        parameters: {
          volumeMALength: Number(process.env.VOLUME_MA_PERIOD || DEFAULT_STRATEGY_CONFIGS["volume-analysis"].volumeMALength),
          volumeThreshold: Number(process.env.VOLUME_SPIKE_THRESHOLD || DEFAULT_STRATEGY_CONFIGS["volume-analysis"].volumeThreshold),
          priceMALength: Number(process.env.PRICE_MA_LENGTH || DEFAULT_STRATEGY_CONFIGS["volume-analysis"].priceMALength),
          volumeSpikeFactor: Number(process.env.VOLUME_SPIKE_FACTOR || DEFAULT_STRATEGY_CONFIGS["volume-analysis"].volumeSpikeFactor),
          priceSensitivity: Number(process.env.PRICE_SENSITIVITY || DEFAULT_STRATEGY_CONFIGS["volume-analysis"].priceSensitivity),
          symbol: symbol.trim(),
          positionSize: Number(process.env.VOLUME_POSITION_SIZE || DEFAULT_STRATEGY_CONFIGS["volume-analysis"].positionSize),
        },
      },
      {
        type: "elliott-wave" as const,
        enabled: process.env.ELLIOTT_WAVE_ENABLED !== 'false',
        weight: Number(process.env.ELLIOTT_WAVE_WEIGHT || 0.25),
        parameters: {
          waveDetectionLength: Number(process.env.ELLIOTT_MIN_WAVE_LENGTH || DEFAULT_STRATEGY_CONFIGS["elliott-wave"].waveDetectionLength),
          priceSensitivity: Number(process.env.ELLIOTT_PRICE_SENSITIVITY || DEFAULT_STRATEGY_CONFIGS["elliott-wave"].priceSensitivity),
          zerolineBufferPercent: Number(process.env.ELLIOTT_ZEROLINE_BUFFER || DEFAULT_STRATEGY_CONFIGS["elliott-wave"].zerolineBufferPercent),
          symbol: symbol.trim(),
          positionSize: Number(process.env.ELLIOTT_POSITION_SIZE || DEFAULT_STRATEGY_CONFIGS["elliott-wave"].positionSize),
        },
      },
      {
        type: "harmonic-pattern" as const,
        enabled: process.env.HARMONIC_PATTERN_ENABLED !== 'false',
        weight: Number(process.env.HARMONIC_PATTERN_WEIGHT || 0.25),
        parameters: {
          detectionLength: Number(process.env.PATTERN_DETECTION_LENGTH || DEFAULT_STRATEGY_CONFIGS["harmonic-pattern"].detectionLength),
          fibRetracementTolerance: Number(process.env.FIB_RETRACEMENT_TOLERANCE || DEFAULT_STRATEGY_CONFIGS["harmonic-pattern"].fibRetracementTolerance),
          patternConfirmationPercentage: Number(process.env.PATTERN_CONFIRMATION_PCT || DEFAULT_STRATEGY_CONFIGS["harmonic-pattern"].patternConfirmationPercentage),
          symbol: symbol.trim(),
          positionSize: Number(process.env.HARMONIC_POSITION_SIZE || DEFAULT_STRATEGY_CONFIGS["harmonic-pattern"].positionSize),
        },
      },
    ]).flat(),
    takeProfit: {
      enabled: process.env.TAKE_PROFIT_ENABLED !== 'false' ? true : DEFAULT_TAKE_PROFIT_CONFIG.enabled,
      profitTiers: [
        {
          profitPercentage: Number(process.env.TAKE_PROFIT_LEVEL_1 || DEFAULT_TAKE_PROFIT_CONFIG.profitTiers[0].profitPercentage),
          closePercentage: Number(process.env.TAKE_PROFIT_SIZE_1 || DEFAULT_TAKE_PROFIT_CONFIG.profitTiers[0].closePercentage),
        },
        {
          profitPercentage: Number(process.env.TAKE_PROFIT_LEVEL_2 || DEFAULT_TAKE_PROFIT_CONFIG.profitTiers[1].profitPercentage),
          closePercentage: Number(process.env.TAKE_PROFIT_SIZE_2 || DEFAULT_TAKE_PROFIT_CONFIG.profitTiers[1].closePercentage),
        },
        {
          profitPercentage: Number(process.env.TAKE_PROFIT_LEVEL_3 || DEFAULT_TAKE_PROFIT_CONFIG.profitTiers[2].profitPercentage),
          closePercentage: Number(process.env.TAKE_PROFIT_SIZE_3 || DEFAULT_TAKE_PROFIT_CONFIG.profitTiers[2].closePercentage),
        },
      ],
      cooldownPeriod: Number(process.env.TAKE_PROFIT_COOLDOWN || DEFAULT_TAKE_PROFIT_CONFIG.cooldownPeriod),
      trailingMode: process.env.TAKE_PROFIT_TRAILING === 'true' ? true : DEFAULT_TAKE_PROFIT_CONFIG.trailingMode,
    },
    actors: {
      riskManager: {
        maxOpenPositions: Number(process.env.MAX_OPEN_POSITIONS || DEFAULT_ACTORS_CONFIG.riskManager.maxOpenPositions),
        maxDailyLoss: Number(process.env.MAX_DAILY_LOSS || DEFAULT_ACTORS_CONFIG.riskManager.dailyLossLimit / 100),
        diversificationWeight: Number(process.env.DIVERSIFICATION_WEIGHT || 0.3),
        volatilityAdjustment: process.env.VOLATILITY_ADJUSTMENT !== 'false',
      },
      strategyManager: {
        autoAdjustWeights: process.env.AUTO_ADJUST_WEIGHTS !== 'false' ? true : DEFAULT_ACTORS_CONFIG.strategyManager.autoAdjustWeights,
        maxActiveStrategies: Number(process.env.MAX_ACTIVE_STRATEGIES || DEFAULT_ACTORS_CONFIG.strategyManager.maxActiveStrategies),
        conflictResolutionMode: (process.env.CONFLICT_RESOLUTION_MODE || DEFAULT_ACTORS_CONFIG.strategyManager.conflictResolutionMode) as any,
        optimizationEnabled: process.env.OPTIMIZATION_ENABLED !== 'false' ? true : DEFAULT_ACTORS_CONFIG.strategyManager.optimizationEnabled,
      },
      performanceTracker: {
        historyLength: Number(process.env.PERFORMANCE_HISTORY_LENGTH || DEFAULT_ACTORS_CONFIG.performanceTracker.historyLength),
        trackOpenPositions: process.env.TRACK_OPEN_POSITIONS !== 'false' ? true : DEFAULT_ACTORS_CONFIG.performanceTracker.trackOpenPositions,
        realTimeUpdates: process.env.REAL_TIME_UPDATES !== 'false' ? true : DEFAULT_ACTORS_CONFIG.performanceTracker.realTimeUpdates,
        calculationInterval: Number(process.env.CALCULATION_INTERVAL || DEFAULT_ACTORS_CONFIG.performanceTracker.calculationInterval),
      },
    },
    logging: {
      level: (process.env.LOG_LEVEL || DEFAULT_LOGGING_CONFIG.level) as LogLevel,
      fileOutput: process.env.LOG_TO_FILE === "true" ? true : DEFAULT_LOGGING_CONFIG.fileOutput,
      logFilePath: process.env.LOG_FILE_PATH || DEFAULT_LOGGING_CONFIG.logFilePath,
      maxFileSize: Number(process.env.LOG_MAX_FILE_SIZE || DEFAULT_LOGGING_CONFIG.maxFileSize),
      maxFiles: Number(process.env.LOG_MAX_FILES || DEFAULT_LOGGING_CONFIG.maxFiles),
    },
  };

  try {
    const validatedConfig = configSchema.parse(rawConfig);
    return validatedConfig;
  } catch (error) {
    console.error("Erreur de validation de la configuration:", error);
    throw new Error(`Configuration invalide: ${error}`);
  }
};

/**
 * Convertit une chaîne de réseau en enum Network de dYdX
 */
export const getNetworkFromString = (networkString: string): Network => {
  switch (networkString.toLowerCase()) {
    case "mainnet":
      return Network.mainnet();
    case "testnet":
    default:
      return Network.testnet();
  }
};

/**
 * Valide une configuration partiellement chargée
 */
export const validateConfig = (config: Partial<ConfigType>): ConfigType => {
  return configSchema.parse(config);
};

/**
 * Fusionne une configuration partielle avec la configuration par défaut
 */
export const mergeConfig = (baseConfig: ConfigType, overrides: Partial<ConfigType>): ConfigType => {
  return configSchema.parse({ ...baseConfig, ...overrides });
};
