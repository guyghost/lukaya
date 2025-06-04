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
import { createContextualLogger } from "../../../infrastructure/logging/enhanced-logger";

// Create a definition for the performance tracker actor
export const createPerformanceTrackerActorDefinition = (
  config?: Partial<PerformanceTrackerConfig>
): ActorDefinition<PerformanceTrackerState, PerformanceTrackerMessage> => {
  const logger = createContextualLogger("PerformanceTracker");
  
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

  // Log de démarrage
  logger.info("🚀 Initialisation du Performance Tracker", {
    config: mergedConfig,
    startingBalance: initialAccountMetrics.startingBalance,
    timestamp: new Date().toISOString()
  });

  // Helper functions
  const logTradeStatistics = (state: PerformanceTrackerState) => {
    const openTradesCount = Object.keys(state.openTrades).length;
    const totalTrades = state.trades.length;
    const closedTrades = state.trades.filter(trade => trade.status === 'closed');
    
    // Stats par stratégie
    const strategyStats = new Map<string, { trades: number; openTrades: number; totalPnl: number }>();
    
    // Compter les trades fermés par stratégie
    closedTrades.forEach(trade => {
      const strategyId = trade.strategyId;
      const stats = strategyStats.get(strategyId) || { trades: 0, openTrades: 0, totalPnl: 0 };
      stats.trades += 1;
      stats.totalPnl += trade.pnl || 0;
      strategyStats.set(strategyId, stats);
    });
    
    // Compter les trades ouverts par stratégie
    Object.values(state.openTrades).forEach(trade => {
      const strategyId = trade.strategyId;
      const stats = strategyStats.get(strategyId) || { trades: 0, openTrades: 0, totalPnl: 0 };
      stats.openTrades += 1;
      strategyStats.set(strategyId, stats);
    });
    
    logger.info("📊 Statistiques générales des trades", {
      totalTrades,
      closedTrades: closedTrades.length,
      openTrades: openTradesCount,
      totalPnlRealized: closedTrades.reduce((sum, trade) => sum + (trade.pnl || 0), 0)
    });
    
    // Log des stats par stratégie
    strategyStats.forEach((stats, strategyId) => {
      logger.info(`📈 Stats stratégie: ${strategyId}`, {
        strategy: strategyId,
        totalTrades: stats.trades,
        openTrades: stats.openTrades,
        totalPnlRealized: stats.totalPnl,
        avgPnlPerTrade: stats.trades > 0 ? (stats.totalPnl / stats.trades).toFixed(2) : '0'
      });
    });
  };
  
  const logOpenPositionsDetail = (state: PerformanceTrackerState, currentPrices?: Record<string, number>) => {
    const openTrades = Object.values(state.openTrades);
    
    if (openTrades.length === 0) {
      logger.info("💼 Aucune position ouverte");
      return;
    }
    
    logger.info(`💼 Positions ouvertes (${openTrades.length}):`);
    
    openTrades.forEach(trade => {
      const currentPrice = currentPrices?.[trade.symbol];
      let unrealizedPnl = 'N/A';
      
      if (currentPrice && trade.entryPrice) {
        const priceDiff = currentPrice - trade.entryPrice;
        const quantity = trade.quantity || 1;
        // BUY = position longue, SELL = position courte
        const multiplier = trade.entryOrder.side === 'BUY' ? 1 : -1;
        unrealizedPnl = (priceDiff * quantity * multiplier).toFixed(2);
      }
      
      logger.info(`🔹 Position ${trade.id}`, {
        symbol: trade.symbol,
        strategy: trade.strategyId,
        side: trade.entryOrder.side,
        entryPrice: trade.entryPrice,
        currentPrice: currentPrice || 'N/A',
        quantity: trade.quantity,
        unrealizedPnl,
        openedAt: new Date(trade.entryTime).toISOString(),
        durationMinutes: Math.round((Date.now() - trade.entryTime) / (1000 * 60))
      });
    });
  };

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
        
        logger.info(`🚀 Nouveau trade ouvert : ${trade.id}`, {
          tradeId: trade.id,
          symbol: trade.symbol,
          strategy: trade.strategyId,
          side: trade.entryOrder.side,
          entryPrice: trade.entryPrice,
          quantity: trade.quantity,
          entryTime: new Date(trade.entryTime).toISOString(),
          fees: trade.fees,
          tags: trade.tags
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
        
        // Log des statistiques après l'ouverture
        const newState = {
          ...state,
          trades: updatedTrades,
          openTrades: updatedOpenTrades,
        };
        
        logTradeStatistics(newState);
        
        return { 
          state: newState
        };
      }
      
      case "TRADE_CLOSED": {
        const { trade } = payload;
        
        const profitEmoji = (trade.pnl || 0) > 0 ? "💰" : (trade.pnl || 0) < 0 ? "📉" : "⚖️";
        
        logger.info(`${profitEmoji} Trade clôturé : ${trade.id}`, {
          tradeId: trade.id,
          symbol: trade.symbol,
          strategy: trade.strategyId,
          side: trade.entryOrder.side,
          entryPrice: trade.entryPrice,
          exitPrice: trade.exitPrice,
          quantity: trade.quantity,
          pnl: trade.pnl,
          pnlPercent: trade.pnlPercent,
          fees: trade.fees,
          duration: trade.duration,
          durationMinutes: trade.duration ? Math.round(trade.duration / (1000 * 60)) : 'N/A',
          entryTime: new Date(trade.entryTime).toISOString(),
          exitTime: trade.exitTime ? new Date(trade.exitTime).toISOString() : 'N/A',
          tags: trade.tags
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
        
        const newState = {
          ...state,
          trades: updatedTrades,
          openTrades: remainingOpenTrades,
          symbolPerformance: updatedSymbolPerformance,
          strategyPerformance: updatedStrategyPerformance,
        };
        
        // Log des statistiques après la clôture
        logTradeStatistics(newState);
        
        return { 
          state: newState
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
        
        const newState = {
          ...state,
          priceHistory: updatedPriceHistory
        };
        
        // Log des positions ouvertes pour ce symbole avec le nouveau prix
        const symbolOpenTrades = Object.values(state.openTrades).filter(trade => trade.symbol === symbol);
        if (symbolOpenTrades.length > 0) {
          logger.debug(`💹 Mise à jour prix ${symbol}: ${price}`, {
            symbol,
            newPrice: price,
            timestamp: new Date(timestamp).toISOString(),
            openPositions: symbolOpenTrades.length
          });
          
          // Calculer et logger le PNL unrealized pour ce symbole
          symbolOpenTrades.forEach(trade => {
            if (trade.entryPrice) {
              const priceDiff = price - trade.entryPrice;
              const quantity = trade.quantity || 1;
              const multiplier = trade.entryOrder.side === 'BUY' ? 1 : -1;
              const unrealizedPnl = priceDiff * quantity * multiplier;
              
              logger.debug(`🔄 PNL unrealized ${trade.id}`, {
                tradeId: trade.id,
                symbol: trade.symbol,
                strategy: trade.strategyId,
                side: trade.entryOrder.side,
                entryPrice: trade.entryPrice,
                currentPrice: price,
                unrealizedPnl: unrealizedPnl.toFixed(2),
                unrealizedPnlPercent: ((unrealizedPnl / (trade.entryPrice * quantity)) * 100).toFixed(2)
              });
            }
          });
        }
        
        return { 
          state: newState
        };
      }
      
      case "LOG_POSITIONS_SUMMARY": {
        const { currentPrices } = payload;
        
        logger.info("📋 === RÉSUMÉ DES POSITIONS ===");
        
        // Log des statistiques générales
        logTradeStatistics(state);
        
        // Log des positions ouvertes avec PNL unrealized
        logOpenPositionsDetail(state, currentPrices);
        
        // Log des performances par stratégie
        Object.entries(state.strategyPerformance).forEach(([strategyId, performance]) => {
          logger.info(`📊 Performance stratégie ${strategyId}`, {
            strategy: strategyId,
            trades: performance.trades,
            winRate: (performance.winRate * 100).toFixed(1) + '%',
            netProfit: performance.netProfit.toFixed(2),
            active: performance.active,
            lastUpdated: new Date(performance.lastUpdated).toISOString()
          });
        });
        
        // Log des performances par symbole  
        Object.entries(state.symbolPerformance).forEach(([symbol, performance]) => {
          if (performance.trades > 0) {
            logger.info(`📈 Performance symbole ${symbol}`, {
              symbol,
              trades: performance.trades,
              winRate: (performance.winRate * 100).toFixed(1) + '%',
              netProfit: performance.netProfit.toFixed(2),
              winningTrades: performance.winningTrades,
              losingTrades: performance.losingTrades
            });
          }
        });
        
        logger.info("📋 === FIN RÉSUMÉ ===");
        
        return { state };
      }

      case "GET_ACCOUNT_METRICS": {
        logger.debug("Retour des métriques du compte");
        return { state };
      }
      
      case "GET_SYMBOL_PERFORMANCE": {
        const { symbol } = payload;
        logger.debug(`Retour de la performance pour le symbole : ${symbol}`);
        return { state };
      }
      
      case "GET_STRATEGY_PERFORMANCE": {
        const { strategyId } = payload;
        logger.debug(`Retour de la performance pour la stratégie : ${strategyId}`);
        return { state };
      }
      
      case "GET_TRADE_HISTORY": {
        const { filters } = payload;
        logger.debug("Retour de l'historique des trades filtré", filters);
        return { state };
      }
      
      case "GENERATE_PERFORMANCE_REPORT": {
        const { type, period = 'all' } = payload;
        logger.info(`Génération du rapport de performance ${type} pour la période : ${period}`);
        return { state };
      }
      
      case "UPDATE_CONFIG": {
        const { config } = payload;
        logger.info("⚙️ Mise à jour de la configuration du tracker de performance", {
          oldConfig: state.config,
          newConfigPart: config,
          mergedConfig: { ...state.config, ...config }
        });
        
        const newState = {
          ...state,
          config: {
            ...state.config,
            ...config
          }
        };
        
        // Log des statistiques après la mise à jour de config
        if (config.realTimeUpdates !== undefined || config.trackOpenPositions !== undefined) {
          logTradeStatistics(newState);
        }
        
        return { state: newState };
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