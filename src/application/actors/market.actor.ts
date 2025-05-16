import { ActorContext, ActorMessage, ActorDefinition } from "../../actor/models/actor.model";
import { MarketDataPort } from "../ports/market-data.port";
import { MarketData } from "../../domain/models/market.model";
import { getLogger } from "../../infrastructure/logger";

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
  priceHistory: number[];
}

// Helper function to calculate standard deviation
const calculateStandardDeviation = (data: number[]): number => {
  const mean = data.reduce((acc, val) => acc + val, 0) / data.length;
  const variance = data.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / data.length;
  return Math.sqrt(variance);
};

// Create a definition for a market actor
export const createMarketActorDefinition = (
  symbol: string,
  marketDataPort: MarketDataPort,
  onMarketData: (data: MarketData) => void,
  pollingInterval: number = 5000,
): ActorDefinition<MarketActorState, MarketActorMessage> => {
  const logger = getLogger();
  
  // Initial state for the actor
  const initialState: MarketActorState = {
    symbol,
    isSubscribed: false,
    lastData: null,
    lastUpdated: 0,
    pollingInterval,
    priceHistory: [],
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
        
        try {
          // Get the latest market data
          const marketData = await marketDataPort.getLatestMarketData(state.symbol);
          
          // If data has changed, notify the trading bot
          if (!state.lastData || 
              state.lastData.price !== marketData.price || 
              state.lastData.bid !== marketData.bid || 
              state.lastData.ask !== marketData.ask) {
            
            // Notify the trading bot
            onMarketData(marketData);
            
            logger.debug(`Updated market data for ${state.symbol}: price=${marketData.price}, bid=${marketData.bid}, ask=${marketData.ask}`);
          }
          
          // Update price history
          const updatedPriceHistory = [...state.priceHistory, marketData.price].slice(-100); // Keep last 100 prices
          
          // Calculate volatility (standard deviation of price changes)
          const priceChanges = updatedPriceHistory.slice(1).map((price, index) => price - updatedPriceHistory[index]);
          const volatility = calculateStandardDeviation(priceChanges);
          
          // Adjust polling interval based on volatility
          const minPollingInterval = 1000; // 1 second
          const maxPollingInterval = 10000; // 10 seconds
          const adjustedPollingInterval = Math.max(minPollingInterval, Math.min(maxPollingInterval, pollingInterval / (volatility || 1)));
          
          // Schedule next polling after the adjusted interval
          setTimeout(() => {
            if (state.isSubscribed) {
              context.send(context.self, { type: "POLL_DATA" });
            }
          }, adjustedPollingInterval);
          
          return { 
            state: { 
              ...state, 
              lastData: marketData, 
              lastUpdated: Date.now(),
              priceHistory: updatedPriceHistory,
              pollingInterval: adjustedPollingInterval,
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
