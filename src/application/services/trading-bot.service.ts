import { ActorContext, ActorMessage, ActorAddress } from "../../actor/models/actor.model";
import { createActorSystem } from "../../actor/system";
import { MarketDataPort } from "../ports/market-data.port";
import { TradingPort } from "../ports/trading.port";
import { createStrategyService, StrategyService } from "../../domain/services/strategy.service";
import { Strategy } from "../../domain/models/strategy.model";
import { MarketData, Order } from "../../domain/models/market.model";
import { getLogger } from "../../infrastructure/logger";
import { createMarketActorDefinition } from "../actors/market.actor";

type TradingBotMessage = 
  | { type: "START" }
  | { type: "STOP" }
  | { type: "ADD_STRATEGY"; strategy: Strategy }
  | { type: "REMOVE_STRATEGY"; strategyId: string }
  | { type: "MARKET_DATA"; data: MarketData }
  | { type: "ORDER_PLACED"; order: Order };

interface TradingBotState {
  isRunning: boolean;
  strategyService: StrategyService;
  marketActors: Map<string, ActorAddress>;
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
  tradingPort: TradingPort,
  options = { pollInterval: 5000 }
): TradingBotService => {
  const logger = getLogger();
  const actorSystem = createActorSystem();
  
  const initialState: TradingBotState = {
    isRunning: false,
    strategyService: createStrategyService(),
    marketActors: new Map(),
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
        
        // Start all existing market actors if they exist
        for (const [symbol, actorAddress] of state.marketActors.entries()) {
          actorSystem.send(actorAddress, { type: "SUBSCRIBE", symbol });
        }
        
        return { state: { ...state, isRunning: true } };
      }

      case "STOP": {
        logger.info("Stopping trading bot...");
        
        // Stop all market actors
        for (const [symbol, actorAddress] of state.marketActors.entries()) {
          actorSystem.send(actorAddress, { type: "UNSUBSCRIBE" });
        }
        
        return { state: { ...state, isRunning: false } };
      }

      case "ADD_STRATEGY": {
        const { strategy } = payload;
        logger.info(`Adding strategy: ${strategy.getName()}`);
        
        // Register the strategy
        state.strategyService.registerStrategy(strategy);
        
        // Extract symbol from strategy and create/start market actor if needed
        // Each symbol has its own market actor that publishes market data
        const symbol = (strategy.getConfig().parameters as Record<string, string>).symbol;
        if (symbol) {
          if (!state.marketActors.has(symbol)) {
            // Create a market actor for this symbol if it doesn't exist
            // This allows multiple strategies to use the same market data for a symbol
            const onMarketData = (data: MarketData) => {
              actorSystem.send(context.self, { type: "MARKET_DATA", data });
            };
            
            const marketActorDef = createMarketActorDefinition(
              symbol, 
              marketDataPort, 
              onMarketData, 
              options.pollInterval
            );
            
            const marketActorAddress = actorSystem.createActor(marketActorDef);
            state.marketActors.set(symbol, marketActorAddress);
            
            // If the bot is running, subscribe to the market immediately
            if (state.isRunning) {
              actorSystem.send(marketActorAddress, { type: "SUBSCRIBE", symbol });
            }
            
            logger.debug(`Created market actor for symbol: ${symbol}`);
          } else {
            logger.debug(`Using existing market actor for symbol: ${symbol}`);
          }
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
        
        // Unregister the strategy
        state.strategyService.unregisterStrategy(strategyId);
        
        // Check if any other strategies are using this symbol
        if (strategySymbol) {
          const stillInUse = state.strategyService.getAllStrategies().some(s => 
            (s.getConfig().parameters as Record<string, string>).symbol === strategySymbol
          );
          
          if (!stillInUse && state.marketActors.has(strategySymbol)) {
            // If no other strategies are using this symbol, unsubscribe and remove the market actor
            const actorAddress = state.marketActors.get(strategySymbol)!;
            
            // Unsubscribe from the market
            actorSystem.send(actorAddress, { type: "UNSUBSCRIBE" });
            
            // Stop the actor
            actorSystem.stop(actorAddress);
            
            // Remove from our map
            state.marketActors.delete(strategySymbol);
            
            logger.debug(`Removed market actor for symbol: ${strategySymbol}`);
          }
        }
        
        return { state };
      }

      case "MARKET_DATA": {
        if (!state.isRunning) return { state };
        
        const { data } = payload;
        logger.debug(`Processing market data for ${data.symbol}: ${data.price}`);
        
        // Process market data through all strategies
        // This will automatically filter and apply only to strategies configured for this symbol
        const signals = await state.strategyService.processMarketData(data);
        
        // Handle strategy signals for this particular symbol
        for (const [strategyId, signal] of Array.from(signals.entries())) {
          if (!signal) continue;
          
          logger.info(`Signal from ${strategyId}: ${signal.type} ${signal.direction} @ ${signal.price || data.price}`);
          
          // Generate order for the specific strategy that produced the signal
          const order = state.strategyService.generateOrder(strategyId, signal, data);
          if (order) {
            try {
              const placedOrder = await tradingPort.placeOrder(order);
              logger.info(`Order placed: ${placedOrder.id} for ${order.symbol}, ${order.side} ${order.size} @ ${order.price || 'market'}`);
              
              // Send order placed message to self to update state
              context.send(context.self, { 
                type: "ORDER_PLACED", 
                order: placedOrder 
              });
            } catch (error) {
              logger.error(`Error placing order for ${order.symbol}`, error as Error, {
                order: JSON.stringify(order)
              });
            }
          }
        }
        
        return { state };
      }
      
      case "ORDER_PLACED": {
        // Add the order to history
        const { order } = payload;
        state.orderHistory.push(order);
        
        // Keep only the last 100 orders (optional)
        if (state.orderHistory.length > 100) {
          state.orderHistory = state.orderHistory.slice(-100);
        }
        
        return { state };
      }

      default:
        return { state };
    }
  };
  
  // Create the main bot actor that will manage all strategies and market actors
  // The trading bot actor coordinates all the market data and strategy signals
  const botAddress = actorSystem.createActor({
    initialState,
    behavior: tradingBotBehavior,
    supervisorStrategy: { type: "restart" },
  });

  // Public API methods
  const start = (): void => {
    actorSystem.send(botAddress, { type: "START" });
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