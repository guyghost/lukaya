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
        let pollingDelay = state.pollingInterval;
        
        try {
          // Get the latest market data
          const marketData = await marketDataPort.getLatestMarketData(state.symbol);
          
          if (!marketData) {
            logger.warn(`No data received for market ${state.symbol}`);
            pollingDelay = state.pollingInterval * 2; // Longer delay on empty data
          } else {
            logger.debug(`Data received for market ${state.symbol}`, { 
              actorId: context.self, 
              price: marketData.price, 
              bid: marketData.bid, 
              ask: marketData.ask,
              timestamp: marketData.timestamp
            });
            
            // Enrichir les données avec des métriques de polling
            const currentMetrics = marketData.metrics || {
              tickCount: 0,
              totalTickDuration: 0,
              errorCount: 0,
              lastTick: 0
            };
            
            const now = Date.now();
            const tickDuration = state.lastUpdated > 0 ? now - state.lastUpdated : 0;
            
            const enrichedData: MarketData = {
              ...marketData,
              metrics: {
                tickCount: currentMetrics.tickCount + 1,
                totalTickDuration: currentMetrics.totalTickDuration + tickDuration,
                errorCount: currentMetrics.errorCount,
                lastTick: now
              }
            };
            
            // If data has changed, notify the trading bot
            if (!state.lastData || 
                state.lastData.price !== marketData.price || 
                state.lastData.bid !== marketData.bid || 
                state.lastData.ask !== marketData.ask) {
              
              // Notify the trading bot
              onMarketData(enrichedData);
              
              logger.debug(`Updated market data for ${state.symbol}`, {
                price: marketData.price, 
                bid: marketData.bid, 
                ask: marketData.ask,
                avgPollingTime: enrichedData.metrics.totalTickDuration / enrichedData.metrics.tickCount
              });
            }
          }
          
          // Schedule next polling after the interval - using adaptive delay
          setTimeout(() => {
            if (state.isSubscribed) {
              context.send(context.self, { type: "POLL_DATA" });
            }
          }, pollingDelay);
          
          return { 
            state: { 
              ...state, 
              lastData: marketData || state.lastData, 
              lastUpdated: marketData ? Date.now() : state.lastUpdated 
            } 
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`Error polling market data for ${state.symbol}: ${errorMessage}`);
          
          // Update metrics to track errors
          const metrics = state.lastData?.metrics || {
            tickCount: 0,
            totalTickDuration: 0,
            errorCount: 0,
            lastTick: 0
          };
          
          metrics.errorCount++;
          
          // On error, retry after a longer interval
          setTimeout(() => {
            if (state.isSubscribed) {
              context.send(context.self, { type: "POLL_DATA" });
            }
          }, state.pollingInterval * 2);
          
          return { 
            state: {
              ...state,
              lastData: state.lastData ? {
                ...state.lastData,
                metrics
              } : null
            } 
          };
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