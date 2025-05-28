import {
  ActorContext,
  ActorMessage,
  ActorAddress,
  ActorDefinition,
} from "../../actor/models/actor.model";
import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";
import { Strategy, StrategySignal } from "../../domain/models/strategy.model";
import { MarketData } from "../../domain/models/market.model";

export type StrategyActorMessage =
  | { type: "PROCESS_MARKET_DATA"; data: MarketData; tradingBotActorAddress: ActorAddress }
  | { type: "UPDATE_CONFIG"; config: Record<string, unknown> }
  | { type: "GET_STATUS" };

export interface StrategyActorState {
  strategy: Strategy;
  lastProcessedData: MarketData | null;
  lastSignal: StrategySignal | null;
  signalCount: number;
  strategyManagerAddress: ActorAddress | null;
  active: boolean;
}

export const createStrategyActorDefinition = (
  strategy: Strategy,
  strategyManagerAddress: ActorAddress | null = null,
): ActorDefinition<StrategyActorState, StrategyActorMessage> => {
  const strategyId = strategy.getId();
  const logger = createContextualLogger(`StrategyActor-${strategyId}`);

  // État initial
  const initialState: StrategyActorState = {
    strategy,
    lastProcessedData: null,
    lastSignal: null,
    signalCount: 0,
    strategyManagerAddress,
    active: true
  };

  // Initialisation du comportement de l'acteur
  const behavior = async (
    state: StrategyActorState,
    message: ActorMessage<StrategyActorMessage>,
    context: ActorContext<StrategyActorState>
  ) => {
    const { payload } = message;

    switch (payload.type) {
      case "PROCESS_MARKET_DATA": {
        if (!state.active) {
          return { state };
        }

        const { data, tradingBotActorAddress } = payload;
        const symbol = (strategy.getConfig().parameters as any).symbol || '';
        
        // Vérifier que les données correspondent au symbole de la stratégie
        if (data.symbol !== symbol) {
          return { state };
        }
        
        try {
          logger.debug(`[Acteur de stratégie ${strategyId}] Traitement des données de marché pour ${data.symbol}`);
          
          // Traiter les données avec la stratégie
          const signal = await state.strategy.processMarketData(data);
          
          // Si un signal est généré et que nous avons une référence au gestionnaire de stratégie, transmettre le signal
          if (signal && state.strategyManagerAddress) {
            logger.info(`[Acteur de stratégie ${strategyId}] Signal généré ${signal.type}/${signal.direction} pour ${data.symbol}`);
            
            // Envoyer le signal au Strategy Manager
            context.send(state.strategyManagerAddress, {
              type: "STRATEGY_SIGNAL",
              strategyId,
              signal,
              symbol: data.symbol,
              timestamp: Date.now(),
              tradingBotActorAddress
            });
            
            // Mettre à jour l'état
            return {
              state: {
                ...state,
                lastProcessedData: data,
                lastSignal: signal,
                signalCount: state.signalCount + 1
              }
            };
          }
          
          // Mettre à jour l'état même si aucun signal n'est généré
          return {
            state: {
              ...state,
              lastProcessedData: data,
              lastSignal: signal || state.lastSignal
            }
          };
        } catch (error) {
          logger.error(`[Acteur de stratégie ${strategyId}] Erreur lors du traitement des données de marché :`, error as Error);
          return { state };
        }
      }
      
      case "UPDATE_CONFIG": {
        const { config } = payload;
        logger.debug(`[Acteur de stratégie ${strategyId}] Mise à jour de la configuration`);
        
        // Dans un cas réel, nous mettrions à jour la configuration de la stratégie ici
        // Pour l'instant, nous ne faisons que mettre à jour l'état active
        return {
          state: {
            ...state,
            active: config.active !== undefined ? !!config.active : state.active
          }
        };
      }
      
      case "GET_STATUS": {
        // Cette méthode pourrait retourner des informations sur l'état actuel de la stratégie
        // Dans le contexte actuel, nous ne faisons rien de spécial ici car aucune réponse n'est gérée
        return { state };
      }
      
      default: {
        logger.warn(`[Acteur de stratégie ${strategyId}] Type de message inconnu : ${(payload as any).type}`);
        return { state };
      }
    }
  };
  
  return {
    behavior,
    initialState,
    supervisorStrategy: { type: "restart" }
  };
};
