import { ActorAddress } from "../../../actor/models/actor.model";

// Configuration pour le superviseur de marché
export interface MarketSupervisorConfig {
  // Nombre maximum de marchés à surveiller simultanément
  maxMarkets: number;
  // Intervalle de polling pour les données de marché (en ms)
  pollingInterval: number;
  // Seuil de changement de prix (en %) qui déclenche une notification immédiate
  priceChangeThreshold: number;
}

// État du superviseur de marché
export interface MarketSupervisorState {
  // Configuration
  config: MarketSupervisorConfig;
  // Adresses des acteurs de marché individuels
  marketActors: Map<string, ActorAddress>;
  // Dernières données connues pour chaque marché
  lastMarketData: Map<string, { price: number; timestamp: number }>;
  // État d'abonnement pour chaque symbole
  subscribedSymbols: Set<string>;
}

// Messages qui peuvent être traités par le superviseur de marché
export type MarketSupervisorMessage =
  | { type: "ADD_MARKET"; symbol: string }
  | { type: "REMOVE_MARKET"; symbol: string }
  | { type: "SUBSCRIBE_ALL" }
  | { type: "UNSUBSCRIBE_ALL" }
  | { type: "UPDATE_CONFIG"; config: Partial<MarketSupervisorConfig> }
  | { type: "MARKET_DATA_RECEIVED"; symbol: string; price: number; timestamp: number }
  | { type: "GET_ACTIVE_MARKETS" }
  | { type: "CHECK_HEALTH" };

// Types de réponses pour les messages qui nécessitent une réponse
export interface GetActiveMarketsResponse {
  markets: string[];
  activeCount: number;
}

export interface HealthCheckResponse {
  status: "healthy" | "degraded" | "unhealthy";
  activeMarkets: number;
  lastUpdates: Record<string, number>; // Timestamp de la dernière mise à jour par symbole
  issues?: string[];
}
