#!/usr/bin/env bun

import { createBacktestCLI } from './infrastructure/backtesting/backtest-cli';

// Création et exécution de la CLI de backtesting
async function main() {
  try {
    const program = createBacktestCLI();
    await program.parseAsync(process.argv);
  } catch (error) {
    console.error('Error running backtest:', error);
    process.exit(1);
  }
}

main().catch(console.error);