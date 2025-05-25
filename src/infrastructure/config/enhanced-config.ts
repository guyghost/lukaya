/**
 * Configuration centralisée et améliorée pour Lukaya Trading Bot
 */

import { z } from "zod";
import { Network } from "@dydxprotocol/v4-client-js";
import { TRADING_CONSTANTS, STRATEGY_CONSTANTS, TAKE_PROFIT_CONSTANTS } from "../../shared/constants";
import { LogLevel } from "../../shared/types";

// Schema de validation pour les stratégies
const strategyConfigSchema = z.object({
  type: z.enum(['rsi-divergence', 'volume-analysis', 'elliott-wave', 'harmonic-pattern', 'simple-ma']), // Ajout de 'simple-ma'
  enabled: z.boolean().default(true),
  weight: z.number().min(0).max(1).default(0.25),
  parameters: z.record(z.unknown()).default({}),
});

// Schema de validation pour la configuration de trading
const tradingConfigSchema = z.object({
  // Symboles et positions
  defaultSymbols: z.array(z.string()).default(["BTC-USD", "ETH-USD"]),
  defaultPositionSize: z.number()
    .min(TRADING_CONSTANTS.MIN_POSITION_SIZE)
    .max(TRADING_CONSTANTS.MAX_POSITION_SIZE)
    .default(TRADING_CONSTANTS.DEFAULT_POSITION_SIZE),
  
  // Gestion du risque
  riskPerTrade: z.number()
    .min(0)
    .max(TRADING_CONSTANTS.MAX_RISK_PER_TRADE)
    .default(TRADING_CONSTANTS.DEFAULT_RISK_PER_TRADE),
  stopLossPercent: z.number()
    .min(0)
    .max(0.1)
    .default(TRADING_CONSTANTS.DEFAULT_STOP_LOSS_PERCENT),
  maxLeverage: z.number()
    .min(1)
    .max(TRADING_CONSTANTS.MAX_LEVERAGE)
    .default(TRADING_CONSTANTS.DEFAULT_LEVERAGE),
  
  // Tailles et limites
  defaultAccountSize: z.number()
    .positive()
    .default(TRADING_CONSTANTS.DEFAULT_ACCOUNT_SIZE),
  maxCapitalPerTrade: z.number()
    .min(0)
    .max(1)
    .default(TRADING_CONSTANTS.MAX_CAPITAL_PER_TRADE),
  
  // Liquidité et slippage
  maxSlippagePercent: z.number()
    .min(0)
    .max(TRADING_CONSTANTS.MAX_SLIPPAGE_PERCENT)
    .default(TRADING_CONSTANTS.DEFAULT_SLIPPAGE_PERCENT),
  minLiquidityRatio: z.number()
    .positive()
    .default(TRADING_CONSTANTS.MIN_LIQUIDITY_RATIO),
  
  // Intervalles et timing
  pollInterval: z.number()
    .positive()
    .default(TRADING_CONSTANTS.MARKET_DATA_INTERVAL),
  positionAnalysisInterval: z.number()
    .positive()
    .default(TRADING_CONSTANTS.RISK_ASSESSMENT_INTERVAL),
  
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
  level: z.enum(["debug", "info", "warn", "error"] as const).default("info"),
  fileOutput: z.boolean().default(false),
  logFilePath: z.string().optional(),
  maxFileSize: z.number().positive().default(10 * 1024 * 1024), // 10MB
  maxFiles: z.number().positive().default(5),
});

// Schema de validation pour la prise de profit
const takeProfitConfigSchema = z.object({
  enabled: z.boolean().default(true),
  profitTiers: z.array(z.object({
    profitPercentage: z.number().positive(),
    closePercentage: z.number().min(0).max(100),
  })).default([...TAKE_PROFIT_CONSTANTS.PROFIT_LEVELS]),
  cooldownPeriod: z.number().positive().default(TAKE_PROFIT_CONSTANTS.COOLDOWN_PERIOD),
  trailingMode: z.boolean().default(false),
  trailingStopActivation: z.number().positive().default(TAKE_PROFIT_CONSTANTS.TRAILING_STOP_ACTIVATION),
});

