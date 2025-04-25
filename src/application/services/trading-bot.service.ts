import { ActorContext, ActorMessage } from "../../actor/models/actor.model";
import { createActorSystem } from "../../actor/system";
import { MarketDataPort } from "../ports/market-data.port";
import { TradingPort } from "../ports/trading.port";
import { StrategyService } from "../../domain/services/strategy.service";
import { Strategy } from "../../domain/models/strategy.model";
import { MarketData, Order } from "../../domain/models/market.model";

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

interface TradingBotService {
  start: () => void;
  stop: () => void;
  addStrategy: (strategy: Strategy) => void;
  removeStrategy: (strategyId: string) => void;
}

export const createTradingBotService = (
  marketDataPort: MarketDataPort, 
  tradingPort: TradingPort
): TradingBotService => {
  const actorSystem = createActorSystem();
  
  const initialState: TradingBotState = {
    isRunning: false,
    strategyService: new StrategyService(),
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
        console.log("Starting trading bot...");
        return { state: { ...state, isRunning: true } };
      }

      case "STOP": {
        console.log("Stopping trading bot...");
        return { state: { ...state, isRunning: false } };
      }

      case "ADD_STRATEGY": {
        const { strategy } = payload;
        console.log(`Adding strategy: ${strategy.getName()}`);
        
        state.strategyService.registerStrategy(strategy);
        
        // Extract symbol from strategy and subscribe to market data
        const symbol = (strategy.getConfig().parameters as Record<string, string>).symbol;
        if (symbol && !state.subscribedSymbols.has(symbol)) {
          await marketDataPort.subscribeToMarketData(symbol);
          state.subscribedSymbols.add(symbol);
        }
        
        return { state };
      }

      case "REMOVE_STRATEGY": {
        const { strategyId } = payload;
        console.log(`Removing strategy: ${strategyId}`);
        
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
            console.log(`Unsubscribed from symbol: ${strategySymbol}`);
          }
        }
        
        return { state };
      }

      case "MARKET_DATA": {
        if (!state.isRunning) return { state };
        
        const { data } = payload;
        
        // Process market data through all strategies
        const signals = await state.strategyService.processMarketData(data);
        
        // Handle strategy signals
        for (const [strategyId, signal] of Array.from(signals.entries())) {
          if (!signal) continue;
          
          console.log(`Signal from ${strategyId}: ${signal.type} ${signal.direction}`);
          
          const order = state.strategyService.generateOrder(strategyId, signal, data);
          if (order) {
            try {
              const placedOrder = await tradingPort.placeOrder(order);
              console.log(`Order placed: ${placedOrder.id} for ${order.symbol}, ${order.side} ${order.size} @ ${order.price || 'market'}`);
              
              state.orderHistory.push(placedOrder);
            } catch (error) {
              console.error(`Error placing order for ${order.symbol}: ${error instanceof Error ? error.message : String(error)}`);
              console.error(`Order details: ${JSON.stringify(order)}`);
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
