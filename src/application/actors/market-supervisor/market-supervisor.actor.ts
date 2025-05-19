import { ActorDefinition, ActorContext, ActorMessage, ActorAddress } from "../../../actor/models/actor.model";
import { 
  MarketSupervisorState, 
  MarketSupervisorMessage, 
  MarketSupervisorConfig,
  GetActiveMarketsResponse,
  HealthCheckResponse
} from "./market-supervisor.model";
import { MarketDataPort } from "../../ports/market-data.port";
import { getLogger } from "../../../infrastructure/logger";
import { createMarketActorDefinition } from "../market.actor";
import { MarketData } from "../../../domain/models/market.model";

// Valeurs par défaut pour la configuration du superviseur - Configuration plus agressive
const DEFAULT_CONFIG: MarketSupervisorConfig = {
  maxMarkets: 30, // Augmenté à 30 marchés pour plus d'opportunités de trading
  pollingInterval: 3000, // Réduit à 3 secondes pour des réactions plus rapides
  priceChangeThreshold: 0.3, // Réduit à 0.3% pour être notifié plus tôt des mouvements de prix
};

// Crée une définition d'acteur pour le superviseur de marché
export const createMarketSupervisorActorDefinition = (
  marketDataPort: MarketDataPort,
  actorSystem: any, // Le système d'acteurs pour créer les acteurs de marché
  config: Partial<MarketSupervisorConfig> = {}
): ActorDefinition<MarketSupervisorState, MarketSupervisorMessage> => {
  const logger = getLogger();
  
  // Fusionner la configuration par défaut avec celle fournie
  const mergedConfig: MarketSupervisorConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };
  
  // État initial du superviseur
  const initialState: MarketSupervisorState = {
    config: mergedConfig,
    marketActors: new Map<string, ActorAddress>(),
    lastMarketData: new Map<string, { price: number; timestamp: number }>(),
    subscribedSymbols: new Set<string>(),
  };
  
  // Handler pour les données de marché reçues d'un acteur individuel
  const onMarketDataReceived = (
    self: ActorAddress,
    data: MarketData
  ) => {
    // Envoyer les données au superviseur pour traitement et distribution
    actorSystem.send(self, {
      type: "MARKET_DATA_RECEIVED",
      symbol: data.symbol,
      price: data.price,
      timestamp: Date.now(),
    });
  };
  
  // Le comportement de l'acteur
  const behavior = async (
    state: MarketSupervisorState,
    message: ActorMessage<MarketSupervisorMessage>,
    context: ActorContext<MarketSupervisorState>
  ) => {
    const { payload } = message;
    
    switch (payload.type) {
      case "ADD_MARKET": {
        const { symbol } = payload;
        
        // Vérifier si on a déjà un acteur pour ce marché
        if (state.marketActors.has(symbol)) {
          logger.debug(`Market actor for ${symbol} already exists`);
          return { state };
        }
        
        // Vérifier la limite de marchés
        if (state.marketActors.size >= state.config.maxMarkets) {
          logger.warn(`Cannot add market ${symbol}: maximum number of markets (${state.config.maxMarkets}) reached`);
          return { state };
        }
        
        // Créer un acteur de marché pour ce symbole
        logger.info(`Creating market actor for ${symbol}`);
        
        // Créer une fonction callback qui envoie les données de marché au superviseur
        const marketDataCallback = (data: MarketData) => {
          onMarketDataReceived(context.self, data);
        };
        
        // Créer l'acteur de marché
        const marketActorDef = createMarketActorDefinition(
          symbol,
          marketDataPort,
          marketDataCallback,
          state.config.pollingInterval
        );
        
        // Ajouter l'acteur au système
        const marketActorAddress = actorSystem.createActor(marketActorDef);
        
        // Mettre à jour l'état avec le nouvel acteur
        const updatedMarketActors = new Map(state.marketActors);
        updatedMarketActors.set(symbol, marketActorAddress);
        
        // S'abonner si le superviseur est déjà abonné
        if (state.subscribedSymbols.has(symbol)) {
          actorSystem.send(marketActorAddress, { type: "SUBSCRIBE", symbol });
        }
        
        return {
          state: {
            ...state,
            marketActors: updatedMarketActors,
          },
        };
      }
      
      case "REMOVE_MARKET": {
        const { symbol } = payload;
        
        // Vérifier si on a un acteur pour ce marché
        if (!state.marketActors.has(symbol)) {
          logger.debug(`No market actor for ${symbol} exists`);
          return { state };
        }
        
        // Récupérer l'adresse de l'acteur
        const actorAddress = state.marketActors.get(symbol)!;
        
        // Désabonner d'abord
        actorSystem.send(actorAddress, { type: "UNSUBSCRIBE" });
        
        // Arrêter l'acteur
        actorSystem.stop(actorAddress);
        
        // Mettre à jour l'état
        const updatedMarketActors = new Map(state.marketActors);
        updatedMarketActors.delete(symbol);
        
        // Mettre à jour les symboles abonnés
        const updatedSubscribedSymbols = new Set(state.subscribedSymbols);
        updatedSubscribedSymbols.delete(symbol);
        
        // Mettre à jour les dernières données
        const updatedLastMarketData = new Map(state.lastMarketData);
        updatedLastMarketData.delete(symbol);
        
        logger.info(`Removed market actor for ${symbol}`);
        
        return {
          state: {
            ...state,
            marketActors: updatedMarketActors,
            subscribedSymbols: updatedSubscribedSymbols,
            lastMarketData: updatedLastMarketData,
          },
        };
      }
      
      case "SUBSCRIBE_ALL": {
        logger.info(`Subscribing to all ${state.marketActors.size} markets`);
        
        // Abonner tous les acteurs de marché
        for (const [symbol, actorAddress] of state.marketActors.entries()) {
          actorSystem.send(actorAddress, { type: "SUBSCRIBE", symbol });
          
          // Ajouter à l'ensemble des symboles abonnés
          state.subscribedSymbols.add(symbol);
        }
        
        return { state };
      }
      
      case "UNSUBSCRIBE_ALL": {
        logger.info(`Unsubscribing from all ${state.subscribedSymbols.size} markets`);
        
        // Désabonner tous les acteurs de marché
        for (const [symbol, actorAddress] of state.marketActors.entries()) {
          if (state.subscribedSymbols.has(symbol)) {
            actorSystem.send(actorAddress, { type: "UNSUBSCRIBE" });
          }
        }
        
        return {
          state: {
            ...state,
            subscribedSymbols: new Set(),
          },
        };
      }
      
      case "UPDATE_CONFIG": {
        const { config } = payload;
        
        // Mettre à jour la configuration
        const updatedConfig = {
          ...state.config,
          ...config,
        };
        
        logger.info(`Updated market supervisor config: ${JSON.stringify(updatedConfig)}`);
        
        return {
          state: {
            ...state,
            config: updatedConfig,
          },
        };
      }
      
      case "MARKET_DATA_RECEIVED": {
        const { symbol, price, timestamp } = payload;
        
        // Obtenir la dernière donnée connue pour ce symbole
        const lastData = state.lastMarketData.get(symbol);
        
        // Calculer le pourcentage de changement si on a des données précédentes
        let percentChange = 0;
        if (lastData) {
          percentChange = ((price - lastData.price) / lastData.price) * 100;
        }
        
        // Mettre à jour les dernières données
        const updatedLastMarketData = new Map(state.lastMarketData);
        updatedLastMarketData.set(symbol, { price, timestamp });
        
        // Log détaillé pour les changements significatifs
        if (Math.abs(percentChange) >= state.config.priceChangeThreshold) {
          logger.info(
            `[MARKET_SUPERVISOR] Significant price change for ${symbol}: ${price} (${percentChange.toFixed(2)}%), timestamp: ${new Date(timestamp).toISOString()}`
          );
        } else {
          logger.debug(`[MARKET_SUPERVISOR] Market data received for ${symbol}: ${price}, timestamp: ${new Date(timestamp).toISOString()}`);
        }
        
        // Log des statistiques de marché (toutes les X mises à jour)
        if (timestamp % 30000 < 3000) { // Log environ toutes les 30 secondes
          const activeMarkets = state.subscribedSymbols.size;
          const dataPoints = state.lastMarketData.size;
          logger.info(`[MARKET_SUPERVISOR] Stats: Monitoring ${activeMarkets} active markets, ${dataPoints} markets with data points`);
        }
        
        // Retourner l'état mis à jour
        return {
          state: {
            ...state,
            lastMarketData: updatedLastMarketData,
          },
        };
      }
      
      case "GET_ACTIVE_MARKETS": {
        // Répondre avec la liste des marchés actifs
        const response: GetActiveMarketsResponse = {
          markets: Array.from(state.subscribedSymbols),
          activeCount: state.subscribedSymbols.size,
        };
        
        // Logique pour répondre au message (utilise normalement le pattern Ask)
        logger.debug(`Returning active markets info: ${response.activeCount} markets`);
        
        // Dans un système réel, on utiliserait context.reply() pour répondre
        
        return { state };
      }
      
      case "CHECK_HEALTH": {
        // Vérifier l'état de santé du système
        const now = Date.now();
        const issues: string[] = [];
        
        // Construire le rapport d'état
        const lastUpdates: Record<string, number> = {};
        
        // Vérifier les mises à jour récentes
        for (const [symbol, data] of state.lastMarketData.entries()) {
          lastUpdates[symbol] = data.timestamp;
          
          // Vérifier si la dernière mise à jour est trop ancienne (> 2x polling interval)
          const ageMs = now - data.timestamp;
          if (ageMs > state.config.pollingInterval * 2) {
            issues.push(
              `Market ${symbol} data is stale (${Math.round(ageMs / 1000)}s old)`
            );
          }
        }
        
        // Vérifier les symboles abonnés sans données
        for (const symbol of state.subscribedSymbols) {
          if (!state.lastMarketData.has(symbol)) {
            issues.push(`No data received yet for subscribed market ${symbol}`);
          }
        }
        
        // Déterminer le statut global
        let status: "healthy" | "degraded" | "unhealthy" = "healthy";
        
        if (issues.length > 0) {
          status = issues.length < state.subscribedSymbols.size / 3 
            ? "degraded" 
            : "unhealthy";
        }
        
        // Créer la réponse
        const healthResponse: HealthCheckResponse = {
          status,
          activeMarkets: state.subscribedSymbols.size,
          lastUpdates,
          ...(issues.length > 0 && { issues }),
        };
        
        logger.debug(`Health check: ${status} with ${issues.length} issues`);
        
        // Dans un système réel, on utiliserait context.reply() pour répondre
        
        return { state };
      }
      
      default:
        return { state };
    }
  };
  
  // Retourner la définition de l'acteur
  return {
    initialState,
    behavior: behavior as any, // Type assertion to fix Set<unknown> vs Set<string> issue
    supervisorStrategy: { type: "restart" },
  };
};
