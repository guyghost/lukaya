import {
  BECH32_PREFIX,
  CompositeClient,
  Network,
  LocalWallet,
  OrderSide as DydxOrderSide,
  OrderType as DydxOrderType,
  OrderStatus as DydxOrderStatus,
  SubaccountClient,
  OrderTimeInForce,
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
  TimeInForce,
} from "../../domain/models/market.model";
import { getLogger } from "../../infrastructure/logger";

export interface DydxClientConfig {
  network: Network;
  mnemonic?: string;
}

interface DydxClientContext {
  marketDataCache: Map<string, MarketData>;
  subscriptions: Set<string>;
  markets: Map<string, any>;
  lastPollingTime: Record<string, number>;
  compositeClient: CompositeClient | null;
  localWallet: LocalWallet | null;
  subaccountClient: SubaccountClient | null;
}

// Factory function to create both MarketDataPort and TradingPort implementations
export const createDydxClient = (config: DydxClientConfig): { 
  marketDataPort: MarketDataPort; 
  tradingPort: TradingPort; 
} => {
  const logger = getLogger();
  
  // Create shared context
  const context: DydxClientContext = {
    marketDataCache: new Map(),
    subscriptions: new Set(),
    markets: new Map(),
    lastPollingTime: {},
    compositeClient: null,
    localWallet: null,
    subaccountClient: null
  };

  // Helper functions
  const initializeClient = async (): Promise<CompositeClient> => {
    if (!context.compositeClient) {
      logger.debug("Initializing dYdX composite client");
      context.compositeClient = await CompositeClient.connect(config.network);
      
      // Load market configs
      try {
        const marketsResponse = await context.compositeClient.indexerClient.markets.getPerpetualMarkets();
        if (marketsResponse.markets) {
          for (const [symbol, market] of Object.entries(marketsResponse.markets)) {
            context.markets.set(symbol, market);
          }
          logger.debug(`Loaded ${context.markets.size} markets from dYdX`);
        }
      } catch (error) {
        logger.error('Failed to load market configurations:', error as Error);
      }
    }
    return context.compositeClient;
  };

  const getWallet = async (): Promise<LocalWallet> => {
    if (!context.localWallet && config.mnemonic) {
      logger.debug("Initializing local wallet from mnemonic");
      context.localWallet = await LocalWallet.fromMnemonic(config.mnemonic, BECH32_PREFIX);
    }
    
    if (!context.localWallet) {
      throw new Error('Wallet is not initialized. Please provide a mnemonic.');
    }
    
    return context.localWallet;
  };

  const getClient = async (): Promise<CompositeClient> => {
    return initializeClient();
  };

  const getSubaccountClient = async (): Promise<SubaccountClient> => {
    if (!context.subaccountClient) {
      const wallet = await getWallet();
      
      // Initialize subaccount client
      logger.debug("Initializing subaccount client");
      context.subaccountClient = new SubaccountClient(
        wallet,
        0 // Use the default subaccount (index 0)
      );
    }
    
    return context.subaccountClient;
  };

  // Helpers for market operations
  const getMarketConfig = (symbol: string): any => {
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

  const mapTimeInForce = (timeInForce?: TimeInForce): OrderTimeInForce => {
    if (!timeInForce) return OrderTimeInForce.GTT;
    
    switch (timeInForce) {
      case TimeInForce.GOOD_TIL_CANCEL:
        return OrderTimeInForce.GTT;
      case TimeInForce.FILL_OR_KILL:
        return OrderTimeInForce.FOK;
      case TimeInForce.IMMEDIATE_OR_CANCEL:
        return OrderTimeInForce.IOC;
      default:
        return OrderTimeInForce.GTT;
    }
  };

  const mapDydxOrderToOrder = (dydxOrder: any): Order => {
    const orderStatus = mapDydxOrderStatus(dydxOrder.status);

    return {
      id: dydxOrder.id.toString(),
      symbol: dydxOrder.marketId,
      side: dydxOrder.side === DydxOrderSide.BUY ? OrderSide.BUY : OrderSide.SELL,
      type: mapDydxOrderType(dydxOrder.type),
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

  const mapDydxOrderStatus = (status: string): OrderStatus => {
    switch (status) {
      case DydxOrderStatus.OPEN:
        return OrderStatus.OPEN;
      case DydxOrderStatus.FILLED:
        return OrderStatus.FILLED;
      case DydxOrderStatus.CANCELED:
        return OrderStatus.CANCELED;
      case DydxOrderStatus.BEST_EFFORT_CANCELED:
        return OrderStatus.CANCELED;
      default:
        return OrderStatus.REJECTED;
    }
  };

  const mapDydxOrderType = (type: string): OrderType => {
    switch (type) {
      case DydxOrderType.LIMIT:
        return OrderType.LIMIT;
      case DydxOrderType.MARKET:
        return OrderType.MARKET;
      case DydxOrderType.STOP_LIMIT:
        return OrderType.STOP_LIMIT;
      case DydxOrderType.TAKE_PROFIT_LIMIT:
        return OrderType.LIMIT;
      default:
        return OrderType.MARKET;
    }
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
      
      // Get candles for historical data analysis
      const candles = await indexerClient.markets.getPerpetualMarketCandles(market.ticker, '1MIN');
      
      // Get orderbook
      const orderbook = await indexerClient.markets.getPerpetualMarketOrderbook(symbol);
      
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
      logger.error(`Error fetching market data for ${symbol}:`, error as Error);
      
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
        logger.debug(`Market data updated for ${symbol}`);
        
        // Poll again after delay
        setTimeout(poll, 5000);
      } catch (error) {
        logger.error(`Error during market data polling for ${symbol}:`, error as Error);
        
        // Retry after a delay
        setTimeout(poll, 10000);
      }
    };

    // Start polling
    poll();
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
        logger.info(`Subscribed to market data for ${symbol}`);
        
        // Fetch initial data
        await fetchAndCacheMarketData(symbol);
        
        // Start polling for updates
        pollMarketData(symbol);
      } catch (error) {
        logger.error(`Failed to subscribe to market data for ${symbol}:`, error as Error);
        throw error;
      }
    },

    unsubscribeFromMarketData: async (symbol: string): Promise<void> => {
      if (context.subscriptions.has(symbol)) {
        context.subscriptions.delete(symbol);
        logger.info(`Unsubscribed from market data for ${symbol}`);
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

  // TradingPort implementation
  const tradingPort: TradingPort = {
    placeOrder: async (orderParams: OrderParams): Promise<Order> => {
      try {
        const compositeClient = await getClient();
        const subaccountClient = await getSubaccountClient();
        
        // Get market configuration
        const market = getMarketConfig(orderParams.symbol);
        
        // Create order execution parameters
        const execution = {
          subaccountClient,
          marketId: orderParams.symbol,
          side: mapOrderSide(orderParams.side),
          type: mapOrderType(orderParams.type),
          timeInForce: mapTimeInForce(orderParams.timeInForce),
          price: orderParams.price?.toString() || '0',
          size: orderParams.size.toString(),
          postOnly: orderParams.postOnly || false,
          reduceOnly: orderParams.reduceOnly || false,
          clientId: orderParams.clientId || crypto.randomUUID(),
        };
        
        // Place order using the subaccount client
        logger.debug("Placing order", { params: orderParams });
        const response = await compositeClient.placeOrder(
          subaccountClient,
          orderParams.symbol,
          mapOrderType(orderParams.type),
          mapOrderSide(orderParams.side),
          orderParams.price || 0,
          orderParams.size,
          orderParams.clientId || 1,
          mapTimeInForce(orderParams.timeInForce)
        );

        // Get the order details from indexer
        const clientId = execution.clientId;
        const wallet = await getWallet();

        // Wait a short period for the order to be indexed
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Fetch the order by client ID
        const client = await getClient();
        const subaccountInfo = await getDefaultSubaccount();
        const ordersResponse = await client.indexerClient.account.getSubaccountOrders(
          wallet.address || '',
          subaccountInfo.subaccountNumber
        );

        // Correction : trouver l'ordre par clientId (pas juste prendre le premier)
        if (ordersResponse.orders && ordersResponse.orders.length > 0) {
          const foundOrder = ordersResponse.orders.find((o: any) => o.clientId === clientId);
          if (foundOrder) {
            return mapDydxOrderToOrder(foundOrder);
          }
        }

        // If we can't find the order, create a synthetic one
        return {
          id: clientId,
          symbol: orderParams.symbol,
          side: orderParams.side,
          type: orderParams.type,
          size: orderParams.size,
          price: orderParams.price,
          status: OrderStatus.OPEN,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          filledSize: 0,
          reduceOnly: orderParams.reduceOnly || false,
          postOnly: orderParams.postOnly || false,
          clientId: clientId,
        };
      } catch (error) {
        logger.error('Order placement failed:', error as Error);
        throw error;
      }
    },

    cancelOrder: async (orderId: string): Promise<boolean> => {
      try {
        const compositeClient = await getClient();
        
        // Cancel order by ID
        logger.debug(`Cancelling order ${orderId}`);
        await compositeClient.cancelOrder(orderId);
        
        return true;
      } catch (error) {
        logger.error(`Failed to cancel order ${orderId}:`, error as Error);
        return false;
      }
    },

    getOrder: async (orderId: string): Promise<Order | null> => {
      try {
        const client = await getClient();
        const wallet = await getWallet();
        
        const subaccountInfo = await getDefaultSubaccount();
        if (!subaccountInfo) return null;
        
        logger.debug(`Fetching order details for ${orderId}`);
        const orderResponse = await client.indexerClient.account.getSubaccountOrders(
          wallet.address || '',
          subaccountInfo.subaccountNumber
        );
        
        if (!orderResponse || !orderResponse.order) return null;
        
        return mapDydxOrderToOrder(orderResponse.order);
      } catch (error) {
        logger.error(`Failed to get order ${orderId}:`, error as Error);
        return null;
      }
    },

    getOpenOrders: async (symbol?: string): Promise<Order[]> => {
      try {
        const client = await getClient();
        const wallet = await getWallet();
        
        const subaccountInfo = await getDefaultSubaccount();
        if (!subaccountInfo) return [];
        
        const queryParams: any = { status: DydxOrderStatus.OPEN };
        if (symbol) {
          queryParams.marketId = symbol;
        }
        
        logger.debug("Fetching open orders", { symbol });
        const ordersResponse = await client.indexerClient.account.getSubaccountOrders(
          wallet.address || '',
          subaccountInfo.subaccountNumber,
          ...queryParams
        );
        
        if (!ordersResponse || !ordersResponse.orders) return [];
        
        return ordersResponse.orders.map(mapDydxOrderToOrder);
      } catch (error) {
        logger.error('Failed to get open orders:', error as Error);
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
        logger.debug("Fetching account balances");
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
        if (Array.isArray(subaccount.assetPositions)) {
          for (const position of subaccount.assetPositions) {
            if (position.symbol && position.size) {
              balances[position.symbol] = parseFloat(position.size);
            }
          }
        }
        
        return balances;
      } catch (error) {
        logger.error('Failed to get account balance:', error as Error);
        return {};
      }
    }
  };

  // Initialize client immediately
  initializeClient().catch(error => {
    logger.error('Failed to initialize DYDX client:', error as Error);
  });

  return { marketDataPort, tradingPort };
};