import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";

const logger = createContextualLogger("RateLimiter");

export interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
  retryDelay: number;
  maxRetries: number;
  backoffMultiplier: number;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
  // New burst handling options
  burstSize?: number;
  tokenRefillRate?: number; // tokens per second
  enableTokenBucket?: boolean;
  // Request categorization
  categoryLimits?: Record<string, number>;
  // Monitoring
  enableDetailedStats?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  waitTime?: number;
  retryAfter?: number;
  tokensRemaining?: number;
  category?: string;
}

export interface RateLimiterStats {
  totalRequests: number;
  allowedRequests: number;
  blockedRequests: number;
  circuitBreakerActivations: number;
  avgWaitTime: number;
  requestsByCategory: Record<string, number>;
  tokensAvailable?: number;
  lastRefillTime?: number;
}

export class RateLimiter {
  private requests: number[] = [];
  private circuitBreakerOpen = false;
  private circuitBreakerOpenTime = 0;
  private consecutiveFailures = 0;

  // Token bucket implementation
  private tokens: number;
  private lastRefillTime: number;

  // Statistics
  private stats: RateLimiterStats = {
    totalRequests: 0,
    allowedRequests: 0,
    blockedRequests: 0,
    circuitBreakerActivations: 0,
    avgWaitTime: 0,
    requestsByCategory: {},
  };

  // Category-specific request tracking
  private categoryRequests: Map<string, number[]> = new Map();

  constructor(private config: RateLimiterConfig) {
    // Initialize token bucket
    this.tokens = config.burstSize || config.maxRequests;
    this.lastRefillTime = Date.now();

    // Start token refill timer if enabled
    if (config.enableTokenBucket && config.tokenRefillRate) {
      setInterval(() => this.refillTokens(), 1000);
    }
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refillTokens(): void {
    if (!this.config.enableTokenBucket || !this.config.tokenRefillRate) return;

    const now = Date.now();
    const elapsed = (now - this.lastRefillTime) / 1000; // seconds
    const tokensToAdd = elapsed * this.config.tokenRefillRate;

    this.tokens = Math.min(
      this.tokens + tokensToAdd,
      this.config.burstSize || this.config.maxRequests,
    );

    this.lastRefillTime = now;

    if (this.config.enableDetailedStats) {
      this.stats.tokensAvailable = this.tokens;
      this.stats.lastRefillTime = now;
    }
  }

  /**
   * Check if a request is allowed based on rate limits
   */
  checkLimit(category?: string): RateLimitResult {
    const now = Date.now();
    this.stats.totalRequests++;

    // Check circuit breaker
    if (this.circuitBreakerOpen) {
      if (
        now - this.circuitBreakerOpenTime <
        this.config.circuitBreakerTimeout
      ) {
        this.stats.blockedRequests++;
        const waitTime =
          this.config.circuitBreakerTimeout -
          (now - this.circuitBreakerOpenTime);
        this.updateAvgWaitTime(waitTime);

        return {
          allowed: false,
          waitTime,
          tokensRemaining: this.config.enableTokenBucket
            ? this.tokens
            : undefined,
          category,
        };
      } else {
        // Try to close the circuit breaker
        this.circuitBreakerOpen = false;
        this.consecutiveFailures = 0;
        logger.info("Circuit breaker closed, allowing requests again");
      }
    }

    // Check category-specific limits
    if (category && this.config.categoryLimits) {
      const categoryLimit = this.config.categoryLimits[category];
      if (categoryLimit) {
        const categoryReqs = this.categoryRequests.get(category) || [];
        const recentCategoryReqs = categoryReqs.filter(
          (time) => now - time < this.config.windowMs,
        );

        if (recentCategoryReqs.length >= categoryLimit) {
          this.stats.blockedRequests++;
          const oldestRequest = Math.min(...recentCategoryReqs);
          const waitTime = this.config.windowMs - (now - oldestRequest);
          this.updateAvgWaitTime(waitTime);

          return {
            allowed: false,
            waitTime: Math.max(0, waitTime),
            tokensRemaining: this.config.enableTokenBucket
              ? this.tokens
              : undefined,
            category,
          };
        }
      }
    }

    // Use token bucket if enabled
    if (this.config.enableTokenBucket) {
      this.refillTokens();

      if (this.tokens < 1) {
        this.stats.blockedRequests++;
        const waitTime = 1000 / (this.config.tokenRefillRate || 1);
        this.updateAvgWaitTime(waitTime);

        return {
          allowed: false,
          waitTime,
          tokensRemaining: this.tokens,
          category,
        };
      }

      // Consume a token
      this.tokens--;
    } else {
      // Traditional sliding window
      this.requests = this.requests.filter(
        (time) => now - time < this.config.windowMs,
      );

      // Check if we're at the limit
      if (this.requests.length >= this.config.maxRequests) {
        this.stats.blockedRequests++;
        const oldestRequest = Math.min(...this.requests);
        const waitTime = this.config.windowMs - (now - oldestRequest);
        this.updateAvgWaitTime(waitTime);

        return {
          allowed: false,
          waitTime: Math.max(0, waitTime),
          category,
        };
      }

      // Add to sliding window
      this.requests.push(now);
    }

    // Request is allowed
    this.stats.allowedRequests++;

    // Track category requests
    if (category) {
      if (!this.categoryRequests.has(category)) {
        this.categoryRequests.set(category, []);
      }
      this.categoryRequests.get(category)!.push(now);

      if (this.config.enableDetailedStats) {
        this.stats.requestsByCategory[category] =
          (this.stats.requestsByCategory[category] || 0) + 1;
      }
    }

    return {
      allowed: true,
      tokensRemaining: this.config.enableTokenBucket ? this.tokens : undefined,
      category,
    };
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  /**
   * Update average wait time
   */
  private updateAvgWaitTime(waitTime: number): void {
    if (!this.config.enableDetailedStats) return;

    const totalWaitTime =
      this.stats.avgWaitTime * (this.stats.blockedRequests - 1);
    this.stats.avgWaitTime =
      (totalWaitTime + waitTime) / this.stats.blockedRequests;
  }

  /**
   * Record a failed request (e.g., 429 error)
   */
  recordFailure(): void {
    this.consecutiveFailures++;

    if (this.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      this.circuitBreakerOpen = true;
      this.circuitBreakerOpenTime = Date.now();
      this.stats.circuitBreakerActivations++;
      logger.warn(
        `Circuit breaker opened after ${this.consecutiveFailures} consecutive failures`,
      );
    }
  }

  /**
   * Calculate exponential backoff delay for retries
   */
  calculateBackoffDelay(attempt: number): number {
    return Math.min(
      this.config.retryDelay * Math.pow(this.config.backoffMultiplier, attempt),
      30000, // Max 30 seconds
    );
  }

  /**
   * Get the current state of the rate limiter
   */
  getStatus() {
    const status = {
      requestsInWindow: this.requests.length,
      maxRequests: this.config.maxRequests,
      circuitBreakerOpen: this.circuitBreakerOpen,
      consecutiveFailures: this.consecutiveFailures,
      tokensAvailable: this.config.enableTokenBucket ? this.tokens : undefined,
    };

    if (this.config.enableDetailedStats) {
      return { ...status, stats: this.getStats() };
    }

    return status;
  }

  /**
   * Get detailed statistics
   */
  getStats(): RateLimiterStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      allowedRequests: 0,
      blockedRequests: 0,
      circuitBreakerActivations: 0,
      avgWaitTime: 0,
      requestsByCategory: {},
      tokensAvailable: this.tokens,
      lastRefillTime: this.lastRefillTime,
    };
  }
}

