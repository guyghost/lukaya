import { z } from "zod";
import { Network } from "@dydxprotocol/v4-client-js";

// Define the configuration schema
const configSchema = z.object({
  network: z.enum(["mainnet", "testnet"]).default("testnet"),
  dydx: z.object({
    mnemonic: z.string().optional(),
  }),
  trading: z.object({
    defaultSymbol: z.string().default("BTC-USD"),
    defaultPositionSize: z.number().positive().default(0.1),
    maxLeverage: z.number().positive().default(2),
  }),
  strategies: z.array(
    z.object({
      type: z.string(),
      enabled: z.boolean().default(true),
      parameters: z.record(z.unknown()),
    })
  ).default([]),
});

export type ConfigType = z.infer<typeof configSchema>;

export const loadConfig = (): ConfigType => {
  const defaultConfig = {
    network: process.env.DYDX_NETWORK || "testnet",
    dydx: {
      mnemonic: process.env.DYDX_MNEMONIC,
    },
    trading: {
      defaultSymbol: "BTC-USD",
      defaultPositionSize: 0.1,
      maxLeverage: 2,
    },
    strategies: [
      {
        type: "simple-ma",
        enabled: true,
        parameters: {
          shortPeriod: 10,
          longPeriod: 30,
          symbol: "BTC-USD",
          positionSize: 0.1,
        },
      },
    ],
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
