import { MarketData } from "../../shared";

export interface MarketDataPort {
  subscribeToMarketData(symbol: string): Promise<void>;
  unsubscribeFromMarketData(symbol: string): Promise<void>;
  getLatestMarketData(symbol: string): Promise<MarketData>;
}