/**
 * Utility function to execute a function with rate limiting and retry logic
 */
export async function executeWithRateLimit<T>(
  fn: () => Promise<T>,
  rateLimiter: RateLimiter,
  context: string = "API call",
  category?: string,
): Promise<T> {
  let attempt = 0;
  const maxRetries = rateLimiter["config"].maxRetries;

  while (attempt <= maxRetries) {
    try {
      // Check rate limit
      const limitResult = rateLimiter.checkLimit(category);

      if (!limitResult.allowed) {
        const waitTime = limitResult.waitTime || 1000;
        logger.warn(`${context} rate limited, waiting ${waitTime}ms`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }

      // Execute the function
      const result = await fn();
      rateLimiter.recordSuccess();
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check if it's a rate limiting error
      if (
        errorMessage.includes("429") ||
        errorMessage.includes("Too Many Requests")
      ) {
        rateLimiter.recordFailure();

        if (attempt >= maxRetries) {
          logger.error(
            `${context} failed after ${maxRetries} retries due to rate limiting`,
          );
          throw error;
        }

        const backoffDelay = rateLimiter.calculateBackoffDelay(attempt);
        logger.warn(
          `${context} rate limited (429), retrying in ${backoffDelay}ms (attempt ${attempt + 1}/${maxRetries + 1})`,
        );

        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
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
  circuitBreakerTimeout: 30000, // Keep circuit open for 30 seconds
  // Enhanced features
  burstSize: 15, // Allow bursts up to 15 requests
  tokenRefillRate: 0.167, // 10 requests per minute = 0.167 per second
  enableTokenBucket: true,
  categoryLimits: {
    market_data: 20, // Higher limit for read-only operations
    orders: 5, // Lower limit for write operations
    account: 10,
  },
  enableDetailedStats: true,
};
