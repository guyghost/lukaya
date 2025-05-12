import { ActorContext, ActorMessage, ActorDefinition } from "../../../actor/models/actor.model";
import { 
  PerformanceTrackerMessage, 
  PerformanceTrackerState, 
  PerformanceTrackerConfig,
  TradeEntry,
  AccountMetrics,
  SymbolPerformance,
  TradeHistoryFilter,
  Period,
  ReportType
} from "./performance-tracker.model";
import { StrategyPerformance } from "../strategy-manager/strategy-manager.model";
import { getLogger } from "../../../infrastructure/logger";

// Create a definition for the performance tracker actor
export const createPerformanceTrackerActorDefinition = (
  config?: Partial<PerformanceTrackerConfig>
): ActorDefinition<PerformanceTrackerState, PerformanceTrackerMessage> => {
  const logger = getLogger();
  
  // Default configuration
  const defaultConfig: PerformanceTrackerConfig = {
    historyLength: 1000,   // Maximum number of trades to keep in history
    trackOpenPositions: true,
    realTimeUpdates: true,
    calculationInterval: 60000, // Recalculate metrics every minute
    includeFeesInCalculations: true
  };
  
  // Merge provided config with defaults
  const mergedConfig: PerformanceTrackerConfig = {
    ...defaultConfig,
    ...config
  };
  
  // Initial account metrics
  const initialAccountMetrics: AccountMetrics = {
    startingBalance: 10000,
    currentBalance: 10000,
    totalProfit: 0,
    totalProfitPercent: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    averageWin: 0,
    averageLoss: 0,
    profitFactor: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    maxDrawdown: 0,
    maxDrawdownPercent: 0,
    averageHoldingTime: 0,
    dailyReturns: [],
    monthlyReturns: [],
    returnsVolatility: 0,
    calmarRatio: 0,
    openPositions: 0
  };
  
  // Initial state for the actor
  const initialState: PerformanceTrackerState = {
    trades: [],
    openTrades: {},
    symbolPerformance: {},
    strategyPerformance: {},
    accountMetrics: initialAccountMetrics,
    lastUpdateTime: Date.now(),
    priceHistory: {},
    config: mergedConfig
  };

  // Helper functions
  const calculateSymbolPerformance = (
    symbol: string,
    trades: TradeEntry[]
  ): SymbolPerformance => {
    // Filter trades for this symbol
    const symbolTrades = trades.filter(trade => trade.symbol === symbol && trade.status === 'closed');
    
    if (symbolTrades.length === 0) {
      return {
        symbol,
        trades: 0,
        winningTrades: 0,
        losingTrades: 0,
        breakEvenTrades: 0,
        winRate: 0,
        averageWin: 0,
        averageLoss: 0,
        largestWin: 0,
        largestLoss: 0,
        profitFactor: 0,
        netProfit: 0,
        netProfitPercent: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
        averageHoldingTime: 0
      };
    }
    
    // Simple calculation of win rate and profit
    const winningTrades = symbolTrades.filter(trade => (trade.pnl || 0) > 0);
    const losingTrades = symbolTrades.filter(trade => (trade.pnl || 0) < 0);
    const breakEvenTrades = symbolTrades.filter(trade => (trade.pnl || 0) === 0);
    
    const winRate = symbolTrades.length > 0 ? winningTrades.length / symbolTrades.length : 0;
    const netProfit = symbolTrades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
    
    return {
      symbol,
      trades: symbolTrades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      breakEvenTrades: breakEvenTrades.length,
      winRate,
      averageWin: 0,
      averageLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      profitFactor: 0,
      netProfit,
      netProfitPercent: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      averageHoldingTime: 0
    };
  };
  
  const calculateStrategyPerformance = (
    strategyId: string,
    trades: TradeEntry[]
  ): StrategyPerformance => {
    // Filter trades for this strategy
    const strategyTrades = trades.filter(trade => trade.strategyId === strategyId && trade.status === 'closed');
    
    // Simple performance calculation
    const winningTrades = strategyTrades.filter(trade => (trade.pnl || 0) > 0);
    const winRate = strategyTrades.length > 0 ? winningTrades.length / strategyTrades.length : 0;
    const netProfit = strategyTrades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
    
    return {
      strategyId,
      winRate,
      profitFactor: 0,
      averageWin: 0,
      averageLoss: 0,
      sharpeRatio: 0,
      drawdown: 0,
      trades: strategyTrades.length,
      netProfit,
      active: true,
      lastUpdated: Date.now()
    };
  };
  
  // The behavior that defines how the actor reacts to messages
  const behavior = async (
    state: PerformanceTrackerState,
    message: ActorMessage<PerformanceTrackerMessage>,
    context: ActorContext<PerformanceTrackerState>
  ) => {
    const { payload } = message;
    
    switch (payload.type) {
      case "TRADE_OPENED": {
        const { trade } = payload;
        
        logger.info(`New trade opened: ${trade.id}`, {
          symbol: trade.symbol,
          strategy: trade.strategyId,
          entryPrice: trade.entryPrice
        });
        
        // Add to open trades
        const updatedOpenTrades = {
          ...state.openTrades,
          [trade.id]: trade
        };
        
        // Add to trade history
        const updatedTrades = [
          ...state.trades,
          trade
        ];
        
        return { 
          state: {
            ...state,
            trades: updatedTrades,
            openTrades: updatedOpenTrades,
          }
        };
      }
      
      case "TRADE_CLOSED": {
        const { trade } = payload;
        
        logger.info(`Trade closed: ${trade.id}`, {
          symbol: trade.symbol,
          strategy: trade.strategyId,
          entryPrice: trade.entryPrice,
          exitPrice: trade.exitPrice,
          pnl: trade.pnl
        });
        
        // Remove from open trades
        const { [trade.id]: removedTrade, ...remainingOpenTrades } = state.openTrades;
        
        // Update trade in history
        const tradeIndex = state.trades.findIndex(t => t.id === trade.id);
        let updatedTrades = [...state.trades];
        
        if (tradeIndex >= 0) {
          updatedTrades[tradeIndex] = trade;
        } else {
          updatedTrades.push(trade);
        }
        
        // Update symbol performance
        const updatedSymbolPerformance = {
          ...state.symbolPerformance,
          [trade.symbol]: calculateSymbolPerformance(trade.symbol, updatedTrades)
        };
        
        // Update strategy performance
        const updatedStrategyPerformance = {
          ...state.strategyPerformance,
          [trade.strategyId]: calculateStrategyPerformance(trade.strategyId, updatedTrades)
        };
        
        return { 
          state: {
            ...state,
            trades: updatedTrades,
            openTrades: remainingOpenTrades,
            symbolPerformance: updatedSymbolPerformance,
            strategyPerformance: updatedStrategyPerformance,
          }
        };
      }
      
      case "UPDATE_PRICE": {
        const { symbol, price, timestamp } = payload;
        
        // Store price in history
        const symbolPrices = state.priceHistory[symbol] || [];
        const updatedPrices = [
          ...symbolPrices,
          { price, timestamp }
        ].slice(-100); // Keep last 100 prices per symbol
        
        const updatedPriceHistory = {
          ...state.priceHistory,
          [symbol]: updatedPrices
        };
        
        return { 
          state: {
            ...state,
            priceHistory: updatedPriceHistory
          }
        };
      }
      
      case "GET_ACCOUNT_METRICS": {
        logger.debug("Returning account metrics");
        return { state };
      }
      
      case "GET_SYMBOL_PERFORMANCE": {
        const { symbol } = payload;
        logger.debug(`Returning performance for symbol: ${symbol}`);
        return { state };
      }
      
      case "GET_STRATEGY_PERFORMANCE": {
        const { strategyId } = payload;
        logger.debug(`Returning performance for strategy: ${strategyId}`);
        return { state };
      }
      
      case "GET_TRADE_HISTORY": {
        const { filters } = payload;
        logger.debug("Returning filtered trade history", filters);
        return { state };
      }
      
      case "GENERATE_PERFORMANCE_REPORT": {
        const { type, period = 'all' } = payload;
        logger.info(`Generating ${type} performance report for period: ${period}`);
        return { state };
      }
      
      case "UPDATE_CONFIG": {
        const { config } = payload;
        logger.info("Updating performance tracker configuration", config);
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

export const createPerformanceTrackerService = (
  config?: Partial<PerformanceTrackerConfig>
) => {
  const actorDefinition = createPerformanceTrackerActorDefinition(config);
  
  // The service would be responsible for creating the actor and exposing a typed API
  return {
    getActorDefinition: () => actorDefinition
  };
};