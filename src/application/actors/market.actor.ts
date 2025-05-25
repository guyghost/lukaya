import { ActorContext, ActorMessage, ActorDefinition } from "../../actor/models/actor.model";
import { MarketDataPort } from "../ports/market-data.port";
import { MarketData } from "../../domain/models/market.model";
import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";

// Messages that a market actor can handle
type MarketActorMessage = 
  | { type: "SUBSCRIBE"; symbol: string }
  | { type: "UNSUBSCRIBE" }
  | { type: "POLL_DATA" };

// State of the market actor
interface MarketActorState {
  symbol: string;
  isSubscribed: boolean;
  lastData: MarketData | null;
  lastUpdated: number;
  pollingInterval: number;
}

// Create a definition for a market actor
export const createMarketActorDefinition = (
  symbol: string,
  marketDataPort: MarketDataPort,
  onMarketData: (data: MarketData) => void,
  pollingInterval: number = 5000,
): ActorDefinition<MarketActorState, MarketActorMessage> => {
  const logger = createContextualLogger("MarketActor");
  
  // Initial state for the actor
  const initialState: MarketActorState = {
    symbol,
    isSubscribed: false,
    lastData: null,
    lastUpdated: 0,
    pollingInterval,
  };
  
  // The behavior that defines how the actor reacts to messages
  const behavior = async (
    state: MarketActorState,
    message: ActorMessage<MarketActorMessage>,
    context: ActorContext<MarketActorState>
  ) => {
    const { payload } = message;
    
    switch (payload.type) {
      case "SUBSCRIBE": {
        if (state.isSubscribed) {
          logger.debug(`Market ${state.symbol} already subscribed`);
          return { state };
        }
        
        logger.info(`Subscribing to market data for ${state.symbol}`);
        
        try {
          // Subscribe to market data
          await marketDataPort.subscribeToMarketData(state.symbol);
          
          // Schedule the first polling
          context.send(context.self, { type: "POLL_DATA" });
          
          return { 
            state: { 
              ...state, 
              isSubscribed: true 
            } 
          };
        } catch (error) {
          logger.error(`Failed to subscribe to market ${state.symbol}`, error as Error);
          return { state };
        }
      }
      
      case "UNSUBSCRIBE": {
        if (!state.isSubscribed) {
          return { state };
        }
        
        logger.info(`Unsubscribing from market data for ${state.symbol}`);
        
        try {
          await marketDataPort.unsubscribeFromMarketData(state.symbol);
          
          return { 
            state: { 
              ...state, 
              isSubscribed: false 
            } 
          };
        } catch (error) {
          logger.error(`Failed to unsubscribe from market ${state.symbol}`, error as Error);
          return { state };
        }
      }
      
      case "POLL_DATA": {
        if (!state.isSubscribed) {
          return { state };
        }
        
        logger.debug(`Polling data for market ${state.symbol}`, { actorId: context.self });
        try {
          // Get the latest market data
          const marketData = await marketDataPort.getLatestMarketData(state.symbol);
          logger.debug(`Data received for market ${state.symbol} : ${JSON.stringify(marketData)}`, { actorId: context.self, price: marketData.price, bid: marketData.bid, ask: marketData.ask });
          
          // If data has changed, notify the trading bot
          if (!state.lastData || 
              state.lastData.price !== marketData.price || 
              state.lastData.bid !== marketData.bid || 
              state.lastData.ask !== marketData.ask) {
            
            // Notify the trading bot
            onMarketData(marketData);
            
            logger.debug(`Updated market data for ${state.symbol} (price=${marketData.price}, bid=${marketData.bid}, ask=${marketData.ask}): ${JSON.stringify(marketData)}`);
          }
          
          // Schedule next polling after the interval
          setTimeout(() => {
            if (state.isSubscribed) {
              context.send(context.self, { type: "POLL_DATA" });
            }
          }, state.pollingInterval);
          
          return { 
            state: { 
              ...state, 
              lastData: marketData, 
              lastUpdated: Date.now() 
            } 
          };
        } catch (error) {
          logger.error(`Error polling market data for ${state.symbol}`, error as Error);
          
          // On error, retry after a longer interval
          setTimeout(() => {
            if (state.isSubscribed) {
              context.send(context.self, { type: "POLL_DATA" });
            }
          }, state.pollingInterval * 2);
          
          return { state };
        }
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