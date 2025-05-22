#!/bin/bash

# Compile TypeScript files to JavaScript
echo "Compiling TypeScript files..."
npx tsc

# Run the compiled JavaScript file
echo "Running improved backtest..."
node dist/improved-backtest.js
