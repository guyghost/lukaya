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
}

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
        logger.info(`[MARKET_ACTOR] Received SUBSCRIBE message for ${state.symbol}`);
        
        if (state.isSubscribed) {
          logger.info(`[MARKET_ACTOR] Market ${state.symbol} already subscribed, refreshing subscription`);
          // Même si déjà abonné, on va quand même rafraîchir la souscription
        } else {
          logger.info(`[MARKET_ACTOR] Subscribing to market data for ${state.symbol}`);
        }
        
        try {
          // Subscribe to market data - toujours appeler même si déjà abonné pour s'assurer que le polling est actif
          await marketDataPort.subscribeToMarketData(state.symbol);
          
          // Schedule the first polling immédiatement
          context.send(context.self, { type: "POLL_DATA" });
          
          // Programmer une autre vérification après 10 secondes pour s'assurer que le polling continue
          setTimeout(() => {
            if (state.isSubscribed) {
              logger.info(`[MARKET_ACTOR] Verification polling check for ${state.symbol}`);
              context.send(context.self, { type: "POLL_DATA" });
            }
          }, 10000);
          
          return { 
            state: { 
              ...state, 
              isSubscribed: true 
            } 
          };
        } catch (error) {
          logger.error(`[MARKET_ACTOR] Failed to subscribe to market ${state.symbol}`, error as Error);
          
          // Programme un nouvel essai après un délai
          setTimeout(() => {
            logger.info(`[MARKET_ACTOR] Retrying subscription for ${state.symbol}`);
            context.send(context.self, { type: "SUBSCRIBE", symbol: state.symbol });
          }, 30000);
          
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
        logger.debug(`[MARKET_ACTOR] Processing POLL_DATA for ${state.symbol}`);
        
        if (!state.isSubscribed) {
          logger.warn(`[MARKET_ACTOR] Received POLL_DATA but ${state.symbol} is not subscribed. Re-subscribing...`);
          context.send(context.self, { type: "SUBSCRIBE", symbol: state.symbol });
          return { state };
        }
        
        try {
          // Get the latest market data
          logger.debug(`[MARKET_ACTOR] Requesting latest data for ${state.symbol}`);
          const marketData = await marketDataPort.getLatestMarketData(state.symbol);
          
          if (!marketData || marketData.price === 0) {
            logger.warn(`[MARKET_ACTOR] Received invalid market data for ${state.symbol}, will retry soon`);
            setTimeout(() => {
              if (state.isSubscribed) {
                context.send(context.self, { type: "POLL_DATA" });
              }
            }, 2000);
            return { state };
          }
          
          // If data has changed, notify the trading bot
          if (!state.lastData || 
              state.lastData.price !== marketData.price || 
              state.lastData.bid !== marketData.bid || 
              state.lastData.ask !== marketData.ask) {
            
            // Notify the trading bot
            onMarketData(marketData);
            
            logger.info(`[MARKET_ACTOR] Market data updated for ${state.symbol}: price=${marketData.price}, bid=${marketData.bid}, ask=${marketData.ask}`);
          }
          
          // Schedule next polling after the interval - toujours programmer le prochain poll
          setTimeout(() => {
            if (state.isSubscribed) {
              context.send(context.self, { type: "POLL_DATA" });
            } else {
              logger.warn(`[MARKET_ACTOR] Not scheduling next poll because ${state.symbol} is no longer subscribed`);
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
          logger.error(`[MARKET_ACTOR] Error polling market data for ${state.symbol}`, error as Error);
          
          // On error, retry after a shorter interval for faster recovery
          const retryDelay = Math.min(state.pollingInterval, 3000); // Maximum 3 secondes de délai
          
          logger.info(`[MARKET_ACTOR] Will retry polling for ${state.symbol} in ${retryDelay/1000} seconds`);
          setTimeout(() => {
            if (state.isSubscribed) {
              context.send(context.self, { type: "POLL_DATA" });
            }
          }, retryDelay);
          
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