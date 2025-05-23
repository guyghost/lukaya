import { MarketData } from "../../domain/models/market.model";

export interface MarketDataPort {
  subscribeToMarketData(symbol: string): Promise<void>;
  unsubscribeFromMarketData(symbol: string): Promise<void>;
  getLatestMarketData(symbol: string): Promise<MarketData>;
  
  /**
   * Callback optionnel pour recevoir les données de marché directement.
   * Peut être utilisé par des outils de diagnostic ou de surveillance.
   */
  onMarketDataReceived?: (data: MarketData) => void;
}
