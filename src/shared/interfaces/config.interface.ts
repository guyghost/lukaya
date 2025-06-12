import { Network } from "@dydxprotocol/v4-client-js";
import { z } from "zod";

/**
 * Interface représentant la configuration complète de l'application
 */
export interface AppConfig {
  network: "mainnet" | "testnet";
  dydx: {
    mnemonic?: string;
    accountAddress?: string;
    defaultSubaccountNumber: number;
  };
  trading: {
    defaultSymbols: string[];
    defaultPositionSize: number;
    maxLeverage: number;
    pollInterval: number;
    maxSlippagePercent: number;
    minLiquidityRatio: number;
    riskPerTrade: number;
    stopLossPercent: number;
    defaultAccountSize: number;
    maxCapitalPerTrade: number;
    maxFundsPerOrder: number;
    positionAnalysisInterval: number;
    limitOrderBuffer: number;
    useLimitOrders: boolean;
  };
  strategies: {
    type: string;
    enabled: boolean;
    weight?: number;
    parameters: Record<string, unknown>;
  }[];
  logging: {
    level: "debug" | "info" | "warn" | "error";
    fileOutput: boolean;
    logFilePath?: string;
    maxFileSize?: number;
    maxFiles?: number;
  };
  actors?: {
    riskManager: {
      maxOpenPositions: number;
    };
    strategyManager: {
      autoAdjustWeights: boolean;
      maxActiveStrategies: number;
      conflictResolutionMode:
        | "performance_weighted"
        | "risk_adjusted"
        | "consensus";
      optimizationEnabled: boolean;
    };
    performanceTracker: {
      historyLength: number;
      trackOpenPositions: boolean;
      realTimeUpdates: boolean;
      calculationInterval: number;
    };
  };
  takeProfit?: {
    enabled: boolean;
    profitTiers: Array<{
      profitPercentage: number;
      closePercentage: number;
    }>;
    cooldownPeriod: number;
    trailingMode: boolean;
  };
}

/**
 * Type pour le schéma Zod de la configuration
 */
export type ConfigSchema = z.ZodType<AppConfig>;
