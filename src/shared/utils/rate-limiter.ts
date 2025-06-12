import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";

const logger = createContextualLogger('RateLimiter');

export interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
  retryDelay: number;
  maxRetries: number;
  backoffMultiplier: number;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
}

export interface RateLimitResult {
  allowed: boolean;
  waitTime?: number;
  retryAfter?: number;
}

export class RateLimiter {
  private requests: number[] = [];
  private circuitBreakerOpen = false;
  private circuitBreakerOpenTime = 0;
  private consecutiveFailures = 0;

  constructor(private config: RateLimiterConfig) {}

  /**
   * Check if a request is allowed based on rate limits
   */
  checkLimit(): RateLimitResult {
    const now = Date.now();
    
    // Check circuit breaker
    if (this.circuitBreakerOpen) {
      if (now - this.circuitBreakerOpenTime < this.config.circuitBreakerTimeout) {
        return {
          allowed: false,
          waitTime: this.config.circuitBreakerTimeout - (now - this.circuitBreakerOpenTime)
        };
      } else {
        // Try to close the circuit breaker
        this.circuitBreakerOpen = false;
        this.consecutiveFailures = 0;
        logger.info('Circuit breaker closed, allowing requests again');
      }
    }

    // Clean old requests outside the window
    this.requests = this.requests.filter(
      time => now - time < this.config.windowMs
    );

    // Check if we're at the limit
    if (this.requests.length >= this.config.maxRequests) {
      const oldestRequest = Math.min(...this.requests);
      const waitTime = this.config.windowMs - (now - oldestRequest);
      
      return {
        allowed: false,
        waitTime: Math.max(0, waitTime)
      };
    }

    // Request is allowed
    this.requests.push(now);
    return { allowed: true };
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  /**
   * Record a failed request (e.g., 429 error)
   */
  recordFailure(): void {
    this.consecutiveFailures++;
    
    if (this.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      this.circuitBreakerOpen = true;
      this.circuitBreakerOpenTime = Date.now();
      logger.warn(`Circuit breaker opened after ${this.consecutiveFailures} consecutive failures`);
    }
  }

  /**
   * Calculate exponential backoff delay for retries
   */
  calculateBackoffDelay(attempt: number): number {
    return Math.min(
      this.config.retryDelay * Math.pow(this.config.backoffMultiplier, attempt),
      30000 // Max 30 seconds
    );
  }

  /**
   * Get the current state of the rate limiter
   */
  getStatus() {
    return {
      requestsInWindow: this.requests.length,
      maxRequests: this.config.maxRequests,
      circuitBreakerOpen: this.circuitBreakerOpen,
      consecutiveFailures: this.consecutiveFailures
    };
  }
}

/**
 * Utility function to execute a function with rate limiting and retry logic
 */
export async function executeWithRateLimit<T>(
  fn: () => Promise<T>,
  rateLimiter: RateLimiter,
  context: string = 'API call'
): Promise<T> {
  let attempt = 0;
  const maxRetries = rateLimiter['config'].maxRetries;

  while (attempt <= maxRetries) {
    try {
      // Check rate limit
      const limitResult = rateLimiter.checkLimit();
      
      if (!limitResult.allowed) {
        const waitTime = limitResult.waitTime || 1000;
        logger.warn(`${context} rate limited, waiting ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      // Execute the function
      const result = await fn();
      rateLimiter.recordSuccess();
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if it's a rate limiting error
      if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
        rateLimiter.recordFailure();
        
        if (attempt >= maxRetries) {
          logger.error(`${context} failed after ${maxRetries} retries due to rate limiting`);
          throw error;
        }

        const backoffDelay = rateLimiter.calculateBackoffDelay(attempt);
        logger.warn(`${context} rate limited (429), retrying in ${backoffDelay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
        
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        attempt++;
        continue;
      }

      // For non-rate-limiting errors, throw immediately
      throw error;
    }
  }

  throw new Error(`${context} failed after ${maxRetries} retries`);
}

/**
 * Default rate limiter configuration for dYdX API
 */
export const DYDX_RATE_LIMITER_CONFIG: RateLimiterConfig = {
  maxRequests: 10, // Conservative limit
  windowMs: 60000, // 1 minute window
  retryDelay: 1000, // Start with 1 second
  maxRetries: 5,
  backoffMultiplier: 2,
  circuitBreakerThreshold: 3, // Open circuit after 3 consecutive failures
  circuitBreakerTimeout: 30000 // Keep circuit open for 30 seconds
};
