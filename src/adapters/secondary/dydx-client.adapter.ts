import {
  BECH32_PREFIX,
  CompositeClient,
  Network,
  LocalWallet,
  OrderSide as DydxOrderSide,
  OrderType as DydxOrderType,
  OrderStatus as DydxOrderStatus,
  Subaccount,
} from "@dydxprotocol/v4-client-js";
import { MarketDataPort } from "../../application/ports/market-data.port";
import { TradingPort } from "../../application/ports/trading.port";
import {
  MarketData,
  Order,
  OrderParams,
  OrderStatus,
  OrderSide,
  OrderType,
} from "../../domain/models/market.model";

export interface DydxClientConfig {
  network: Network;
  mnemonic?: string;
}

interface DydxClientContext {
  marketDataCache: Map<string, MarketData>;
  subscriptions: Set<string>;
  markets: Map<string, string>;
  lastPollingTime: Record<string, number>;
}

// Factory function to create both MarketDataPort and TradingPort implementations
export const createDydxClient = (config: DydxClientConfig): { 
  marketDataPort: MarketDataPort; 
  tradingPort: TradingPort; 
} => {
  // Create shared context
  const context: DydxClientContext = {
    marketDataCache: new Map(),
    subscriptions: new Set(),
    markets: new Map(),
    lastPollingTime: {},
  };

  let compositeClient: CompositeClient | null = null;
  let localWallet: LocalWallet | null = null;

  // Initialize client and wallet
  const initializeClient = async (): Promise<CompositeClient> => {
    if (!compositeClient) {
      compositeClient = await CompositeClient.connect(config.network);
      
      // Load market configs
      try {
        const marketsResponse = await compositeClient.indexerClient.markets.getPerpetualMarkets();
        if (marketsResponse.markets) {
          for (const [symbol, market] of Object.entries(marketsResponse.markets as Record<string, string>)) {
            context.markets.set(symbol, market);
          }
        }
      } catch (error) {
        console.error('Failed to load market configurations:', error);
      }
    }
    return compositeClient;
  };

  const getWallet = async (): Promise<LocalWallet> => {
    if (!localWallet && config.mnemonic) {
      localWallet = await LocalWallet.fromMnemonic(config.mnemonic, BECH32_PREFIX);
    }
    
    if (!localWallet) {
      throw new Error('Wallet is not initialized. Please provide a mnemonic.');
    }
    
    return localWallet;
  };

  const getClient = async (): Promise<CompositeClient> => {
    const client = await initializeClient();
    
    return client;
  };

  // Helpers for market operations
  const getMarketConfig = (symbol: string): string => {
    const market = context.markets.get(symbol);
    if (!market) {
      throw new Error(`Market configuration not found for ${symbol}`);
    }
    return market;
  };
  
  const mapOrderSide = (side: OrderSide): DydxOrderSide => {
    switch (side) {
      case OrderSide.BUY:
        return DydxOrderSide.BUY;
      case OrderSide.SELL:
        return DydxOrderSide.SELL;
      default:
        throw new Error(`Unsupported order side: ${side}`);
    }
  };
  
  const mapOrderType = (type: OrderType): DydxOrderType => {
    switch (type) {
      case OrderType.LIMIT:
        return DydxOrderType.LIMIT;
      case OrderType.MARKET:
        return DydxOrderType.MARKET;
      case OrderType.STOP:
        return DydxOrderType.STOP_LIMIT;
      case OrderType.STOP_LIMIT:
        return DydxOrderType.STOP_LIMIT;
      case OrderType.TRAILING_STOP:
        throw new Error(`Trailing stop orders not supported by DYDX API`);
      default:
        throw new Error(`Unsupported order type: ${type}`);
    }
  };

  const mapDydxOrderToOrder = (dydxOrder: any): Order => {
    const orderStatus = dydxOrder.status === DydxOrderStatus.OPEN 
      ? OrderStatus.OPEN 
      : dydxOrder.status === DydxOrderStatus.FILLED 
        ? OrderStatus.FILLED 
        : dydxOrder.status === DydxOrderStatus.CANCELED 
          ? OrderStatus.CANCELED 
          : OrderStatus.REJECTED;

    return {
      id: dydxOrder.id.toString(),
      symbol: dydxOrder.marketId,
      side: dydxOrder.side === DydxOrderSide.BUY ? OrderSide.BUY : OrderSide.SELL,
      type: dydxOrder.type === DydxOrderType.LIMIT ? OrderType.LIMIT : OrderType.MARKET,
      size: parseFloat(dydxOrder.size),
      price: dydxOrder.price ? parseFloat(dydxOrder.price) : undefined,
      status: orderStatus,
      createdAt: new Date(dydxOrder.createdAt).getTime(),
      updatedAt: new Date(dydxOrder.updatedAt || dydxOrder.createdAt).getTime(),
      filledSize: parseFloat(dydxOrder.filledSize || '0'),
      avgFillPrice: dydxOrder.avgPrice ? parseFloat(dydxOrder.avgPrice) : undefined,
      reduceOnly: dydxOrder.reduceOnly || false,
      postOnly: dydxOrder.postOnly || false,
      clientId: dydxOrder.clientId || undefined,
    };
  };

  // Private helper functions for market data
  const fetchAndCacheMarketData = async (symbol: string): Promise<MarketData> => {
    try {
      const client = await getClient();
      const { indexerClient } = client;
      
      // Get market details
      const marketResponse = await indexerClient.markets.getPerpetualMarkets();
      if (!marketResponse.markets || !marketResponse.markets[symbol]) {
        throw new Error(`Market data not found for ${symbol}`);
      }
      
      const market = marketResponse.markets[symbol];
      
      // TODO: Implement candles retrieval if supported by the API
      const candles = await indexerClient.markets.getPerpetualMarketCandles(market.ticker, '1MIN');
      
      // Get orderbook
      const orderbook = await indexerClient.markets.getPerpetualMarketOrderbook(symbol);
      console.log('Orderbook:', orderbook);
      
      // Calculate bid/ask from orderbook
      const topBid = orderbook?.bids?.[0]?.[0] || '0';
      const topAsk = orderbook?.asks?.[0]?.[0] || '0';
      
      const marketData: MarketData = {
        symbol,
        price: parseFloat(market.oraclePrice),
        timestamp: Date.now(),
        volume: parseFloat(market.volume24H),
        bid: parseFloat(topBid),
        ask: parseFloat(topAsk),
      };

      context.marketDataCache.set(symbol, marketData);
      return marketData;
    } catch (error) {
      console.error(`Error fetching market data for ${symbol}:`, error);
      
      // If we have cached data, return that instead of throwing
      const cachedData = context.marketDataCache.get(symbol);
      if (cachedData) {
        return cachedData;
      }
      
      throw error;
    }
  };

  const pollMarketData = (symbol: string): void => {
    const poll = async () => {
      if (!context.subscriptions.has(symbol)) return;
      
      try {
        await fetchAndCacheMarketData(symbol);
        
        // Store last polling time
        context.lastPollingTime[symbol] = Date.now();
        
        // Send to trading bot (this would be implemented in a real application)
        // For now just log the update
        console.log(`Market data updated for ${symbol}`);
        
        // Poll again after delay
        setTimeout(poll, 5000);
      } catch (error) {
        console.error(`Error during market data polling for ${symbol}:`, error);
        
        // Retry after a delay
        setTimeout(poll, 10000);
      }
    };

    // Start polling
    poll();
  };

  // MarketDataPort implementation
  const marketDataPort: MarketDataPort = {
    subscribeToMarketData: async (symbol: string): Promise<void> => {
      if (context.subscriptions.has(symbol)) return;

      try {
        // Validate that the market exists
        const client = await getClient();
        const marketResponse = await client.indexerClient.markets.getPerpetualMarkets();
        
        if (!marketResponse.markets || !marketResponse.markets[symbol]) {
          throw new Error(`Market ${symbol} does not exist`);
        }
        
        // Add to subscriptions and begin polling
        context.subscriptions.add(symbol);
        console.log(`Subscribed to market data for ${symbol}`);
        
        // Fetch initial data
        await fetchAndCacheMarketData(symbol);
        
        // Start polling for updates
        pollMarketData(symbol);
      } catch (error) {
        console.error(`Failed to subscribe to market data for ${symbol}:`, error);
        throw error;
      }
    },

    unsubscribeFromMarketData: async (symbol: string): Promise<void> => {
      if (context.subscriptions.has(symbol)) {
        context.subscriptions.delete(symbol);
        console.log(`Unsubscribed from market data for ${symbol}`);
      }
    },

    getLatestMarketData: async (symbol: string): Promise<MarketData> => {
      const cached = context.marketDataCache.get(symbol);
      const now = Date.now();
      const lastPollTime = context.lastPollingTime[symbol] || 0;
      
      // If we have recent data (less than 30s old), return it
      if (cached && now - lastPollTime < 30000) {
        return cached;
      }
      
      // Otherwise fetch fresh data
      return fetchAndCacheMarketData(symbol);
    }
  };

  // Get the default subaccount
  const getDefaultSubaccount = async (): Promise<any> => {
    const client = await getClient();
    const wallet = await getWallet();
    
    if (!wallet.address) {
      throw new Error('Wallet address not available');
    }
    
    // Get subaccount info
    const subaccountResponse = await client.indexerClient.account.getSubaccounts(wallet.address);
    if (!subaccountResponse?.subaccounts?.length) {
      throw new Error('No subaccounts found');
    }
    
    // Use the first subaccount by default
    return subaccountResponse.subaccounts[0];
  };

  // TradingPort implementation
  const tradingPort: TradingPort = {
    placeOrder: async (orderParams: OrderParams): Promise<Order> => {
      try {
        const client = await getClient();
        const subaccount = await getDefaultSubaccount();
        
        // Get market configuration
        const market = getMarketConfig(orderParams.symbol);
        
        // Prepare order parameters
        const dydxOrderParams = {
          marketId: orderParams.symbol,
          side: mapOrderSide(orderParams.side),
          type: mapOrderType(orderParams.type),
          size: orderParams.size.toString(),
          price: orderParams.price?.toString(),
          postOnly: orderParams.postOnly || false,
          reduceOnly: orderParams.reduceOnly || false,
          clientId: orderParams.clientId || crypto.randomUUID(),
        };
        
        // TODO: Update this call with correct argument count as per dYdX API
        // const response = await client.placeOrder(...args);
        const response = {};
        
        // TODO: Handle response shape as per actual API
        return {} as Order; // Placeholder
      } catch (error) {
        console.error('Order placement failed:', error);
        throw error;
      }
    },

    cancelOrder: async (orderId: string): Promise<boolean> => {
      try {
        const client = await getClient();
        
        // TODO: Update this call with correct argument count as per dYdX API
        // const response = await client.cancelOrder(...args);
        const response = {};
        
        // TODO: Handle response shape as per actual API
        return true;
      } catch (error) {
        console.error(`Failed to cancel order ${orderId}:`, error);
        return false;
      }
    },

    getOrder: async (orderId: string): Promise<Order | null> => {
      try {
        const client = await getClient();
        const wallet = await getWallet();
        
        if (!wallet.address) {
          throw new Error('Wallet address not available');
        }
        
        // TODO: Replace with correct subaccount number if needed
        const subaccountInfo = await client.indexerClient.account.getSubaccounts(wallet.address);
        if (!subaccountInfo?.subaccounts?.length) return null;
        const subaccountNumber = subaccountInfo.subaccounts[0].subaccountNumber || 0;
        
        const orderResponse = await client.indexerClient.account.getSubaccountOrders(wallet.address, subaccountNumber);
        
        // TODO: Update this logic based on actual API response
        return null;
      } catch (error) {
        console.error(`Failed to get order ${orderId}:`, error);
        return null;
      }
    },

    getOpenOrders: async (symbol?: string): Promise<Order[]> => {
      try {
        const client = await getClient();
        const wallet = await getWallet();
        
        if (!wallet.address) {
          throw new Error('Wallet address not available');
        }
        
        // Get subaccount info
        const subaccountInfo = await client.indexerClient.account.getSubaccounts(wallet.address);
        if (!subaccountInfo?.subaccounts?.length) {
          return [];
        }
        
        // Use the first subaccount's address
        const subaccountAddress = subaccountInfo.subaccounts[0].address;
        const subaccountNumber = subaccountInfo.subaccounts[0].subaccountNumber || 0;
        
        // TODO: Replace with correct subaccount number if needed
        const ordersResponse = await client.indexerClient.account.getSubaccountOrders(wallet.address, subaccountNumber);
        
        // TODO: Handle response shape as per actual API
        return [];
      } catch (error) {
        console.error('Failed to get open orders:', error);
        return [];
      }
    },

    getAccountBalance: async (): Promise<Record<string, number>> => {
      try {
        const client = await getClient();
        const wallet = await getWallet();
        
        if (!wallet.address) {
          throw new Error('Wallet address not available');
        }
        
        // Get subaccount info
        const subaccountResponse = await client.indexerClient.account.getSubaccounts(wallet.address);
        if (!subaccountResponse?.subaccounts?.length) {
          return {};
        }
        
        const subaccount = subaccountResponse.subaccounts[0];
        const balances: Record<string, number> = {};
        
        // Extract USDC balance
        if (subaccount.equity) {
          balances['USDC'] = parseFloat(subaccount.equity);
        }
        
        // Extract positions as balances
        if (subaccount.assetPositions) {
          for (const position of subaccount.assetPositions) {
            if (position.symbol && position.size) {
              balances[position.symbol] = parseFloat(position.size);
            }
          }
        }
        
        return balances;
      } catch (error) {
        console.error('Failed to get account balance:', error);
        return {};
      }
    }
  };

  // Initialize client immediately
  initializeClient().catch(error => {
    console.error('Failed to initialize DYDX client:', error);
  });

  return { marketDataPort, tradingPort };
};
