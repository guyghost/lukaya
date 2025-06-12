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
import { RateLimiter, executeWithRateLimit, DYDX_RATE_LIMITER_CONFIG } from "../../shared/utils/rate-limiter";
import { retryWithBackoff } from "../../shared/utils/parallel-execution-result";

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
  rateLimiter: RateLimiter;
  errorCount: number;
  lastErrorTime: number;
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
    subaccountClient: null,
    rateLimiter: new RateLimiter(DYDX_RATE_LIMITER_CONFIG),
    errorCount: 0,
    lastErrorTime: 0
  };

  // Helper functions
  const initializeClient = async (): Promise<CompositeClient> => {
    if (!context.compositeClient) {
      logger.debug("Initialisation du client composite dYdX");
      
      context.compositeClient = await executeWithRateLimit(
        async () => {
          return await CompositeClient.connect(config.network);
        },
        context.rateLimiter,
        'CompositeClient.connect'
      );
      
      // Charger les configurations de marché avec rate limiting
      try {
        await executeWithRateLimit(
          async () => {
            const marketsResponse = await context.compositeClient!.indexerClient.markets.getPerpetualMarkets();
            if (marketsResponse.markets) {
              for (const [symbol, market] of Object.entries(marketsResponse.markets)) {
                context.markets.set(symbol, market);
              }
              logger.debug(`Chargé ${context.markets.size} marchés depuis dYdX`);
            }
          },
          context.rateLimiter,
          'getPerpetualMarkets'
        );
      } catch (error) {
        logger.error('Échec du chargement des configurations de marché :', error as Error);
      }
    }
    return context.compositeClient;
  };

  const getWallet = async (): Promise<LocalWallet> => {
    if (!context.localWallet && config.mnemonic) {
      logger.debug("Initialisation du portefeuille local à partir de la phrase mnémonique");
      context.localWallet = await LocalWallet.fromMnemonic(config.mnemonic, BECH32_PREFIX);
    }
    
    if (!context.localWallet) {
      throw new Error('Le portefeuille n\'est pas initialisé. Veuillez fournir une phrase mnémonique.');
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
      logger.debug("Initialisation du client de sous-compte");
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
    logger.info("🔄 TRAÇAGE MAPPING - mapOrderSide() appelé :", {
      input_side: side,
      input_side_value: side.toString(),
      OrderSide_BUY: OrderSide.BUY,
      OrderSide_SELL: OrderSide.SELL
    });

    let result: DydxOrderSide;
    switch (side) {
      case OrderSide.BUY:
        result = DydxOrderSide.BUY;
        logger.info("✅ TRAÇAGE MAPPING - Mappé vers DydxOrderSide.BUY :", {
          input: side,
          output: result,
          DydxOrderSide_BUY: DydxOrderSide.BUY
        });
        break;
      case OrderSide.SELL:
        result = DydxOrderSide.SELL;
        logger.info("✅ TRAÇAGE MAPPING - Mappé vers DydxOrderSide.SELL :", {
          input: side,
          output: result,
          DydxOrderSide_SELL: DydxOrderSide.SELL
        });
        break;
      default:
        logger.error(`🚨 TRAÇAGE MAPPING - Valeur non supportée : ${side}`);
        throw new Error(`Unsupported order side: ${side}`);
    }
    
    logger.info("🎯 TRAÇAGE MAPPING - mapOrderSide() résultat final :", {
      input: side,
      output: result,
      are_equal: side === result
    });
    
    return result;
  };
  
  const mapOrderType = (type: OrderType): DydxOrderType => {
    logger.info("🔄 TRAÇAGE MAPPING - mapOrderType() appelé :", {
      input_type: type,
      input_type_value: type.toString(),
      OrderType_MARKET: OrderType.MARKET,
      OrderType_LIMIT: OrderType.LIMIT
    });

    let result: DydxOrderType;
    switch (type) {
      case OrderType.LIMIT:
        result = DydxOrderType.LIMIT;
        logger.info("✅ TRAÇAGE MAPPING - Mappé vers DydxOrderType.LIMIT :", {
          input: type,
          output: result
        });
        break;
      case OrderType.MARKET:
        result = DydxOrderType.MARKET;
        logger.info("✅ TRAÇAGE MAPPING - Mappé vers DydxOrderType.MARKET :", {
          input: type,
          output: result
        });
        break;
      case OrderType.STOP:
        result = DydxOrderType.STOP_LIMIT;
        logger.info("✅ TRAÇAGE MAPPING - Mappé vers DydxOrderType.STOP_LIMIT :", {
          input: type,
          output: result
        });
        break;
      case OrderType.STOP_LIMIT:
        result = DydxOrderType.STOP_LIMIT;
        logger.info("✅ TRAÇAGE MAPPING - Mappé vers DydxOrderType.STOP_LIMIT :", {
          input: type,
          output: result
        });
        break;
      case OrderType.TRAILING_STOP:
        logger.error(`🚨 TRAÇAGE MAPPING - Type non supporté : ${type}`);
        throw new Error(`Trailing stop orders not supported by DYDX API`);
      default:
        logger.error(`🚨 TRAÇAGE MAPPING - Type non reconnu : ${type}`);
        throw new Error(`Unsupported order type: ${type}`);
    }
    
    logger.info("🎯 TRAÇAGE MAPPING - mapOrderType() résultat final :", {
      input: type,
      output: result
    });
    
    return result;
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
      const marketData = await executeWithRateLimit(
        async () => {
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
          
          return {
            symbol,
            price: parseFloat(market.oraclePrice),
            timestamp: Date.now(),
            volume: parseFloat(market.volume24H),
            bid: parseFloat(topBid),
            ask: parseFloat(topAsk),
          };
        },
        context.rateLimiter,
        `fetchMarketData-${symbol}`
      );

      context.marketDataCache.set(symbol, marketData);
      return marketData;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      context.errorCount++;
      context.lastErrorTime = Date.now();
      
      logger.error(`Error fetching market data for ${symbol}:`, error as Error);
      
      // If we have cached data, return that instead of throwing
      const cachedData = context.marketDataCache.get(symbol);
      if (cachedData) {
        logger.warn(`Using cached data for ${symbol} due to API error`);
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
        // Valider que le marché existe
        const client = await getClient();
        const marketResponse = await client.indexerClient.markets.getPerpetualMarkets();
        
        if (!marketResponse.markets || !marketResponse.markets[symbol]) {
          throw new Error(`Le marché ${symbol} n'existe pas`);
        }
        
        // Ajouter aux abonnements et commencer le polling
        context.subscriptions.add(symbol);
        logger.info(`Abonné aux données de marché pour ${symbol}`);
        
        // Récupérer les données initiales
        await fetchAndCacheMarketData(symbol);
        
        // Démarrer le polling pour les mises à jour
        pollMarketData(symbol);
      } catch (error) {
        logger.error(`Échec de l'abonnement aux données de marché pour ${symbol} :`, error as Error);
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

        logger.debug(`Fetching historical data for ${symbol} with limit ${limit}`);
        
        // Fetch historical candles (e.g., 1MIN interval)
        const candlesResponse = await indexerClient.markets.getPerpetualMarketCandles(symbol, '1MIN');
        if (!candlesResponse?.candles || !Array.isArray(candlesResponse.candles)) {
          throw new Error(`No historical candle data found for ${symbol}`);
        }

        logger.debug(`Received ${candlesResponse.candles.length} candles for ${symbol}`);
        
        // Log first candle for debugging
        if (candlesResponse.candles.length > 0) {
          const firstCandle = candlesResponse.candles[0];
          logger.debug(`Sample candle structure:`, {
            keys: Object.keys(firstCandle),
            candle: firstCandle
          });
        }

        // Map candles to MarketData[], taking the most recent ones up to the limit
        const mappedData = candlesResponse.candles
          .slice(-limit) // Take the most recent 'limit' candles
          .map((candle: any, index: number) => {
            // Parse volume with proper fallback and validation
            // dYdX provides both baseTokenVolume and usdVolume, use usdVolume as it's more meaningful
            let volume = 0;
            let volumeSource = "none";
            
            if (candle.usdVolume !== undefined && candle.usdVolume !== null) {
              const parsedVolume = parseFloat(candle.usdVolume.toString());
              volume = isNaN(parsedVolume) ? 0 : Math.max(0, parsedVolume);
              volumeSource = `usdVolume(${candle.usdVolume})`;
            } else if (candle.baseTokenVolume !== undefined && candle.baseTokenVolume !== null) {
              // Fallback to baseTokenVolume if usdVolume not available
              const parsedVolume = parseFloat(candle.baseTokenVolume.toString());
              volume = isNaN(parsedVolume) ? 0 : Math.max(0, parsedVolume);
              volumeSource = `baseTokenVolume(${candle.baseTokenVolume})`;
            }
            
            // Debug volume parsing for first few candles
            if (index < 3) {
              logger.debug(`Volume parsing for ${symbol} candle ${index}:`, {
                usdVolume: candle.usdVolume,
                baseTokenVolume: candle.baseTokenVolume,
                finalVolume: volume,
                volumeSource
              });
            }
            
            // Parse price with validation
            const price = parseFloat(candle.close);
            if (isNaN(price) || price <= 0) {
              logger.warn(`Invalid price in candle for ${symbol}:`, { candle });
              return null;
            }
            
            // Parse timestamp with validation  
            let timestamp = Date.now();
            if (candle.startedAt) {
              const parsedTimestamp = new Date(candle.startedAt).getTime();
              if (!isNaN(parsedTimestamp)) {
                timestamp = parsedTimestamp;
              }
            }

            return {
              symbol,
              price,
              timestamp,
              volume,
              bid: price, // No bid/ask in candle, use close as proxy
              ask: price,
            };
          })
          .filter((data: MarketData | null): data is MarketData => data !== null); // Remove any null entries

        logger.debug(`Mapped ${mappedData.length} valid data points for ${symbol}`);
        
        // Log sample of mapped data for debugging
        if (mappedData.length > 0) {
          logger.debug(`Sample mapped data:`, {
            first: mappedData[0],
            last: mappedData[mappedData.length - 1],
            volumeStats: {
              min: Math.min(...mappedData.map((d: MarketData) => d.volume)),
              max: Math.max(...mappedData.map((d: MarketData) => d.volume)),
              avg: mappedData.reduce((sum: number, d: MarketData) => sum + d.volume, 0) / mappedData.length
            }
          });
        }
        
        return mappedData;
      } catch (error) {
        logger.error(`Failed to fetch historical market data for ${symbol}:`, error as Error);
        return [];
      }
    }
  };

  // TradingPort implementation
  const tradingPort: TradingPort = {
    placeOrder: async (orderParams: OrderParams): Promise<Order> => {
      logger.info("🎯 DydxClient.placeOrder() appelé", { 
        orderParams: {
          symbol: orderParams.symbol,
          side: orderParams.side,
          type: orderParams.type,
          size: orderParams.size,
          price: orderParams.price,
          timeInForce: orderParams.timeInForce,
          postOnly: orderParams.postOnly,
          reduceOnly: orderParams.reduceOnly,
          clientId: orderParams.clientId
        },
        timestamp: new Date().toISOString()
      });

      // Log détaillé des valeurs d'entrée
      logger.info("📋 TRAÇAGE ORDRE - Paramètres d'entrée :", {
        "side_original": orderParams.side,
        "type_original": orderParams.type,
        "side_string": orderParams.side.toString(),
        "type_string": orderParams.type.toString()
      });

      try {
        logger.debug("📡 Obtention des clients dYdX...");
        const compositeClient = await getClient();
        const subaccountClient = await getSubaccountClient();
        logger.debug("✅ Clients obtenus avec succès", {
          hasCompositeClient: !!compositeClient,
          hasSubaccountClient: !!subaccountClient
        });
        
        // Obtenir la configuration du marché
        logger.debug("🏪 Obtention de la configuration du marché...", { symbol: orderParams.symbol });
        const market = getMarketConfig(orderParams.symbol);
        logger.debug("✅ Configuration du marché obtenue", { market });
        
        // Valider la taille de l'ordre par rapport au minimum du marché
        const sizeValidation = validateMinimumQuantums(orderParams.symbol, orderParams.size);
        if (!sizeValidation.isValid && sizeValidation.adjustedSize) {
          logger.warn(`🚨 Validation de la taille de l'ordre échouée pour ${orderParams.symbol} : ${sizeValidation.reason}`);
          logger.info(`📏 Ajustement de la taille de l'ordre de ${orderParams.size} à ${sizeValidation.adjustedSize}`);
          orderParams.size = sizeValidation.adjustedSize;
        } else if (!sizeValidation.isValid) {
          throw new Error(`La taille de l'ordre ${orderParams.size} est inférieure aux exigences minimales pour ${orderParams.symbol} : ${sizeValidation.reason}`);
        }
        
        // Créer les paramètres d'exécution de l'ordre
        const mappedSide = mapOrderSide(orderParams.side);
        const mappedType = mapOrderType(orderParams.type);
        const mappedTimeInForce = mapTimeInForce(orderParams.timeInForce);
        
        // S'assurer que le prix est toujours renseigné et ajusté pour garantir l'exécution
        let priceToUse: number | undefined = orderParams.price;
        
        // Pour les ordres LIMIT et STOP_LIMIT, le prix doit être fourni
        if (
          (orderParams.type === OrderType.LIMIT || orderParams.type === OrderType.STOP_LIMIT) &&
          (priceToUse === undefined || priceToUse === null)
        ) {
          throw new Error("Le prix doit être renseigné pour les ordres LIMIT ou STOP_LIMIT.");
        }
        
        // Pour les ordres MARKET, calculer un prix adapté selon le côté de l'ordre
        if (
          orderParams.type === OrderType.MARKET &&
          (priceToUse === undefined || priceToUse === null)
        ) {
          // Récupérer les données de marché avec bid/ask
          const latestMarketData = await marketDataPort.getLatestMarketData(orderParams.symbol);
          
          // Ajuster le prix selon le côté pour garantir l'exécution
          if (orderParams.side === OrderSide.BUY) {
            // Pour un achat : utiliser le prix ask + une marge pour garantir l'exécution
            const askPrice = latestMarketData.ask || latestMarketData.price;
            priceToUse = askPrice * 1.02; // +2% de marge pour garantir l'exécution
            logger.info("💰 Prix d'achat ajusté pour garantir l'exécution :", { 
              symbol: orderParams.symbol, 
              marketPrice: latestMarketData.price,
              askPrice: askPrice,
              adjustedPrice: priceToUse,
              margin: "2%" 
            });
          } else {
            // Pour une vente : utiliser le prix bid - une marge pour garantir l'exécution
            const bidPrice = latestMarketData.bid || latestMarketData.price;
            priceToUse = bidPrice * 0.98; // -2% de marge pour garantir l'exécution
            logger.info("💸 Prix de vente ajusté pour garantir l'exécution :", { 
              symbol: orderParams.symbol, 
              marketPrice: latestMarketData.price,
              bidPrice: bidPrice,
              adjustedPrice: priceToUse,
              margin: "-2%" 
            });
          }
        }
        
        // Validation finale : s'assurer qu'on a toujours un prix valide
        if (!priceToUse || priceToUse <= 0) {
          throw new Error(`Prix invalide calculé pour l'ordre ${orderParams.symbol}: ${priceToUse}`);
        }
        
        logger.info("🔄 TRAÇAGE ORDRE - Transformations de mapping :", {
          "side_avant_mapping": orderParams.side,
          "side_apres_mapping": mappedSide,
          "type_avant_mapping": orderParams.type,
          "type_apres_mapping": mappedType,
          "timeInForce_avant_mapping": orderParams.timeInForce,
          "timeInForce_apres_mapping": mappedTimeInForce
        });
        
        const execution = {
          subaccountClient,
          marketId: orderParams.symbol,
          side: mappedSide,
          type: mappedType,
          timeInForce: mappedTimeInForce,
          price: priceToUse?.toString() || '0',
          size: orderParams.size.toString(),
          postOnly: orderParams.postOnly || false,
          reduceOnly: orderParams.reduceOnly || false,
          clientId: orderParams.clientId || crypto.randomUUID(),
        };
        
        logger.info("🔧 TRAÇAGE ORDRE - Paramètres d'exécution préparés :", { 
          marketId: execution.marketId,
          side: execution.side,
          type: execution.type,
          price: execution.price,
          size: execution.size,
          timeInForce: execution.timeInForce,
          postOnly: execution.postOnly,
          reduceOnly: execution.reduceOnly,
          clientId: execution.clientId
        });
        
        // Placer l'ordre avec le client subaccount
        const finalSide = mapOrderSide(orderParams.side);
        const finalType = mapOrderType(orderParams.type);
        const finalTimeInForce = orderParams.type === OrderType.MARKET ? undefined : mapTimeInForce(orderParams.timeInForce);
        
        logger.info("🚀 TRAÇAGE ORDRE - Appel de compositeClient.placeOrder() avec :", { 
          symbol: orderParams.symbol,
          type: finalType,
          side: finalSide,
          price: priceToUse || 0,
          size: orderParams.size,
          clientId: orderParams.clientId || 1,
          timeInForce: finalTimeInForce,
          "est_ordre_marche": orderParams.type === OrderType.MARKET
        });
        
        // Log complet avant l'appel API
        logger.info("🎯 TRAÇAGE ORDRE - Valeurs EXACTES passées à compositeClient.placeOrder() :", {
          arg1_subaccountClient: "[SubaccountClient]",
          arg2_symbol: orderParams.symbol,
          arg3_finalType: finalType,
          arg3_finalType_enum_value: Object.keys(DydxOrderType)[Object.values(DydxOrderType).indexOf(finalType)],
          arg4_finalSide: finalSide,
          arg4_finalSide_enum_value: Object.keys(DydxOrderSide)[Object.values(DydxOrderSide).indexOf(finalSide)],
          arg5_price: priceToUse || 0,
          arg6_size: orderParams.size,
          arg7_clientId: orderParams.clientId || 1,
          arg8_finalTimeInForce: finalTimeInForce,
          arg8_finalTimeInForce_enum_value: finalTimeInForce ? Object.keys(OrderTimeInForce)[Object.values(OrderTimeInForce).indexOf(finalTimeInForce)] : "undefined"
        });

        // Vérification des enum values
        logger.info("🔍 TRAÇAGE ORDRE - Vérification des enum values :", {
          DydxOrderSide_BUY: DydxOrderSide.BUY,
          DydxOrderSide_SELL: DydxOrderSide.SELL,
          DydxOrderType_MARKET: DydxOrderType.MARKET,
          DydxOrderType_LIMIT: DydxOrderType.LIMIT,
          finalSide_is_BUY: finalSide === DydxOrderSide.BUY,
          finalSide_is_SELL: finalSide === DydxOrderSide.SELL,
          finalType_is_MARKET: finalType === DydxOrderType.MARKET,
          finalType_is_LIMIT: finalType === DydxOrderType.LIMIT
        });

        // Pour les ordres au marché, ne pas spécifier timeInForce
        logger.info("🚀 TRAÇAGE ORDRE - APPEL IMMINENT de compositeClient.placeOrder()...");
        const response = await compositeClient.placeOrder(
          subaccountClient,
          orderParams.symbol,
          finalType,
          finalSide,
          priceToUse || 0,
          orderParams.size,
          orderParams.clientId || 1,
          finalTimeInForce
        );
        logger.info("✅ TRAÇAGE ORDRE - compositeClient.placeOrder() TERMINÉ");

        logger.debug("✅ compositeClient.placeOrder() terminé", { 
          response: response ? "Réponse reçue" : "Aucune réponse",
          responseKeys: response ? Object.keys(response) : "N/A"
        });

        // Obtenir les détails de l'ordre depuis l'indexeur
        const clientId = execution.clientId;
        const wallet = await getWallet();
        
        logger.debug("👛 Portefeuille obtenu", { 
          address: wallet.address ? `${wallet.address.substring(0, 10)}...` : "Aucune adresse",
          hasWallet: !!wallet
        });

        // Attendre un court instant pour l'indexation de l'ordre
        logger.debug("⏳ Attente de 1 seconde pour l'indexation de l'ordre...");
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Récupérer l'ordre par client ID
        logger.debug("🔍 Récupération de l'ordre depuis l'indexeur...", { clientId });
        const client = await getClient();
        const subaccountInfo = await getDefaultSubaccount();
        
        logger.debug("📊 Infos du sous-compte obtenues", { 
          subaccountNumber: subaccountInfo.subaccountNumber,
          walletAddress: wallet.address ? `${wallet.address.substring(0, 10)}...` : "Aucune adresse"
        });
        
        const ordersResponse = await client.indexerClient.account.getSubaccountOrders(
          wallet.address || '',
          subaccountInfo.subaccountNumber
        );

        logger.debug("📋 Réponse des ordres reçue", { 
          ordersCount: ordersResponse.orders?.length || 0,
          hasOrders: !!(ordersResponse.orders && ordersResponse.orders.length > 0)
        });

        // Correction : trouver l'ordre par clientId (pas juste prendre le premier)
        if (ordersResponse.orders && ordersResponse.orders.length > 0) {
          logger.debug("🔍 Recherche de l'ordre par clientId...", { 
            clientId,
            availableClientIds: ordersResponse.orders.map((o: any) => o.clientId)
          });
          
          const foundOrder = ordersResponse.orders.find((o: any) => o.clientId === clientId);
          if (foundOrder) {
            logger.debug("✅ Ordre trouvé dans l'indexeur", { 
              orderId: foundOrder.id,
              status: foundOrder.status,
              clientId: foundOrder.clientId
            });
            const mappedOrder = mapDydxOrderToOrder(foundOrder);
            logger.debug("🔄 Ordre mappé avec succès", { mappedOrder });
            return mappedOrder;
          } else {
            logger.warn("⚠️ Ordre non trouvé par clientId", { 
              searchedClientId: clientId,
              availableOrders: ordersResponse.orders.length
            });
          }
        } else {
          logger.warn("⚠️ Aucun ordre trouvé dans la réponse");
        }

        // Si on ne trouve pas l'ordre, créer un ordre synthétique
        logger.debug("🔧 Création d'un ordre synthétique (ordre non trouvé dans l'indexeur)");
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
        
        logger.debug("✅ Ordre synthétique créé", { syntheticOrder });
        return syntheticOrder;
      } catch (error) {
        const errorMessage = (error as Error).message;
        
        // Enhanced error handling for "Order is fully filled" scenarios
        if (errorMessage && (
          errorMessage.includes("Order is fully filled") ||
          errorMessage.includes("Remaining amount: 0") ||
          errorMessage.includes("Order remaining amount is less than MinOrderBaseQuantums")
        )) {
          logger.info(`🎉 Order treated as successfully filled due to duplicate prevention for ${orderParams.symbol}`, {
            originalError: errorMessage,
            orderParams: {
              symbol: orderParams.symbol,
              side: orderParams.side,
              type: orderParams.type,
              size: orderParams.size,
              price: orderParams.price
            }
          });
          
          // Return a synthetic "filled" order to maintain trading flow
          const filledOrder: Order = {
            id: `filled_duplicate_${Date.now()}`,
            symbol: orderParams.symbol,
            side: orderParams.side,
            type: orderParams.type,
            size: orderParams.size,
            price: orderParams.price || 0,
            status: OrderStatus.FILLED,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            filledSize: orderParams.size,
            avgFillPrice: orderParams.price || 0,
            reduceOnly: orderParams.reduceOnly || false,
            postOnly: orderParams.postOnly || false,
          };
          
          logger.info(`✅ Synthetic filled order created for ${orderParams.symbol} to prevent strategy interruption`);
          return filledOrder;
        }
        
        logger.error('🚨 Échec du placement de l\'ordre :', error as Error);
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
        logger.debug(`Annulation de l'ordre ${symbol}`);
        await compositeClient.cancelOrder(subaccountClient, 0, OrderFlags.SHORT_TERM, symbol);
        
        return true;
      } catch (error) {
        logger.error(`Échec de l'annulation de l'ordre ${symbol} :`, error as Error);
        return false;
      }
    },

    getOrder: async (orderId: string): Promise<Order | null> => {
      try {
        const client = await getClient();
        const wallet = await getWallet();
        
        const subaccountInfo = await getDefaultSubaccount();
        if (!subaccountInfo) return null;
        
        logger.debug(`Récupération des détails de l'ordre pour ${orderId}`);
        const orderResponse = await client.indexerClient.account.getSubaccountOrders(
          wallet.address || '',
          subaccountInfo.subaccountNumber
        );
        
        if (!orderResponse || !orderResponse.order) return null;
        
        return mapDydxOrderToOrder(orderResponse.order);
      } catch (error) {
        logger.error(`Échec de la récupération de l'ordre ${orderId} :`, error as Error);
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
        
        logger.debug("Récupération des ordres ouverts", { symbol });
        const ordersResponse = await client.indexerClient.account.getSubaccountOrders(
          wallet.address || '',
          subaccountInfo.subaccountNumber,
          ...queryParams
        );
        
        if (!ordersResponse || !ordersResponse.orders) return [];
        
        return ordersResponse.orders.map(mapDydxOrderToOrder);
      } catch (error) {
        logger.error('Échec de la récupération des ordres ouverts :', error as Error);
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
        logger.debug("Récupération des soldes du compte");
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
        logger.error('Échec de la récupération du solde du compte :', error as Error);
        return {};
      }
    }
  };

  // Initialize client immediately
  initializeClient().catch(error => {
    logger.error('Échec de l\'initialisation du client DYDX :', error as Error);
  });

  return { marketDataPort, tradingPort };
};