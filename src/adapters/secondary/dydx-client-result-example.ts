/**
 * Example implementation using the enhanced Result pattern
 * This file demonstrates how to refactor parts of the dydx-client.adapter.ts
 * to use the new Result pattern
 */

import { Result } from '../../shared/types';
import { resultUtils, resultTransforms } from '../../shared/utils/result-index';
import { wrapAsync, executeAsync } from '../../shared/utils/async-result';
import { errorHandler } from '../../shared/errors/error-handler';
import { MarketData } from '../../domain/models/market.model';

/**
 * Example refactored function for fetching market data using Result pattern
 */
export const fetchMarketDataWithResult = async (
  symbol: string,
  indexerClient: any,
  marketDataCache: Map<string, MarketData>
): Promise<Result<MarketData>> => {
  // First check if we have cached data to use as fallback
  const cachedData = marketDataCache.get(symbol);
  
  // Function to get market data that we'll wrap with Result pattern
  const fetchData = async (): Promise<MarketData> => {
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
  };

  // Use executeAsync with simple retry logic
  const result = await executeAsync(fetchData);
  
  // If successful, cache the data
  if (result.success && result.data) {
    marketDataCache.set(symbol, result.data);
    return result;
  }
  
  // If we have cached data, use it as fallback
  if (cachedData) {
    // Log the error but return cached data as a success
    console.warn(`Using cached market data for ${symbol} due to fetch error:`, result.error);
    return resultUtils.success(cachedData, "Using cached data as fallback");
  }
  
  // No cached data and fetch failed
  return result;
}

/**
 * Example of polling market data with Result pattern
 */
export const pollMarketDataWithResult = (
  symbol: string,
  fetchFn: () => Promise<Result<MarketData>>,
  subscriptions: Set<string>,
  onData: (data: MarketData) => void
): void => {
  let errorCount = 0;
  let lastSuccess = Date.now();
  
  const poll = async () => {
    if (!subscriptions.has(symbol)) return;
    
    const result = await fetchFn();
    
    if (result.success) {
      // Reset error counter on success
      errorCount = 0;
      lastSuccess = Date.now();
      onData(result.data!);
    } else {
      // Handle error with exponential backoff
      errorCount++;
      const backoffTime = Math.min(Math.pow(2, errorCount) * 1000, 30000);
      console.error(`Error polling ${symbol}, retry in ${backoffTime}ms:`, result.error);
      
      // If too many errors or too long since last success, alert
      if (errorCount > 5 || Date.now() - lastSuccess > 5 * 60 * 1000) {
        console.error(`Critical polling failure for ${symbol}, alert system required`);
      }
    }
    
    // Schedule next poll if still subscribed
    if (subscriptions.has(symbol)) {
      setTimeout(poll, 1000);
    }
  };
  
  // Start polling
  poll();
}

/**
 * Example of placing an order with Result pattern
 */
export const placeOrderWithResult = async (
  client: any,
  orderParams: any
): Promise<Result<any>> => {
  // Validate input parameters first
  const validationResult = resultTransforms.validate(
    orderParams,
    (params) => !!params.symbol && !!params.side && !!params.size,
    'Invalid order parameters: symbol, side, and size are required'
  );
  
  if (!validationResult.success) {
    return validationResult;
  }
  
  // Function to place the order
  const placeOrderFn = async () => {
    const response = await client.privateApi.createOrder({
      market: orderParams.symbol,
      side: orderParams.side,
      type: orderParams.type || 'LIMIT',
      size: orderParams.size.toString(),
      price: orderParams.price?.toString(),
      timeInForce: orderParams.timeInForce || 'GTT',
      // Add any other required parameters
    });
    
    if (!response || !response.order) {
      throw new Error('Order creation failed: No order in response');
    }
    
    return {
      id: response.order.id,
      symbol: response.order.market,
      side: response.order.side,
      status: response.order.status,
      price: parseFloat(response.order.price),
      size: parseFloat(response.order.size),
      timestamp: new Date(response.order.createdAt).getTime(),
    };
  };
  
  // Use executeAsync for order placement
  return await executeAsync(placeOrderFn);
}
