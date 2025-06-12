import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";
import { OrderParams } from "../../domain/models/market.model";

const logger = createContextualLogger('OrderDeduplication');

/**
 * Generate a deterministic client ID based on order parameters to prevent duplicates
 */
export function generateDeterministicClientId(orderParams: OrderParams): number {
  const key = `${orderParams.symbol}-${orderParams.side}-${orderParams.type}-${orderParams.size}`;
  
  // Use timestamp rounded to nearest 5 seconds to allow for some variation
  // but prevent rapid-fire duplicates
  const roundedTimestamp = Math.floor(Date.now() / 5000) * 5000;
  
  // Generate a numeric hash from the string key
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  // Combine with rounded timestamp and ensure positive number
  const clientId = Math.abs(hash + (roundedTimestamp % 1000000));
  
  logger.debug(`Generated deterministic client ID: ${clientId}`, {
    symbol: orderParams.symbol,
    side: orderParams.side,
    type: orderParams.type,
    size: orderParams.size,
    timestamp: roundedTimestamp,
    hash,
    key
  });
  
  return clientId;
}

/**
 * Check if two orders are considered duplicates based on their parameters
 */
export function areOrdersDuplicates(order1: OrderParams, order2: OrderParams): boolean {
  return (
    order1.symbol === order2.symbol &&
    order1.side === order2.side &&
    order1.type === order2.type &&
    Math.abs(order1.size - order2.size) < 0.0001 && // Allow for tiny rounding differences
    (
      (order1.price === undefined && order2.price === undefined) ||
      (order1.price !== undefined && order2.price !== undefined && Math.abs(order1.price - order2.price) < 0.01)
    )
  );
}

/**
 * Cache to track recent orders and prevent duplicates
 */
class OrderCache {
  private cache = new Map<string, { orderParams: OrderParams; timestamp: number }>();
  private readonly CACHE_DURATION = 30000; // 30 seconds

  /**
   * Check if an order is a duplicate of a recent order
   */
  isDuplicate(orderParams: OrderParams): boolean {
    const now = Date.now();
    
    // Clean expired entries
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.CACHE_DURATION) {
        this.cache.delete(key);
      }
    }
    
    // Check for duplicates
    for (const [key, entry] of this.cache.entries()) {
      if (areOrdersDuplicates(orderParams, entry.orderParams)) {
        logger.warn(`Duplicate order detected`, {
          newOrder: orderParams,
          existingOrder: entry.orderParams,
          timeSinceOriginal: now - entry.timestamp
        });
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Add an order to the cache
   */
  addOrder(orderParams: OrderParams): void {
    const key = `${orderParams.symbol}-${orderParams.side}-${orderParams.type}-${orderParams.size}-${Math.floor(Date.now() / 5000) * 5000}`;
    this.cache.set(key, {
      orderParams: { ...orderParams },
      timestamp: Date.now()
    });
    
    logger.debug(`Order added to deduplication cache`, {
      key,
      orderParams
    });
  }
  
  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
    logger.debug('Order deduplication cache cleared');
  }
}

// Global cache instance
export const orderCache = new OrderCache();
