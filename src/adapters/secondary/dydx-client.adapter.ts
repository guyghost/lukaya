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
    logger.debug(`[DYDX_CLIENT] Fetching market data for symbol: ${symbol}`);
    try {
      const client = await getClient();
      const { indexerClient } = client;
      
      // Get market details
      logger.debug(`[DYDX_CLIENT] Getting perpetual markets for ${symbol}...`);
      const marketResponse = await indexerClient.markets.getPerpetualMarkets();
      if (!marketResponse.markets || !marketResponse.markets[symbol]) {
        logger.error(`[DYDX_CLIENT] Market not found for ${symbol} in DYDX API response`);
        // Fallback - créer des données simulées plutôt que d'échouer, si déjà dans le cache
        if (context.marketDataCache.has(symbol)) {
          const cached = context.marketDataCache.get(symbol)!;
          logger.warn(`[DYDX_CLIENT] Using cached data for ${symbol}: ${cached.price}`);
          return cached;
        }
        throw new Error(`Market data not found for ${symbol}`);
      }
      
      const market = marketResponse.markets[symbol];
      logger.debug(`[DYDX_CLIENT] Got market data for ${symbol}, oracle price: ${market.oraclePrice}`);
      
      // Get orderbook - parfois le livre d'ordres peut échouer mais on peut continuer avec le prix oracle
      let topBid = '0';
      let topAsk = '0';
      try {
        logger.debug(`[DYDX_CLIENT] Getting orderbook for ${symbol}...`);
        const orderbook = await indexerClient.markets.getPerpetualMarketOrderbook(symbol);
        // Calculate bid/ask from orderbook
        topBid = orderbook?.bids?.[0]?.[0] || '0';
        topAsk = orderbook?.asks?.[0]?.[0] || '0';
        logger.debug(`[DYDX_CLIENT] Got orderbook for ${symbol}: bid=${topBid}, ask=${topAsk}`);
      } catch (e) {
        logger.warn(`[DYDX_CLIENT] Could not fetch orderbook for ${symbol}, using oracle price for bid/ask`, e as Error);
        topBid = (parseFloat(market.oraclePrice) * 0.9995).toString(); // -0.05%
        topAsk = (parseFloat(market.oraclePrice) * 1.0005).toString(); // +0.05%
      }
      
      // Créer les données de marché
      const marketData: MarketData = {
        symbol,
        price: parseFloat(market.oraclePrice),
        timestamp: Date.now(),
        volume: parseFloat(market.volume24H || '0'),
        bid: parseFloat(topBid),
        ask: parseFloat(topAsk),
      };

      // Calculer le spread et des métriques utiles pour le trading
      const spread = marketData.ask - marketData.bid;
      const spreadPercent = (spread / marketData.price) * 100;
      
      // Enregistrer dans le cache
      context.marketDataCache.set(symbol, marketData);
      logger.info(`[DYDX_CLIENT] Updated market data for ${symbol}: Prix=${marketData.price}, Bid=${marketData.bid}, Ask=${marketData.ask}, Spread=${spread.toFixed(4)} (${spreadPercent.toFixed(4)}%), Volume24h=${marketData.volume.toFixed(2)}`);
      
      // Journaliser également les seuils de take profit pour la stratégie 3-5-7
      const tp1 = (marketData.price * 1.03).toFixed(2); // +3%
      const tp2 = (marketData.price * 1.05).toFixed(2); // +5%
      const tp3 = (marketData.price * 1.07).toFixed(2); // +7%
      logger.info(`[DYDX_CLIENT] Niveaux TP (règle 3-5-7) pour ${symbol} au prix ${marketData.price}: TP1=${tp1}, TP2=${tp2}, TP3=${tp3}`);
      
      // Déclencher le callback si disponible
      if (marketDataPort.onMarketDataReceived) {
        try {
          marketDataPort.onMarketDataReceived(marketData);
        } catch (e) {
          logger.error(`[DYDX_CLIENT] Error in market data callback for ${symbol}`, e as Error);
        }
      }
      
      return marketData;
    } catch (error) {
      logger.error(`[DYDX_CLIENT] Error fetching market data for ${symbol}:`, error as Error);
      
      // If we have cached data, return that instead of throwing
      const cachedData = context.marketDataCache.get(symbol);
      if (cachedData) {
        logger.warn(`[DYDX_CLIENT] Returning cached data for ${symbol} due to fetch error. Cached price: ${cachedData.price}, age: ${Date.now() - cachedData.timestamp}ms`);
        
        // Mettre à jour le timestamp pour éviter des expirations prématurées
        cachedData.timestamp = Date.now(); 
        return cachedData;
      }
      
      // Si pas de données en cache, créer des données synthétiques pour ne pas planter le système
      logger.warn(`[DYDX_CLIENT] Creating synthetic market data for ${symbol} to prevent system failure`);
      const syntheticData: MarketData = {
        symbol,
        price: 0,  // Prix zéro, qui sera évident dans les logs comme anormal
        timestamp: Date.now(),
        volume: 0,
        bid: 0,
        ask: 0,
      };
      
      // Ne pas mettre en cache les données synthétiques
      return syntheticData;
    }
  };

  const pollMarketData = (symbol: string): void => {
    const poll = async () => {
      // Vérifier si nous sommes toujours abonnés - si non, arrêter le polling
      if (!context.subscriptions.has(symbol)) {
        logger.info(`[DYDX_CLIENT] Stopping poll for ${symbol} as subscription was removed`);
        return;
      }
      
      try {
        logger.debug(`[DYDX_CLIENT] Polling market data for ${symbol}`);
        await fetchAndCacheMarketData(symbol);
        
        // Store last polling time
        context.lastPollingTime[symbol] = Date.now();
        
        // Ajouter plus de logs pour suivre les mises à jour
        const marketData = context.marketDataCache.get(symbol);
        if (marketData) {
          logger.info(`[DYDX_CLIENT] Market data updated for ${symbol}: Price=${marketData.price}, Bid=${marketData.bid}, Ask=${marketData.ask}`);
        }
        
        // Planifier le prochain appel avec un intervalle plus court pour être plus réactif
        setTimeout(poll, 3000); // Réduit à 3 secondes pour être plus réactif
      } catch (error) {
        logger.error(`[DYDX_CLIENT] Error during market data polling for ${symbol}:`, error as Error);
        
        // Retry after a delay
        setTimeout(poll, 5000); // Réduit à 5 secondes pour récupérer plus rapidement
      }
    };

    // Start polling immédiatement
    logger.info(`[DYDX_CLIENT] Starting market data polling for ${symbol}`);
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
      logger.info(`[DYDX_CLIENT] Subscription request received for market ${symbol}`);
      
      // Si déjà abonné, afficher un message mais ne pas sortir prématurément
      // pour s'assurer que le polling est bien en cours
      if (context.subscriptions.has(symbol)) {
        logger.info(`[DYDX_CLIENT] Already subscribed to market ${symbol}, ensuring polling is active`);
      } else {
        logger.info(`[DYDX_CLIENT] New subscription for market ${symbol}`);
      }

      try {
        // Validate that the market exists
        const client = await getClient();
        logger.debug(`[DYDX_CLIENT] Validating market ${symbol}...`);
        const marketResponse = await client.indexerClient.markets.getPerpetualMarkets();
        
        if (!marketResponse.markets || !marketResponse.markets[symbol]) {
          logger.error(`[DYDX_CLIENT] Market ${symbol} does not exist in DYDX!`);
          throw new Error(`Market ${symbol} does not exist`);
        }
        
        // Add to subscriptions if not already there
        if (!context.subscriptions.has(symbol)) {
          context.subscriptions.add(symbol);
          logger.info(`[DYDX_CLIENT] Successfully subscribed to market data for ${symbol}`);
        }
        
        // Toujours récupérer les données initiales, que la souscription soit nouvelle ou existante
        logger.debug(`[DYDX_CLIENT] Fetching initial market data for ${symbol}...`);
        const initialData = await fetchAndCacheMarketData(symbol);
        logger.info(`[DYDX_CLIENT] Initial market data for ${symbol}: Price=${initialData.price}`);
        
        // Toujours démarrer ou redémarrer le polling pour s'assurer qu'il est actif
        logger.info(`[DYDX_CLIENT] Starting/ensuring data polling for ${symbol}`);
        pollMarketData(symbol);
        
        // Vérifier après un court délai que le polling fonctionne
        setTimeout(async () => {
          try {
            const latest = await fetchAndCacheMarketData(symbol);
            logger.info(`[DYDX_CLIENT] Polling verification for ${symbol}: Price=${latest.price}, timestamp=${new Date().toISOString()}`);
          } catch (err) {
            logger.error(`[DYDX_CLIENT] Polling verification failed for ${symbol}`, err as Error);
          }
        }, 5000);
      } catch (error) {
        logger.error(`[DYDX_CLIENT] Failed to subscribe to market data for ${symbol}:`, error as Error);
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
      logger.info(`[DYDX_CLIENT] Récupération des données du marché pour ${symbol} (stratégie 3-5-7)`);
      
      // Vérifier si nous avons un abonnement actif
      if (!context.subscriptions.has(symbol)) {
        logger.warn(`[DYDX_CLIENT] Getting market data for ${symbol} but no active subscription exists. Auto-subscribing.`);
        // Auto-souscrire pour rendre le système plus résilient
        try {
          await marketDataPort.subscribeToMarketData(symbol);
        } catch (err) {
          logger.error(`[DYDX_CLIENT] Failed to auto-subscribe to ${symbol}`, err as Error);
        }
      }
      
      const cached = context.marketDataCache.get(symbol);
      const now = Date.now();
      const lastPollTime = context.lastPollingTime[symbol] || 0;
      const dataAge = now - lastPollTime;
      
      // If we have recent data (less than 10s old), return it - réduit de 30s à 10s pour plus de fraîcheur
      if (cached && dataAge < 10000) {
        logger.info(`[DYDX_CLIENT] Données du marché (cache) pour ${symbol}: Prix=${cached.price}, Bid=${cached.bid}, Ask=${cached.ask}, Spread=${(cached.ask - cached.bid).toFixed(4)}, Age=${dataAge}ms`);
        return cached;
      }
      
      // Si les données sont entre 10s et 30s, on les renvoie quand même mais on lance un refresh en arrière-plan
      if (cached && dataAge < 30000) {
        logger.info(`[DYDX_CLIENT] Données du marché (légèrement anciennes) pour ${symbol}: Prix=${cached.price}, Bid=${cached.bid}, Ask=${cached.ask}, Spread=${(cached.ask - cached.bid).toFixed(4)}, Age=${dataAge}ms - rafraîchissement en cours`);
        
        // Refresh en arrière-plan
        fetchAndCacheMarketData(symbol).catch(err => {
          logger.error(`[DYDX_CLIENT] Background refresh failed for ${symbol}`, err as Error);
        });
        
        return cached;
      }
      
      // Otherwise fetch fresh data
      logger.info(`[DYDX_CLIENT] Cache expiré ou manquant pour ${symbol}, récupération de données fraîches pour analyse de position (règle 3-5-7)`);
      const freshData = await fetchAndCacheMarketData(symbol);
      logger.info(`[DYDX_CLIENT] Nouvelles données du marché pour ${symbol}: Prix=${freshData.price}, Bid=${freshData.bid}, Ask=${freshData.ask}, Spread=${(freshData.ask - freshData.bid).toFixed(4)}`);
      return freshData;
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
      } catch (error) {
        logger.error('Order placement failed:', error as Error);
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