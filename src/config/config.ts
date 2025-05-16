import { z } from "zod";
import { Network } from "@dydxprotocol/v4-client-js";

// Update schema to match new config
const configSchema = z.object({
  network: z.enum(["mainnet", "testnet"]).default("testnet"),
  dydx: z.object({
    mnemonic: z.string().optional(),
    defaultSubaccountNumber: z.number().default(0),
  }),
  trading: z.object({
    defaultSymbols: z.array(z.string()).default(["BTC-USD"]),
    defaultPositionSize: z.number().positive().default(0.1),
    maxLeverage: z.number().positive().default(2),
    pollInterval: z.number().positive().default(5000), // ms
    maxSlippagePercent: z.number().positive().default(1.0), // % slippage maximal accepté
    minLiquidityRatio: z.number().positive().default(10.0), // ratio de liquidité minimum
    riskPerTrade: z.number().positive().default(0.01), // % du capital à risquer par trade
    stopLossPercent: z.number().positive().default(0.02), // % de stop loss
    defaultAccountSize: z.number().positive().default(10000), // taille du compte par défaut
    maxCapitalPerTrade: z.number().positive().default(0.25), // % maximum du capital par trade
    maxFundsPerOrder: z.number().positive().default(0.25), // % maximum des fonds disponibles par ordre
    positionAnalysisInterval: z.number().positive().default(300000), // intervalle d'analyse des positions (ms)
    limitOrderBuffer: z.number().positive().default(0.0005), // buffer pour les ordres limite (0.05%)
    useLimitOrders: z.boolean().default(true), // utiliser des ordres limite plutôt que des ordres au marché
  }),
  strategies: z
    .array(
      z.object({
        type: z.string(),
        enabled: z.boolean().default(true),
        parameters: z.record(z.unknown()),
      }),
    )
    .default([]),
  logging: z
    .object({
      level: z.enum(["debug", "info", "warn", "error"]).default("info"),
      fileOutput: z.boolean().default(false),
      logFilePath: z.string().optional(),
    })
    .default({
      level: "info",
      fileOutput: false,
    }),
});

export type ConfigType = z.infer<typeof configSchema>;

export const loadConfig = (): ConfigType => {
  const defaultConfig = {
    network: process.env.DYDX_NETWORK || "testnet",
    dydx: {
      mnemonic: process.env.DYDX_MNEMONIC,
      defaultSubaccountNumber: Number(process.env.DYDX_SUBACCOUNT_NUMBER || 0),
    },
    trading: {
      // defaultSymbol is now an array to support multiple markets
      defaultSymbols: process.env.DEFAULT_SYMBOLS
        ? process.env.DEFAULT_SYMBOLS.split(",").map((s) => s.trim())
        : ["BTC-USD"],
      defaultPositionSize: Number(process.env.DEFAULT_POSITION_SIZE || 0.01),
      maxLeverage: Number(process.env.MAX_LEVERAGE || 2),
      pollInterval: Number(process.env.POLL_INTERVAL || 5000),
      maxSlippagePercent: Number(process.env.MAX_SLIPPAGE_PERCENT || 1.0),
      minLiquidityRatio: Number(process.env.MIN_LIQUIDITY_RATIO || 10.0),
      riskPerTrade: Number(process.env.RISK_PER_TRADE || 0.01),
      stopLossPercent: Number(process.env.STOP_LOSS_PERCENT || 0.02),
      defaultAccountSize: Number(process.env.DEFAULT_ACCOUNT_SIZE || 10000),
      maxCapitalPerTrade: Number(process.env.MAX_CAPITAL_PER_TRADE || 0.25),
      maxFundsPerOrder: Number(process.env.MAX_FUNDS_PER_ORDER || 0.25),
      positionAnalysisInterval: Number(process.env.POSITION_ANALYSIS_INTERVAL || 300000),
      limitOrderBuffer: Number(process.env.LIMIT_ORDER_BUFFER || 0.0005),
      useLimitOrders: process.env.USE_LIMIT_ORDERS !== 'false',
    },
    strategies: process.env.DEFAULT_SYMBOLS
      ? process.env.DEFAULT_SYMBOLS.split(",").map((symbol) => ({
          type: "rsi",
          enabled: true,
          parameters: {
            shortPeriod: Number(process.env.MA_SHORT_PERIOD || 10),
            longPeriod: Number(process.env.MA_LONG_PERIOD || 30),
            symbol: symbol.trim(),
            positionSize: Number(process.env.DEFAULT_POSITION_SIZE || 0.01),
            maxSlippagePercent: Number(process.env.MAX_SLIPPAGE_PERCENT || 1.0),
            minLiquidityRatio: Number(process.env.MIN_LIQUIDITY_RATIO || 10.0),
            riskPerTrade: Number(process.env.RISK_PER_TRADE || 0.01),
            stopLossPercent: Number(process.env.STOP_LOSS_PERCENT || 0.02),
            accountSize: Number(process.env.DEFAULT_ACCOUNT_SIZE || 10000),
            maxCapitalPerTrade: Number(process.env.MAX_CAPITAL_PER_TRADE || 0.25),
            limitOrderBuffer: Number(process.env.LIMIT_ORDER_BUFFER || 0.0005),
          },
        }))
      : [
          {
            type: "simple-ma",
            enabled: true,
            parameters: {
              shortPeriod: Number(process.env.MA_SHORT_PERIOD || 10),
              longPeriod: Number(process.env.MA_LONG_PERIOD || 30),
              symbol: "BTC-USD",
              positionSize: Number(process.env.DEFAULT_POSITION_SIZE || 0.01),
              maxSlippagePercent: Number(process.env.MAX_SLIPPAGE_PERCENT || 1.0),
              minLiquidityRatio: Number(process.env.MIN_LIQUIDITY_RATIO || 10.0),
              riskPerTrade: Number(process.env.RISK_PER_TRADE || 0.01),
              stopLossPercent: Number(process.env.STOP_LOSS_PERCENT || 0.02),
              accountSize: Number(process.env.DEFAULT_ACCOUNT_SIZE || 10000),
              maxCapitalPerTrade: Number(process.env.MAX_CAPITAL_PER_TRADE || 0.25),
              limitOrderBuffer: Number(process.env.LIMIT_ORDER_BUFFER || 0.0005),
            },
          },
        ],
    logging: {
      level: process.env.LOG_LEVEL || "info",
      fileOutput: process.env.LOG_TO_FILE === "true",
      logFilePath: process.env.LOG_FILE_PATH,
    },
  };

  // Validate configuration
  return configSchema.parse(defaultConfig);
};

// Convert string network to dYdX Network enum
export const getNetworkFromString = (network: string): Network => {
  switch (network) {
    case "mainnet":
      return Network.mainnet();
    case "testnet":
    default:
      return Network.testnet();
  }
};