// Schema de validation pour les acteurs
const actorsConfigSchema = z.object({
  riskManager: z.object({
    maxOpenPositions: z.number().positive().default(5),
    maxDailyLoss: z.number().positive().default(0.1), // 10% perte journalière max
    diversificationWeight: z.number().min(0).max(1).default(0.3),
    volatilityAdjustment: z.boolean().default(true),
  }).default({}),
  
  strategyManager: z.object({
    autoAdjustWeights: z.boolean().default(true),
    maxActiveStrategies: z.number().positive().default(4),
    conflictResolutionMode: z.enum(['performance_weighted', 'risk_adjusted', 'consensus']).default('performance_weighted'),
    optimizationEnabled: z.boolean().default(true),
  }).default({}),
  
  performanceTracker: z.object({
    historyLength: z.number().positive().default(1000),
    trackOpenPositions: z.boolean().default(true),
    realTimeUpdates: z.boolean().default(true),
    calculationInterval: z.number().positive().default(60000),
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
      defaultPositionSize: Number(process.env.DEFAULT_POSITION_SIZE || TRADING_CONSTANTS.DEFAULT_POSITION_SIZE),
      riskPerTrade: Number(process.env.RISK_PER_TRADE || TRADING_CONSTANTS.DEFAULT_RISK_PER_TRADE),
      stopLossPercent: Number(process.env.STOP_LOSS_PERCENT || TRADING_CONSTANTS.DEFAULT_STOP_LOSS_PERCENT),
      maxLeverage: Number(process.env.MAX_LEVERAGE || TRADING_CONSTANTS.DEFAULT_LEVERAGE),
      defaultAccountSize: Number(process.env.DEFAULT_ACCOUNT_SIZE || TRADING_CONSTANTS.DEFAULT_ACCOUNT_SIZE),
      maxCapitalPerTrade: Number(process.env.MAX_CAPITAL_PER_TRADE || TRADING_CONSTANTS.MAX_CAPITAL_PER_TRADE),
      maxSlippagePercent: Number(process.env.MAX_SLIPPAGE_PERCENT || TRADING_CONSTANTS.DEFAULT_SLIPPAGE_PERCENT),
      minLiquidityRatio: Number(process.env.MIN_LIQUIDITY_RATIO || TRADING_CONSTANTS.MIN_LIQUIDITY_RATIO),
      pollInterval: Number(process.env.POLL_INTERVAL || TRADING_CONSTANTS.MARKET_DATA_INTERVAL),
      positionAnalysisInterval: Number(process.env.POSITION_ANALYSIS_INTERVAL || TRADING_CONSTANTS.RISK_ASSESSMENT_INTERVAL),
      limitOrderBuffer: Number(process.env.LIMIT_ORDER_BUFFER || 0.0005),
      useLimitOrders: process.env.USE_LIMIT_ORDERS === 'true',
    },
    strategies: symbols.map(symbol => [
      {
        type: "rsi-divergence" as const,
        enabled: process.env.RSI_DIVERGENCE_ENABLED !== 'false',
        weight: Number(process.env.RSI_DIVERGENCE_WEIGHT || 0.25),
        parameters: {
          // Renommé 'period' en 'rsiPeriod' pour correspondre à RsiDivergenceConfig
          rsiPeriod: Number(process.env.RSI_PERIOD || STRATEGY_CONSTANTS.RSI.DEFAULT_PERIOD),
          overboughtLevel: Number(process.env.RSI_OVERBOUGHT || STRATEGY_CONSTANTS.RSI.OVERBOUGHT_LEVEL),
          oversoldLevel: Number(process.env.RSI_OVERSOLD || STRATEGY_CONSTANTS.RSI.OVERSOLD_LEVEL),
          // Renommé 'divergenceLookback' en 'divergenceWindow' pour correspondre à RsiDivergenceConfig
          divergenceWindow: Number(process.env.RSI_DIVERGENCE_LOOKBACK || STRATEGY_CONSTANTS.RSI.DIVERGENCE_LOOKBACK),
          symbol: symbol.trim(),
          positionSize: Number(process.env.RSI_POSITION_SIZE || TRADING_CONSTANTS.DEFAULT_POSITION_SIZE),
        },
      },
      {
        type: "volume-analysis" as const,
        enabled: process.env.VOLUME_ANALYSIS_ENABLED !== 'false',
        weight: Number(process.env.VOLUME_ANALYSIS_WEIGHT || 0.25),
        parameters: {
          // Renommé 'maPeriod' en 'volumeMALength' pour correspondre à VolumeAnalysisConfig
          volumeMALength: Number(process.env.VOLUME_MA_PERIOD || STRATEGY_CONSTANTS.VOLUME.MA_PERIOD),
          // Renommé 'spikeThreshold' en 'volumeThreshold' pour correspondre à VolumeAnalysisConfig
          volumeThreshold: Number(process.env.VOLUME_SPIKE_THRESHOLD || STRATEGY_CONSTANTS.VOLUME.SPIKE_THRESHOLD),
          // 'accumulationThreshold' n'a pas de correspondance directe, conservé tel quel pour l'instant ou à réévaluer
          accumulationThreshold: Number(process.env.VOLUME_ACCUMULATION_THRESHOLD || STRATEGY_CONSTANTS.VOLUME.ACCUMULATION_THRESHOLD),
          priceMALength: Number(process.env.PRICE_MA_LENGTH || 50), // Ajout d'une valeur par défaut, à vérifier
          volumeSpikeFactor: Number(process.env.VOLUME_SPIKE_FACTOR || 2), // Ajout d'une valeur par défaut, à vérifier
          priceSensitivity: Number(process.env.PRICE_SENSITIVITY || 0.01), // Ajout d'une valeur par défaut, à vérifier
          symbol: symbol.trim(),
          positionSize: Number(process.env.VOLUME_POSITION_SIZE || TRADING_CONSTANTS.DEFAULT_POSITION_SIZE),
        },
      },
      {
        type: "elliott-wave" as const,
        enabled: process.env.ELLIOTT_WAVE_ENABLED !== 'false',
        weight: Number(process.env.ELLIOTT_WAVE_WEIGHT || 0.25),
        parameters: {
          // Renommé 'minWaveLength' (ou une combinaison) en 'waveDetectionLength'
          // Pour l'instant, utilisation de minWaveLength, à ajuster si la logique est différente.
          waveDetectionLength: Number(process.env.ELLIOTT_MIN_WAVE_LENGTH || STRATEGY_CONSTANTS.ELLIOTT.MIN_WAVE_LENGTH),
          // 'maxWaveLength' n'a pas de correspondance directe, conservé tel quel ou à réévaluer
          maxWaveLength: Number(process.env.ELLIOTT_MAX_WAVE_LENGTH || STRATEGY_CONSTANTS.ELLIOTT.MAX_WAVE_LENGTH),
          priceSensitivity: Number(process.env.ELLIOTT_PRICE_SENSITIVITY || 0.02), // Ajout d'une valeur par défaut, à vérifier
          zerolineBufferPercent: Number(process.env.ELLIOTT_ZEROLINE_BUFFER || 0.1), // Ajout d'une valeur par défaut, à vérifier
          fibonacciLevels: STRATEGY_CONSTANTS.ELLIOTT.FIBONACCI_LEVELS,
          symbol: symbol.trim(),
          positionSize: Number(process.env.ELLIOTT_POSITION_SIZE || TRADING_CONSTANTS.DEFAULT_POSITION_SIZE),
        },
      },
      {
        type: "harmonic-pattern" as const,
        enabled: process.env.HARMONIC_PATTERN_ENABLED !== 'false',
        weight: Number(process.env.HARMONIC_PATTERN_WEIGHT || 0.25),
        parameters: {
          detectionLength: Number(process.env.PATTERN_DETECTION_LENGTH || 20),
          fibRetracementTolerance: Number(process.env.FIB_RETRACEMENT_TOLERANCE || STRATEGY_CONSTANTS.HARMONIC.TOLERANCE),
          patternConfirmationPercentage: Number(process.env.PATTERN_CONFIRMATION_PCT || 90),
          symbol: symbol.trim(),
          positionSize: Number(process.env.HARMONIC_POSITION_SIZE || TRADING_CONSTANTS.DEFAULT_POSITION_SIZE),
        },
      },
      { // Ajout de la configuration simple-ma
        type: "simple-ma" as const,
        enabled: process.env.SIMPLE_MA_ENABLED !== 'false',
        weight: Number(process.env.SIMPLE_MA_WEIGHT || 0.25),
        parameters: {
          shortPeriod: Number(process.env.SIMPLE_MA_SHORT_PERIOD || 10), // Par défaut : 10
          longPeriod: Number(process.env.SIMPLE_MA_LONG_PERIOD || 20),  // Par défaut : 20
          symbol: symbol.trim(),
          positionSize: Number(process.env.SIMPLE_MA_POSITION_SIZE || TRADING_CONSTANTS.DEFAULT_POSITION_SIZE),
        },
      },
    ]).flat(),
    takeProfit: {
      enabled: process.env.TAKE_PROFIT_ENABLED !== 'false',
      profitTiers: [
        {
          profitPercentage: Number(process.env.TAKE_PROFIT_LEVEL_1 || 3),
          closePercentage: Number(process.env.TAKE_PROFIT_SIZE_1 || 30),
        },
        {
          profitPercentage: Number(process.env.TAKE_PROFIT_LEVEL_2 || 5),
          closePercentage: Number(process.env.TAKE_PROFIT_SIZE_2 || 50),
        },
        {
          profitPercentage: Number(process.env.TAKE_PROFIT_LEVEL_3 || 7),
          closePercentage: Number(process.env.TAKE_PROFIT_SIZE_3 || 100),
        },
      ],
      cooldownPeriod: Number(process.env.TAKE_PROFIT_COOLDOWN || TAKE_PROFIT_CONSTANTS.COOLDOWN_PERIOD),
      trailingMode: process.env.TRAILING_MODE === 'true',
    },
    actors: {
      riskManager: {
        maxOpenPositions: Number(process.env.MAX_OPEN_POSITIONS || 5),
        maxDailyLoss: Number(process.env.MAX_DAILY_LOSS || 0.1),
        diversificationWeight: Number(process.env.DIVERSIFICATION_WEIGHT || 0.3),
        volatilityAdjustment: process.env.VOLATILITY_ADJUSTMENT !== 'false',
      },
      strategyManager: {
        autoAdjustWeights: process.env.AUTO_ADJUST_WEIGHTS !== 'false',
        maxActiveStrategies: Number(process.env.MAX_ACTIVE_STRATEGIES || 4),
        conflictResolutionMode: (process.env.CONFLICT_RESOLUTION_MODE || 'performance_weighted') as any,
        optimizationEnabled: process.env.OPTIMIZATION_ENABLED !== 'false',
      },
      performanceTracker: {
        historyLength: Number(process.env.PERFORMANCE_HISTORY_LENGTH || 1000),
        trackOpenPositions: process.env.TRACK_OPEN_POSITIONS !== 'false',
        realTimeUpdates: process.env.REAL_TIME_UPDATES !== 'false',
        calculationInterval: Number(process.env.CALCULATION_INTERVAL || 60000),
      },
    },
    logging: {
      level: (process.env.LOG_LEVEL || "info") as LogLevel,
      fileOutput: process.env.LOG_TO_FILE === "true",
      logFilePath: process.env.LOG_FILE_PATH,
      maxFileSize: Number(process.env.LOG_MAX_FILE_SIZE || 10 * 1024 * 1024),
      maxFiles: Number(process.env.LOG_MAX_FILES || 5),
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
