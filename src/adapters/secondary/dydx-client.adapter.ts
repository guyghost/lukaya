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
  OrderFlags,
} from "@dydxprotocol/v4-client-js";
import * as crypto from "crypto";
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
import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";

// Default quantum configurations for common markets (fallback)
const DEFAULT_QUANTUM_CONFIG: Record<string, { atomicResolution: number; stepBaseQuantums: number }> = {
  "BTC-USD": { atomicResolution: -10, stepBaseQuantums: 1000 }, // 0.0000000001 BTC minimum
  "ETH-USD": { atomicResolution: -9, stepBaseQuantums: 1000 }, // 0.000000001 ETH minimum  
  "SOL-USD": { atomicResolution: -6, stepBaseQuantums: 1000000 }, // 0.001 SOL minimum
  "LTC-USD": { atomicResolution: -6, stepBaseQuantums: 1000000 }, // 0.001 LTC minimum
  "XRP-USD": { atomicResolution: -5, stepBaseQuantums: 10000000 }, // 0.1 XRP minimum
  "AVAX-USD": { atomicResolution: -6, stepBaseQuantums: 1000000 }, // 0.001 AVAX minimum
  "LINK-USD": { atomicResolution: -6, stepBaseQuantums: 1000000 }, // 0.001 LINK minimum
  "DOT-USD": { atomicResolution: -6, stepBaseQuantums: 1000000 }, // 0.001 DOT minimum
};

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
  const logger = createContextualLogger("DydxClient");
  
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

  /**
   * Validate order size against dYdX minimum quantum requirements
   * @param symbol Market symbol (e.g., "LTC-USD")
   * @param size Order size in base units
   * @returns Object with validation result and adjusted size if needed
   */
  const validateMinimumQuantums = (symbol: string, size: number): { 
    isValid: boolean; 
    adjustedSize?: number; 
    minSize?: number;
    reason?: string;
  } => {
    try {
      let atomicResolution: number;
      let stepBaseQuantums: number;
      
      try {
        // Try to get market configuration from dYdX
        const market = getMarketConfig(symbol);
        atomicResolution = market.atomicResolution ? parseInt(market.atomicResolution) : -6;
        stepBaseQuantums = market.stepBaseQuantums ? parseInt(market.stepBaseQuantums) : 1000000;
      } catch (marketError) {
        // Use default configuration if market config unavailable
        logger.warn(`Market config unavailable for ${symbol}, using defaults:`, marketError as Error);
        const defaultConfig = DEFAULT_QUANTUM_CONFIG[symbol];
        if (defaultConfig) {
          atomicResolution = defaultConfig.atomicResolution;
          stepBaseQuantums = defaultConfig.stepBaseQuantums;
          logger.info(`Using default quantum config for ${symbol}:`, { atomicResolution, stepBaseQuantums });
        } else {
          // Conservative fallback for unknown symbols
          atomicResolution = -6;
          stepBaseQuantums = 1000000;
          logger.warn(`No default config for ${symbol}, using conservative fallback`);
        }
      }
      
      // Calculate minimum order size in base units
      // stepBaseQuantums is the minimum quantum size
      const minQuantumSize = stepBaseQuantums * Math.pow(10, atomicResolution);
      
      logger.debug(`📏 Quantum validation for ${symbol}:`, {
        requestedSize: size,
        atomicResolution,
        stepBaseQuantums,
        minQuantumSize,
        sizeInQuantums: size / Math.pow(10, atomicResolution)
      });

      // Check if the order size meets minimum requirements
      if (size < minQuantumSize) {
        // Calculate the next valid size (round up to next quantum increment)
        const adjustedSize = Math.ceil(size / minQuantumSize) * minQuantumSize;
        
        logger.warn(`⚠️ Order size ${size} below minimum ${minQuantumSize} for ${symbol}`, {
          adjustedSize,
          originalSizeQuantums: size / Math.pow(10, atomicResolution),
          minSizeQuantums: stepBaseQuantums,
          adjustedSizeQuantums: adjustedSize / Math.pow(10, atomicResolution)
        });

        return {
          isValid: false,
          adjustedSize,
          minSize: minQuantumSize,
          reason: `Order size ${size} below minimum ${minQuantumSize} (${stepBaseQuantums} quantums)`
        };
      }

      // Check if size is properly aligned to quantum increments
      const quantums = size / Math.pow(10, atomicResolution);
      const remainder = quantums % stepBaseQuantums;
      
      if (remainder !== 0) {
        // Round to nearest valid quantum increment
        const adjustedQuantums = Math.round(quantums / stepBaseQuantums) * stepBaseQuantums;
        const adjustedSize = adjustedQuantums * Math.pow(10, atomicResolution);
        
        logger.info(`🔧 Aligning order size to quantum increments for ${symbol}:`, {
          originalSize: size,
          originalQuantums: quantums,
          adjustedSize,
          adjustedQuantums,
          stepBaseQuantums
        });

        return {
          isValid: false,
          adjustedSize,
          minSize: minQuantumSize,
          reason: `Order size aligned to quantum increments (${adjustedQuantums} quantums)`
        };
      }

      return { isValid: true };
      
    } catch (error) {
      logger.error(`Failed to validate quantums for ${symbol}:`, error as Error);
      
      // Fallback: use conservative minimum based on symbol
      const defaultConfig = DEFAULT_QUANTUM_CONFIG[symbol];
      let conservativeMin = 0.01; // Default fallback
      
      if (defaultConfig) {
        conservativeMin = defaultConfig.stepBaseQuantums * Math.pow(10, defaultConfig.atomicResolution);
      }
      
      if (size < conservativeMin) {
        return {
          isValid: false,
          adjustedSize: conservativeMin,
          minSize: conservativeMin,
          reason: `Using conservative minimum ${conservativeMin} due to validation error`
        };
      }
      
      return { isValid: true };
    }
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
      const topBid = orderbook?.bids?.[0]?.price || '0';
      const topAsk = orderbook?.asks?.[0]?.price || '0';
      
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
    let errorCount = 0;
    let lastSuccess = Date.now();
    const poll = async () => {
      if (!context.subscriptions.has(symbol)) return;
      const start = Date.now();
      try {
        await fetchAndCacheMarketData(symbol);
        // Performance metrics
        const now = Date.now();
        const lastPoll = context.lastPollingTime[symbol] || now;
        const tickDuration = now - lastPoll;
        // Récupérer ou initialiser les métriques
        let marketData = context.marketDataCache.get(symbol);
        if (marketData) {
          if (!marketData.metrics) {
            marketData.metrics = {
              tickCount: 0,
              totalTickDuration: 0,
              errorCount: 0,
              lastTick: now
            };
          }
          const metrics = marketData.metrics;
          metrics.tickCount += 1;
          metrics.totalTickDuration += tickDuration;
          metrics.lastTick = now;
          metrics.errorCount = errorCount;
          logger.info(`[PERF] ${symbol} tick #${metrics.tickCount} | Δt=${tickDuration}ms | avgΔt=${(metrics.totalTickDuration/metrics.tickCount).toFixed(1)}ms | errors=${metrics.errorCount}`);
          // Mettre à jour le cache
          context.marketDataCache.set(symbol, marketData);
        }
        context.lastPollingTime[symbol] = now;
        errorCount = 0;
        lastSuccess = now;
        setTimeout(poll, 5000);
      } catch (error) {
        errorCount += 1;
        logger.error(`Error during market data polling for ${symbol}:`, error as Error);
        // Exponential backoff: min 10s, max 5min
        const delay = Math.min(300000, 10000 * Math.pow(2, errorCount - 1));
        logger.warn(`[BACKOFF] ${symbol} polling delayed by ${delay/1000}s after ${errorCount} error(s)`);
        // Stocker l'erreur dans les métriques
        let marketData = context.marketDataCache.get(symbol);
        if (marketData) {
          if (!marketData.metrics) {
            marketData.metrics = {
              tickCount: 0,
              totalTickDuration: 0,
              errorCount: 0,
              lastTick: Date.now()
            };
          }
          marketData.metrics.errorCount = errorCount;
          context.marketDataCache.set(symbol, marketData);
        }
        setTimeout(poll, delay);
      }
    };
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
    },

    getHistoricalMarketData: async (symbol: string, limit: number = 100): Promise<MarketData[]> => {
      try {
        const client = await getClient();
        const { indexerClient } = client;

        // Fetch historical candles (e.g., 1MIN interval)
        const candlesResponse = await indexerClient.markets.getPerpetualMarketCandles(symbol, '1MIN');
        if (!candlesResponse?.candles || !Array.isArray(candlesResponse.candles)) {
          throw new Error(`No historical candle data found for ${symbol}`);
        }

        // Map candles to MarketData[]
        return candlesResponse.candles.map((candle: any) => ({
          symbol,
          price: parseFloat(candle.close),
          timestamp: new Date(candle.start).getTime(),
          volume: parseFloat(candle.volume),
          bid: parseFloat(candle.close), // No bid/ask in candle, use close as proxy
          ask: parseFloat(candle.close),
        }));
      } catch (error) {
        logger.error(`Failed to fetch historical market data for ${symbol}:`, error as Error);
        return [];
      }
    }
  };

  // TradingPort implementation
  const tradingPort: TradingPort = {
    placeOrder: async (orderParams: OrderParams): Promise<Order> => {
      logger.debug("🎯 DydxClient.placeOrder() called", { 
        orderParams,
        timestamp: new Date().toISOString()
      });

      try {
        logger.debug("📡 Getting dYdX clients...");
        const compositeClient = await getClient();
        const subaccountClient = await getSubaccountClient();
        logger.debug("✅ Clients obtained successfully", {
          hasCompositeClient: !!compositeClient,
          hasSubaccountClient: !!subaccountClient
        });
        
        // Get market configuration
        logger.debug("🏪 Getting market configuration...", { symbol: orderParams.symbol });
        const market = getMarketConfig(orderParams.symbol);
        logger.debug("✅ Market configuration obtained", { market });
        
        // Validate order size against market minimum quantums
        const sizeValidation = validateMinimumQuantums(orderParams.symbol, orderParams.size);
        if (!sizeValidation.isValid && sizeValidation.adjustedSize) {
          logger.warn(`🚨 Order size validation failed for ${orderParams.symbol}: ${sizeValidation.reason}`);
          logger.info(`📏 Adjusting order size from ${orderParams.size} to ${sizeValidation.adjustedSize}`);
          orderParams.size = sizeValidation.adjustedSize;
        } else if (!sizeValidation.isValid) {
          throw new Error(`Order size ${orderParams.size} is below minimum requirements for ${orderParams.symbol}: ${sizeValidation.reason}`);
        }
        
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
        
        logger.debug("🔧 Order execution parameters prepared", { 
          execution: {
            ...execution,
            subaccountClient: "[SubaccountClient]" // Don't log the full client object
          }
        });
        
        // Place order using the subaccount client
        logger.debug("🚀 Calling compositeClient.placeOrder()...", { 
          symbol: orderParams.symbol,
          type: mapOrderType(orderParams.type),
          side: mapOrderSide(orderParams.side),
          price: orderParams.price || 0,
          size: orderParams.size,
          clientId: orderParams.clientId || 1,
          timeInForce: orderParams.type === OrderType.MARKET ? "MARKET_ORDER" : mapTimeInForce(orderParams.timeInForce)
        });
        
        // Pour les ordres au marché, ne pas spécifier timeInForce
        const response = await compositeClient.placeOrder(
          subaccountClient,
          orderParams.symbol,
          mapOrderType(orderParams.type),
          mapOrderSide(orderParams.side),
          orderParams.price || 0,
          orderParams.size,
          orderParams.clientId || 1,
          orderParams.type === OrderType.MARKET ? undefined : mapTimeInForce(orderParams.timeInForce)
        );

        logger.debug("✅ compositeClient.placeOrder() completed", { 
          response: response ? "Response received" : "No response",
          responseKeys: response ? Object.keys(response) : "N/A"
        });

        // Get the order details from indexer
        const clientId = execution.clientId;
        const wallet = await getWallet();
        
        logger.debug("👛 Wallet obtained", { 
          address: wallet.address ? `${wallet.address.substring(0, 10)}...` : "No address",
          hasWallet: !!wallet
        });

        // Wait a short period for the order to be indexed
        logger.debug("⏳ Waiting 1 second for order indexing...");
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Fetch the order by client ID
        logger.debug("🔍 Fetching order from indexer...", { clientId });
        const client = await getClient();
        const subaccountInfo = await getDefaultSubaccount();
        
        logger.debug("📊 Subaccount info obtained", { 
          subaccountNumber: subaccountInfo.subaccountNumber,
          walletAddress: wallet.address ? `${wallet.address.substring(0, 10)}...` : "No address"
        });
        
        const ordersResponse = await client.indexerClient.account.getSubaccountOrders(
          wallet.address || '',
          subaccountInfo.subaccountNumber
        );

        logger.debug("📋 Orders response received", { 
          ordersCount: ordersResponse.orders?.length || 0,
          hasOrders: !!(ordersResponse.orders && ordersResponse.orders.length > 0)
        });

        // Correction : trouver l'ordre par clientId (pas juste prendre le premier)
        if (ordersResponse.orders && ordersResponse.orders.length > 0) {
          logger.debug("🔍 Searching for order by clientId...", { 
            clientId,
            availableClientIds: ordersResponse.orders.map((o: any) => o.clientId)
          });
          
          const foundOrder = ordersResponse.orders.find((o: any) => o.clientId === clientId);
          if (foundOrder) {
            logger.debug("✅ Order found in indexer", { 
              orderId: foundOrder.id,
              status: foundOrder.status,
              clientId: foundOrder.clientId
            });
            const mappedOrder = mapDydxOrderToOrder(foundOrder);
            logger.debug("🔄 Order mapped successfully", { mappedOrder });
            return mappedOrder;
          } else {
            logger.warn("⚠️ Order not found by clientId", { 
              searchedClientId: clientId,
              availableOrders: ordersResponse.orders.length
            });
          }
        } else {
          logger.warn("⚠️ No orders found in response");
        }

        // If we can't find the order, create a synthetic one
        logger.debug("🔧 Creating synthetic order (order not found in indexer)");
        const syntheticOrder = {
          id: "0",
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
        };
        
        logger.debug("✅ Synthetic order created", { syntheticOrder });
        return syntheticOrder;
      } catch (error) {
        logger.error('🚨 Order placement failed:', error as Error);
        throw error;
      }
    },

    cancelOrder: async (symbol: string): Promise<boolean> => {
      try {
        const compositeClient = await getClient();
        const subaccountClient = await getSubaccountClient();
        const wallet = await getWallet();
        const subaccountInfo = await getDefaultSubaccount();
        
        // Cancel order by ID
        logger.debug(`Cancelling order ${symbol}`);
        await compositeClient.cancelOrder(subaccountClient, 0, OrderFlags.SHORT_TERM, symbol);
        
        return true;
      } catch (error) {
        logger.error(`Failed to cancel order ${symbol}:`, error as Error);
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