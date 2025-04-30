import { z } from "zod";
import { Network } from "@dydxprotocol/v4-client-js";

// Define the configuration schema
const configSchema = z.object({
  network: z.enum(["mainnet", "testnet"]).default("testnet"),
  dydx: z.object({
    mnemonic: z.string().optional(),
    defaultSubaccountNumber: z.number().default(0),
  }),
  trading: z.object({
    defaultSymbol: z.string().default("BTC-USD"),
    defaultPositionSize: z.number().positive().default(0.1),
    maxLeverage: z.number().positive().default(2),
    pollInterval: z.number().positive().default(5000), // ms
  }),
  strategies: z.array(
    z.object({
      type: z.string(),
      enabled: z.boolean().default(true),
      parameters: z.record(z.unknown()),
    })
  ).default([]),
  logging: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    fileOutput: z.boolean().default(false),
    logFilePath: z.string().optional(),
  }).default({
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
      defaultSymbol: process.env.DEFAULT_SYMBOL || "BTC-USD",
      defaultPositionSize: Number(process.env.DEFAULT_POSITION_SIZE || 0.1),
      maxLeverage: Number(process.env.MAX_LEVERAGE || 2),
      pollInterval: Number(process.env.POLL_INTERVAL || 5000),
    },
    strategies: [
      {
        type: "simple-ma",
        enabled: true,
        parameters: {
          shortPeriod: Number(process.env.MA_SHORT_PERIOD || 10),
          longPeriod: Number(process.env.MA_LONG_PERIOD || 30),
          symbol: process.env.DEFAULT_SYMBOL || "BTC-USD",
          positionSize: Number(process.env.DEFAULT_POSITION_SIZE || 0.1),
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
