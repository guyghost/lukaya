import { ActorContext, ActorMessage } from "../../actor/models/actor.model";
import { createActorSystem } from "../../actor/system";
import { MarketDataPort } from "../../application/ports/market-data.port";
import { TradingPort } from "../../application/ports/trading.port";
import { createStrategyService, StrategyService } from "../../domain/services/strategy.service";
import { Strategy } from "../../domain/models/strategy.model";
import { MarketData, Order } from "../../domain/models/market.model";
import { getLogger } from "../../infrastructure/logger";

type TradingBotMessage = 
  | { type: "START" }
  | { type: "STOP" }
  | { type: "ADD_STRATEGY", strategy: Strategy }
  | { type: "REMOVE_STRATEGY", strategyId: string }
  | { type: "MARKET_DATA", data: MarketData };

interface TradingBotState {
  isRunning: boolean;
  strategyService: StrategyService;
  subscribedSymbols: Set<string>;
  orderHistory: Order[];
}

export interface TradingBotService {
  start: () => void;
  stop: () => void;
  addStrategy: (strategy: Strategy) => void;
  removeStrategy: (strategyId: string) => void;
}

export const createTradingBotService = (
  marketDataPort: MarketDataPort, 
  tradingPort: TradingPort
): TradingBotService => {
  const logger = getLogger();
  const actorSystem = createActorSystem();
  
  const initialState: TradingBotState = {
    isRunning: false,
    strategyService: createStrategyService(),
    subscribedSymbols: new Set(),
    orderHistory: [],
  };

  // Handler for actor messages
  const tradingBotBehavior = async (
    state: TradingBotState,
    message: ActorMessage<TradingBotMessage>,
    context: ActorContext<TradingBotState>
  ) => {
    const payload = message.payload;

    switch (payload.type) {
      case "START": {
        logger.info("Starting trading bot...");
        return { state: { ...state, isRunning: true } };
      }

      case "STOP": {
        logger.info("Stopping trading bot...");
        return { state: { ...state, isRunning: false } };
      }

      case "ADD_STRATEGY": {
        const { strategy } = payload;
        logger.info(`Adding strategy: ${strategy.getName()}`);
        
        state.strategyService.registerStrategy(strategy);
        
        // Extract symbol from strategy and subscribe to market data
        const symbol = (strategy.getConfig().parameters as Record<string, string>).symbol;
        if (symbol && !state.subscribedSymbols.has(symbol)) {
          await marketDataPort.subscribeToMarketData(symbol);
          state.subscribedSymbols.add(symbol);
          logger.debug(`Subscribed to market data for symbol: ${symbol}`);
        }
        
        return { state };
      }

      case "REMOVE_STRATEGY": {
        const { strategyId } = payload;
        logger.info(`Removing strategy: ${strategyId}`);
        
        // Get the strategy before removing it to check its symbol
        const strategy = state.strategyService.getStrategy(strategyId);
        const strategySymbol = strategy 
          ? (strategy.getConfig().parameters as Record<string, string>).symbol 
          : undefined;
        
        state.strategyService.unregisterStrategy(strategyId);
        
        // Check if we need to unsubscribe from the symbol
        if (strategySymbol) {
          const stillInUse = state.strategyService.getAllStrategies().some(s => 
            (s.getConfig().parameters as Record<string, string>).symbol === strategySymbol
          );
          
          if (!stillInUse) {
            await marketDataPort.unsubscribeFromMarketData(strategySymbol);
            state.subscribedSymbols.delete(strategySymbol);
            logger.debug(`Unsubscribed from symbol: ${strategySymbol}`);
          }
        }
        
        return { state };
      }

      case "MARKET_DATA": {
        if (!state.isRunning) return { state };
        
        const { data } = payload;
        logger.debug(`Received market data for ${data.symbol}: ${data.price}`);
        
        // Process market data through all strategies
        const signals = await state.strategyService.processMarketData(data);
        
        // Handle strategy signals
        for (const [strategyId, signal] of Array.from(signals.entries())) {
          if (!signal) continue;
          
          logger.info(`Signal from ${strategyId}: ${signal.type} ${signal.direction} @ ${signal.price}`);
          
          const order = state.strategyService.generateOrder(strategyId, signal, data);
          if (order) {
            try {
              const placedOrder = await tradingPort.placeOrder(order);
              logger.info(`Order placed: ${placedOrder.id} for ${order.symbol}, ${order.side} ${order.size} @ ${order.price || 'market'}`);
              
              state.orderHistory.push(placedOrder);
            } catch (error) {
              logger.error(`Error placing order for ${order.symbol}`, error as Error, {
                order: JSON.stringify(order)
              });
            }
          }
        }
        
        return { state };
      }

      default:
        return { state };
    }
  };
  
  // Create the actor
  const botAddress = actorSystem.createActor({
    initialState,
    behavior: tradingBotBehavior,
    supervisorStrategy: { type: "restart" },
  });

  // Set up market data polling for subscribed symbols
  const pollMarketData = async () => {
    if (!initialState.isRunning) return;
    
    // For each subscribed symbol, get the latest data and process it
    for (const symbol of initialState.subscribedSymbols) {
      try {
        const marketData = await marketDataPort.getLatestMarketData(symbol);
        actorSystem.send(botAddress, { type: "MARKET_DATA", data: marketData });
      } catch (error) {
        logger.error(`Error polling market data for ${symbol}`, error as Error);
      }
    }
    
    // Schedule next polling
    setTimeout(pollMarketData, 5000); // Poll every 5 seconds
  };

  // Public API methods
  const start = (): void => {
    actorSystem.send(botAddress, { type: "START" });
    // Start market data polling
    pollMarketData();
  };

  const stop = (): void => {
    actorSystem.send(botAddress, { type: "STOP" });
  };

  const addStrategy = (strategy: Strategy): void => {
    actorSystem.send(botAddress, { 
      type: "ADD_STRATEGY", 
      strategy 
    });
  };

  const removeStrategy = (strategyId: string): void => {
    actorSystem.send(botAddress, { 
      type: "REMOVE_STRATEGY", 
      strategyId 
    });
  };

  // Return the public API
  return {
    start,
    stop,
    addStrategy,
    removeStrategy
  };
};