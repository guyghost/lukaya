import { ActorContext, ActorMessage, ActorDefinition } from "../../../actor/models/actor.model";
import { 
  StrategyManagerMessage, 
  StrategyManagerState, 
  StrategyManagerConfig,
  StrategyEntry,
  StrategyPerformance
} from "./strategy-manager.model";
import { MarketData, OrderParams } from "../../../domain/models/market.model";
import { getLogger } from "../../../infrastructure/logger";
import { Strategy, StrategySignal } from "../../../domain/models/strategy.model";

// Create a definition for the strategy manager actor
export const createStrategyManagerActorDefinition = (
  config?: Partial<StrategyManagerConfig>
): ActorDefinition<StrategyManagerState, StrategyManagerMessage> => {
  const logger = getLogger();
  
  // Default configuration
  const defaultConfig: StrategyManagerConfig = {
    autoAdjustWeights: true,
    minPerformanceThreshold: 0.5, // 50% win rate minimum
    maxActiveStrategies: 10,
    rebalancePeriod: 24 * 60 * 60 * 1000, // 24 hours
    backtestPeriod: 30 * 24 * 60 * 60 * 1000, // 30 days
    optimizationEnabled: true,
    rotationEnabled: true,
    conflictResolutionMode: 'performance_weighted'
  };
  
  // Merge provided config with defaults
  const mergedConfig: StrategyManagerConfig = {
    ...defaultConfig,
    ...config
  };
  
  // Create default strategy performance metrics
  const createDefaultPerformance = (strategyId: string): StrategyPerformance => ({
    strategyId,
    winRate: 0,
    profitFactor: 0,
    averageWin: 0,
    averageLoss: 0,
    sharpeRatio: 0,
    drawdown: 0,
    trades: 0,
    netProfit: 0,
    active: true,
    lastUpdated: Date.now()
  });
  
  // Initial state for the actor
  const initialState: StrategyManagerState = {
    strategies: {},
    config: mergedConfig,
    activeStrategiesCount: 0,
    lastOptimization: 0,
    lastRotation: 0,
    marketDataCache: {}
  };
  
  // Helper functions
  const calculateWeight = (strategyEntry: StrategyEntry): number => {
    // Calculate weight based on performance metrics
    const { performance } = strategyEntry;
    
    // Basic weighting: winRate * profitFactor * (1 - drawdown)
    let weight = performance.winRate * (performance.profitFactor || 1) * (1 - performance.drawdown);
    
    // Ensure weight is between 0.1 and 1
    weight = Math.min(1, Math.max(0.1, weight));
    
    // For new strategies with no trades, use default weight of 0.5
    if (performance.trades === 0) {
      weight = 0.5;
    }
    
    return weight;
  };
  
  const normalizeWeights = (strategies: Record<string, StrategyEntry>): Record<string, StrategyEntry> => {
    const activeStrategies = Object.values(strategies).filter(s => s.status === 'active');
    
    if (activeStrategies.length === 0) return strategies;
    
    // Get sum of all weights
    const totalWeight = activeStrategies.reduce((sum, strategy) => sum + strategy.weight, 0);
    
    // If total weight is 0, set equal weights
    if (totalWeight === 0) {
    const equalWeight = 1 / activeStrategies.length;
      
    return Object.entries(strategies).reduce((result, [id, strategy]) => {
      result[id] = {
        ...strategy,
        weight: strategy.status === 'active' ? equalWeight : 0
      };
      return result;
    }, {} as Record<string, StrategyEntry>);
  }
    
    // Normalize weights so they sum to 1
    return Object.entries(strategies).reduce((result, [id, strategy]) => {
      result[id] = {
        ...strategy,
        weight: strategy.status === 'active' ? strategy.weight / totalWeight : 0
      };
      return result;
    }, {} as Record<string, StrategyEntry>);
  };
  
  const resolveConflicts = (
    signals: Map<string, StrategySignal | null>,
    strategies: Record<string, StrategyEntry>,
    mode: StrategyManagerConfig['conflictResolutionMode']
  ): Map<string, StrategySignal | null> => {
    // Create a map of symbols and their conflicting signals
    const symbolSignals: Record<string, Array<{strategyId: string, signal: StrategySignal, weight: number}>> = {};
    
    // Group signals by symbol
    for (const [strategyId, signal] of signals.entries()) {
      if (!signal) continue;
      
      const strategy = strategies[strategyId];
      if (!strategy || strategy.status !== 'active') continue;
      
      const symbol = (strategy.config.parameters as any).symbol || '';
      if (!symbol) continue;
      
      if (!symbolSignals[symbol]) {
        symbolSignals[symbol] = [];
      }
      
      symbolSignals[symbol].push({
        strategyId,
        signal,
        weight: strategy.weight
      });
    }
    
    // Process each symbol for conflicts
    const resolvedSignals = new Map<string, StrategySignal | null>();
    
    for (const [symbol, signalList] of Object.entries(symbolSignals)) {
      // If only one signal for this symbol, no conflict
      if (signalList.length <= 1) {
        if (signalList.length === 1) {
          resolvedSignals.set(signalList[0].strategyId, signalList[0].signal);
        }
        continue;
      }
      
      // Check for conflicts (opposite directions)
      const longSignals = signalList.filter(s => 
        (s.signal.type === 'entry' && s.signal.direction === 'long') || 
        (s.signal.type === 'exit' && s.signal.direction === 'short')
      );
      
      const shortSignals = signalList.filter(s => 
        (s.signal.type === 'entry' && s.signal.direction === 'short') || 
        (s.signal.type === 'exit' && s.signal.direction === 'long')
      );
      
      // If no conflicts (all same direction), keep all signals
      if (longSignals.length === 0 || shortSignals.length === 0) {
        signalList.forEach(s => resolvedSignals.set(s.strategyId, s.signal));
        continue;
      }
      
      // We have conflicts, resolve based on selected mode
      switch (mode) {
        case 'performance_weighted': {
          // Calculate total weight for each direction
          const longWeight = longSignals.reduce((sum, s) => sum + s.weight, 0);
          const shortWeight = shortSignals.reduce((sum, s) => sum + s.weight, 0);
          
          // Choose signals from the winning direction
          const winningSignals = longWeight > shortWeight ? longSignals : shortSignals;
          winningSignals.forEach(s => resolvedSignals.set(s.strategyId, s.signal));
          break;
        }
        
        case 'risk_adjusted': {
          // In risk adjusted mode, we favor exit signals over entry signals
          const exitSignals = signalList.filter(s => s.signal.type === 'exit');
          const entrySignals = signalList.filter(s => s.signal.type === 'entry');
          
          if (exitSignals.length > 0) {
            exitSignals.forEach(s => resolvedSignals.set(s.strategyId, s.signal));
          } else {
            // For entries, use performance weighted approach
            const longWeight = longSignals.reduce((sum, s) => sum + s.weight, 0);
            const shortWeight = shortSignals.reduce((sum, s) => sum + s.weight, 0);
            
            const winningSignals = longWeight > shortWeight ? longSignals : shortSignals;
            winningSignals.forEach(s => resolvedSignals.set(s.strategyId, s.signal));
          }
          break;
        }
        
        case 'consensus': {
          // In consensus mode, we only generate signals if majority agrees
          const totalSignals = longSignals.length + shortSignals.length;
          const longPercentage = longSignals.length / totalSignals;
          const shortPercentage = shortSignals.length / totalSignals;
          
          const consensusThreshold = 0.66; // 2/3 majority
          
          if (longPercentage >= consensusThreshold) {
            longSignals.forEach(s => resolvedSignals.set(s.strategyId, s.signal));
          } else if (shortPercentage >= consensusThreshold) {
            shortSignals.forEach(s => resolvedSignals.set(s.strategyId, s.signal));
          }
          // If no consensus, no signals are generated
          break;
        }
      }
    }
    
    return resolvedSignals;
  };
  
  // The behavior that defines how the actor reacts to messages
  const behavior = async (
    state: StrategyManagerState,
    message: ActorMessage<StrategyManagerMessage>,
    context: ActorContext<StrategyManagerState>
  ): Promise<{ state: StrategyManagerState }> => {
    const { payload } = message;
    
    switch (payload.type) {
      case "REGISTER_STRATEGY": {
        const { strategy, markets, initialWeight = 0.5 } = payload;
        const strategyId = strategy.getId();
        
        logger.info(`Registering strategy: ${strategy.getName()}`, {
          strategyId,
          markets,
          initialWeight
        });
        
        // Check if strategy already exists
        if (state.strategies[strategyId]) {
          logger.warn(`Strategy ${strategyId} already registered`);
          return { state };
        }
        
        // Check if we have exceeded max active strategies
        if (state.activeStrategiesCount >= state.config.maxActiveStrategies) {
          logger.warn(`Cannot register strategy ${strategyId}: maximum active strategies reached`);
          return { state };
        }
        
        const strategyConfig = strategy.getConfig();
        
        // Create a new strategy entry
        const newEntry: StrategyEntry = {
          strategy,
          config: strategyConfig,
          performance: createDefaultPerformance(strategyId),
          markets,
          weight: initialWeight,
          status: 'active' as const,
          riskLevel: 'MEDIUM'
        };
        
        // Add to strategies map
        const updatedStrategies = {
          ...state.strategies,
          [strategyId]: newEntry
        };
        
        // Normalize weights across all strategies
        const normalizedStrategies = state.config.autoAdjustWeights 
          ? normalizeWeights(updatedStrategies)
          : updatedStrategies;
        
        return { 
          state: {
            ...state,
            strategies: normalizedStrategies,
            activeStrategiesCount: state.activeStrategiesCount + 1
          }
        };
      }
      
      case "UNREGISTER_STRATEGY": {
        const { strategyId } = payload;
        
        logger.info(`Unregistering strategy: ${strategyId}`);
        
        // Check if strategy exists
        if (!state.strategies[strategyId]) {
          logger.warn(`Strategy ${strategyId} not found`);
          return { state };
        }
        
        // Remove strategy from map
        const { [strategyId]: removedStrategy, ...remainingStrategies } = state.strategies;
        
        // Decrement active count if strategy was active
        const decrementCount = removedStrategy.status === 'active' ? 1 : 0;
        
        // Normalize weights across remaining strategies
        const normalizedStrategies = state.config.autoAdjustWeights 
          ? normalizeWeights(remainingStrategies)
          : remainingStrategies;
        
        return { 
          state: {
            ...state,
            strategies: normalizedStrategies,
            activeStrategiesCount: state.activeStrategiesCount - decrementCount
          }
        };
      }
      
      case "PROCESS_MARKET_DATA": {
        const { data } = payload;
        
        logger.debug(`Processing market data for ${data.symbol}`);
        
        // Update market data cache
        const updatedCache = {
          ...state.marketDataCache,
          [data.symbol]: data
        };
        
        // Find strategies that are interested in this market
        const relevantStrategies = Object.values(state.strategies).filter(entry => 
          entry.status === 'active' && entry.markets.includes(data.symbol)
        );
        
        // Process data through each strategy
        const processResults = await Promise.all(
          relevantStrategies.map(async entry => {
            try {
              const signal = await entry.strategy.processMarketData(data);
              return { 
                strategyId: entry.strategy.getId(), 
                signal 
              };
            } catch (error) {
              logger.error(`Error processing market data in strategy ${entry.strategy.getId()}`, error as Error);
              return { strategyId: entry.strategy.getId(), signal: null };
            }
          })
        );
        
        // Update last signal for each strategy
        const updatedStrategies = { ...state.strategies };
        
        for (const { strategyId, signal } of processResults) {
          if (signal && updatedStrategies[strategyId]) {
            updatedStrategies[strategyId] = {
              ...updatedStrategies[strategyId],
              lastSignal: signal
            };
          }
        }
        
        return { 
          state: {
            ...state,
            strategies: updatedStrategies,
            marketDataCache: updatedCache
          }
        };
      }
      
      case "UPDATE_STRATEGY_PERFORMANCE": {
        const { strategyId, performance } = payload;
        
        logger.debug(`Updating performance for strategy ${strategyId}`, performance);
        
        // Check if strategy exists
        if (!state.strategies[strategyId]) {
          logger.warn(`Strategy ${strategyId} not found`);
          return { state };
        }
        
        // Update performance
        const strategy = state.strategies[strategyId];
        const updatedPerformance = {
          ...strategy.performance,
          ...performance,
          lastUpdated: Date.now()
        };
        
        // Calculate new weight based on performance if auto-adjust is enabled
        const newWeight = state.config.autoAdjustWeights 
          ? calculateWeight({ ...strategy, performance: updatedPerformance })
          : strategy.weight;
        
        // Update strategy
        const updatedStrategies = {
          ...state.strategies,
          [strategyId]: {
            ...strategy,
            performance: updatedPerformance,
            weight: newWeight
          }
        };
        
        // Normalize weights if auto-adjust is enabled
        const normalizedStrategies = state.config.autoAdjustWeights 
          ? normalizeWeights(updatedStrategies)
          : updatedStrategies;
        
        return { 
          state: {
            ...state,
            strategies: normalizedStrategies
          }
        };
      }
      
      case "ADJUST_STRATEGY_WEIGHT": {
        const { strategyId, weight } = payload;
        
        logger.info(`Manually adjusting weight for strategy ${strategyId} to ${weight}`);
        
        // Check if strategy exists
        if (!state.strategies[strategyId]) {
          logger.warn(`Strategy ${strategyId} not found`);
          return { state };
        }
        
        // Update weight
        const updatedStrategies = {
          ...state.strategies,
          [strategyId]: {
            ...state.strategies[strategyId],
            weight
          }
        };
        
        // Normalize weights
        const normalizedStrategies = normalizeWeights(updatedStrategies);
        
        return { 
          state: {
            ...state,
            strategies: normalizedStrategies
          }
        };
      }
      
      case "PAUSE_STRATEGY": {
        const { strategyId } = payload;
        
        logger.info(`Pausing strategy: ${strategyId}`);
        
        // Check if strategy exists
        if (!state.strategies[strategyId]) {
          logger.warn(`Strategy ${strategyId} not found`);
          return { state };
        }
        
        // Already paused
        if (state.strategies[strategyId].status !== 'active') {
          return { state };
        }
        
        // Update status
        const updatedStrategies = {
          ...state.strategies,
          [strategyId]: {
            ...state.strategies[strategyId],
            status: 'paused' as const,
            weight: 0 // Zero weight when paused
          }
        };
        
        // Normalize weights across remaining active strategies
        const normalizedStrategies = state.config.autoAdjustWeights 
          ? normalizeWeights(updatedStrategies)
          : updatedStrategies;
        
        return { 
          state: {
            ...state,
            strategies: normalizedStrategies,
            activeStrategiesCount: state.activeStrategiesCount - 1
          }
        };
      }
      
      case "RESUME_STRATEGY": {
        const { strategyId } = payload;
        
        logger.info(`Resuming strategy: ${strategyId}`);
        
        // Check if strategy exists
        if (!state.strategies[strategyId]) {
          logger.warn(`Strategy ${strategyId} not found`);
          return { state };
        }
        
        // Already active
        if (state.strategies[strategyId].status === 'active') {
          return { state };
        }
        
        // Check if we have exceeded max active strategies
        if (state.activeStrategiesCount >= state.config.maxActiveStrategies) {
          logger.warn(`Cannot resume strategy ${strategyId}: maximum active strategies reached`);
          return { state };
        }
        
        // Calculate initial weight based on performance
        const strategy = state.strategies[strategyId];
        const newWeight = calculateWeight(strategy);
        
        // Update status and weight
        const updatedStrategies = {
          ...state.strategies,
          [strategyId]: {
            ...strategy,
            status: 'active' as const,
            weight: newWeight
          }
        };
        
        // Normalize weights
        const normalizedStrategies = state.config.autoAdjustWeights 
          ? normalizeWeights(updatedStrategies)
          : updatedStrategies;
        
        return { 
          state: {
            ...state,
            strategies: normalizedStrategies,
            activeStrategiesCount: state.activeStrategiesCount + 1
          }
        };
      }
      
      case "GET_STRATEGY_SIGNALS": {
        const { marketData } = payload;
        
        logger.debug(`Getting strategy signals for ${marketData.symbol}`);
        
        // Find strategies that are interested in this market
        const relevantStrategies = Object.values(state.strategies).filter(entry => 
          entry.status === 'active' && entry.markets.includes(marketData.symbol)
        );
        
        // Process data through each strategy
        const signalPromises = relevantStrategies.map(async entry => {
          try {
            const signal = await entry.strategy.processMarketData(marketData);
            return { strategyId: entry.strategy.getId(), signal };
          } catch (error) {
            logger.error(`Error getting signals from strategy ${entry.strategy.getId()}`, error as Error);
            return { strategyId: entry.strategy.getId(), signal: null };
          }
        });
        
        const signals = await Promise.all(signalPromises);
        
        // Convert to Map
        const signalMap = new Map<string, StrategySignal | null>();
        signals.forEach(({ strategyId, signal }) => {
          signalMap.set(strategyId, signal);
        });
        
        // Resolve any conflicts between strategies
        const resolvedSignals = resolveConflicts(
          signalMap, 
          state.strategies, 
          state.config.conflictResolutionMode
        );
        
        // No state change, just return current state
        return { state };
      }
      
      case "VALIDATE_ORDER": {
        const { strategyId, signal, orderParams } = payload;
        
        logger.debug(`Validating order from strategy ${strategyId}`, {
          signalType: signal.type,
          direction: signal.direction,
          symbol: orderParams.symbol
        });
        
        // No state change, just return current state
        return { state };
      }
      
      case "GET_ALL_STRATEGIES": {
        logger.debug("Getting all strategies");
        
        // No state change, just return current state
        return { state };
      }
      
      case "RUN_OPTIMIZATION": {
        const { strategyIds } = payload;
        
        if (strategyIds && strategyIds.length > 0) {
          logger.info(`Running optimization for strategies: ${strategyIds.join(', ')}`);
        } else {
          logger.info("Running optimization for all strategies");
        }
        
        // In a real implementation, this would perform parameter optimization
        // For now, just update the timestamp
        return { 
          state: {
            ...state,
            lastOptimization: Date.now()
          }
        };
      }
      
      case "ROTATE_STRATEGIES": {
        logger.info("Rotating strategies based on performance");
        
        // In a real implementation, this would disable poorly performing strategies
        // and enable better performing ones, or try new strategies in backtest mode
        
        // For now, just update the timestamp
        return { 
          state: {
            ...state,
            lastRotation: Date.now()
          }
        };
      }
      
      case "UPDATE_CONFIG": {
        const { config } = payload;
        
        logger.info("Updating strategy manager configuration", config);
        
        return {
          state: {
            ...state,
            config: {
              ...state.config,
              ...config
            }
          }
        };
      }
      
      default:
        return { state };
    }
  };
  
  return {
    initialState,
    behavior,
    supervisorStrategy: { type: "restart" }
  };
};

export const createStrategyManagerService = (
  config?: Partial<StrategyManagerConfig>
) => {
  const actorDefinition = createStrategyManagerActorDefinition(config);
  
  // The service would be responsible for creating the actor and exposing a typed API
  return {
    getActorDefinition: () => actorDefinition
  };
};