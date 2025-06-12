import { createContextualLogger } from "../../../infrastructure/logging/enhanced-logger";
import { RateLimiter, executeWithRateLimit } from "../rate-limiter";

const logger = createContextualLogger("APIQueueManager");

/**
 * Priority levels for API requests
 */
export enum RequestPriority {
  CRITICAL = 0,  // Real-time trading decisions
  HIGH = 1,      // Order management
  NORMAL = 2,    // Market data updates
  LOW = 3,       // Historical data, analytics
}

/**
 * Request types for batching optimization
 */
export enum RequestType {
  MARKET_DATA = "MARKET_DATA",
  ORDER_PLACEMENT = "ORDER_PLACEMENT",
  ORDER_STATUS = "ORDER_STATUS",
  ACCOUNT_INFO = "ACCOUNT_INFO",
  HISTORICAL_DATA = "HISTORICAL_DATA",
}

/**
 * Configuration for the API queue manager
 */
export interface APIQueueConfig {
  // Maximum concurrent requests
  maxConcurrentRequests: number;

  // Minimum delay between requests (ms)
  minRequestDelay: number;

  // Maximum queue size per priority
  maxQueueSizePerPriority: number;

  // Enable request batching
  enableBatching: boolean;

  // Batch window (ms) - time to wait for similar requests
  batchWindowMs: number;

  // Maximum batch size
  maxBatchSize: number;

  // Enable adaptive rate limiting
  enableAdaptiveRateLimit: boolean;

  // Smooth factor for request distribution (0-1)
  smoothingFactor: number;
}

/**
 * Queued API request
 */
interface QueuedRequest<T = any> {
  id: string;
  type: RequestType;
  priority: RequestPriority;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timestamp: number;
  retryCount: number;
  metadata?: Record<string, any>;
}

/**
 * Queue statistics for monitoring
 */
interface QueueStatistics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgExecutionTime: number;
  queuedByPriority: Record<RequestPriority, number>;
  currentThroughput: number;
  adaptiveDelayMs: number;
}

/**
 * Batch of similar requests
 */
interface RequestBatch<T = any> {
  type: RequestType;
  requests: QueuedRequest<T>[];
  execute: () => Promise<Map<string, T>>;
}

/**
 * Intelligent API Queue Manager with adaptive rate limiting and request smoothing
 */
export class APIQueueManager {
  private queues: Map<RequestPriority, QueuedRequest[]> = new Map();
  private isProcessing = false;
  private statistics: QueueStatistics;
  private rateLimiter: RateLimiter;
  private concurrentRequests = 0;
  private lastRequestTime = 0;
  private adaptiveDelay = 0;
  private requestHistory: { timestamp: number; success: boolean }[] = [];
  private batchAccumulator: Map<RequestType, QueuedRequest[]> = new Map();
  private batchTimers: Map<RequestType, NodeJS.Timeout> = new Map();

  constructor(
    private config: APIQueueConfig,
    rateLimiter: RateLimiter
  ) {
    this.rateLimiter = rateLimiter;

    // Initialize queues for each priority
    Object.values(RequestPriority).forEach(priority => {
      if (typeof priority === "number") {
        this.queues.set(priority, []);
      }
    });

    // Initialize statistics
    this.statistics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgExecutionTime: 0,
      queuedByPriority: {
        [RequestPriority.CRITICAL]: 0,
        [RequestPriority.HIGH]: 0,
        [RequestPriority.NORMAL]: 0,
        [RequestPriority.LOW]: 0,
      },
      currentThroughput: 0,
      adaptiveDelayMs: config.minRequestDelay,
    };

    // Start periodic statistics update
    setInterval(() => this.updateStatistics(), 5000);
  }

  /**
   * Add a request to the queue
   */
  async enqueue<T>(
    type: RequestType,
    priority: RequestPriority,
    execute: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const request: QueuedRequest<T> = {
        id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type,
        priority,
        execute,
        resolve,
        reject,
        timestamp: Date.now(),
        retryCount: 0,
        metadata,
      };

      // Check queue size limits
      const queue = this.queues.get(priority)!;
      if (queue.length >= this.config.maxQueueSizePerPriority) {
        const error = new Error(`Queue full for priority ${RequestPriority[priority]}`);
        logger.warn("Queue full, rejecting request", { priority, type });
        reject(error);
        return;
      }

      // Add to queue
      queue.push(request);
      this.statistics.queuedByPriority[priority]++;
      this.statistics.totalRequests++;

      logger.debug("Request queued", {
        id: request.id,
        type,
        priority: RequestPriority[priority],
        queueLength: queue.length,
      });

      // Start processing if not already running
      if (!this.isProcessing) {
        this.startProcessing();
      }
    });
  }

  /**
   * Start processing queued requests
   */
  private async startProcessing(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;
    logger.info("Starting queue processing");

    while (this.hasQueuedRequests()) {
      try {
        // Apply adaptive delay for smooth distribution
        await this.applySmoothedDelay();

        // Process next batch of requests
        await this.processNextBatch();

      } catch (error) {
        logger.error("Error in queue processing", error as Error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    this.isProcessing = false;
    logger.info("Queue processing completed");
  }

  /**
   * Check if there are queued requests
   */
  private hasQueuedRequests(): boolean {
    return Array.from(this.queues.values()).some(queue => queue.length > 0);
  }

  /**
   * Apply smoothed delay between requests
   */
  private async applySmoothedDelay(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    // Calculate adaptive delay based on recent history
    if (this.config.enableAdaptiveRateLimit) {
      this.updateAdaptiveDelay();
    }

    const targetDelay = Math.max(
      this.config.minRequestDelay,
      this.adaptiveDelay
    );

    // Apply smoothing factor
    const smoothedDelay = targetDelay * (1 + this.config.smoothingFactor * Math.random());

    if (timeSinceLastRequest < smoothedDelay) {
      const waitTime = smoothedDelay - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Update adaptive delay based on recent success/failure rates
   */
  private updateAdaptiveDelay(): void {
    const recentHistory = this.requestHistory.filter(
      h => Date.now() - h.timestamp < 60000 // Last minute
    );

    if (recentHistory.length < 10) return;

    const failureRate = recentHistory.filter(h => !h.success).length / recentHistory.length;

    // Increase delay if failure rate is high
    if (failureRate > 0.2) {
      this.adaptiveDelay = Math.min(
        this.adaptiveDelay * 1.5,
        this.config.minRequestDelay * 10
      );
    } else if (failureRate < 0.05) {
      // Decrease delay if success rate is high
      this.adaptiveDelay = Math.max(
        this.adaptiveDelay * 0.9,
        this.config.minRequestDelay
      );
    }

    this.statistics.adaptiveDelayMs = this.adaptiveDelay;
  }

  /**
   * Process the next batch of requests
   */
  private async processNextBatch(): Promise<void> {
    // Check concurrent request limit
    if (this.concurrentRequests >= this.config.maxConcurrentRequests) {
      await new Promise(resolve => setTimeout(resolve, 100));
      return;
    }

    // Get next request by priority
    const request = this.getNextRequest();
    if (!request) return;

    // Check if we should batch this request
    if (this.config.enableBatching && this.isBatchableRequest(request)) {
      await this.handleBatchableRequest(request);
    } else {
      await this.executeRequest(request);
    }
  }

  /**
   * Get the next request from queues by priority
   */
  private getNextRequest(): QueuedRequest | null {
    for (const priority of [
      RequestPriority.CRITICAL,
      RequestPriority.HIGH,
      RequestPriority.NORMAL,
      RequestPriority.LOW,
    ]) {
      const queue = this.queues.get(priority)!;
      if (queue.length > 0) {
        const request = queue.shift()!;
        this.statistics.queuedByPriority[priority]--;
        return request;
      }
    }
    return null;
  }

  /**
   * Check if a request can be batched
   */
  private isBatchableRequest(request: QueuedRequest): boolean {
    return [
      RequestType.MARKET_DATA,
      RequestType.ORDER_STATUS,
      RequestType.HISTORICAL_DATA,
    ].includes(request.type);
  }

  /**
   * Handle a batchable request
   */
  private async handleBatchableRequest(request: QueuedRequest): Promise<void> {
    // Add to batch accumulator
    if (!this.batchAccumulator.has(request.type)) {
      this.batchAccumulator.set(request.type, []);
    }

    const batch = this.batchAccumulator.get(request.type)!;
    batch.push(request);

    // Clear existing timer
    const existingTimer = this.batchTimers.get(request.type);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // If batch is full, execute immediately
    if (batch.length >= this.config.maxBatchSize) {
      await this.executeBatch(request.type);
    } else {
      // Otherwise, set a timer to execute the batch
      const timer = setTimeout(async () => {
        await this.executeBatch(request.type);
      }, this.config.batchWindowMs);

      this.batchTimers.set(request.type, timer);
    }
  }

  /**
   * Execute a batch of requests
   */
  private async executeBatch(type: RequestType): Promise<void> {
    const batch = this.batchAccumulator.get(type);
    if (!batch || batch.length === 0) return;

    this.batchAccumulator.set(type, []);
    this.batchTimers.delete(type);

    logger.info(`Executing batch of ${batch.length} ${type} requests`);

    // Execute all requests in the batch
    await Promise.all(batch.map(request => this.executeRequest(request)));
  }

  /**
   * Execute a single request
   */
  private async executeRequest<T>(request: QueuedRequest<T>): Promise<void> {
    this.concurrentRequests++;
    const startTime = Date.now();

    try {
      logger.debug("Executing request", {
        id: request.id,
        type: request.type,
        priority: RequestPriority[request.priority],
      });

      // Execute with rate limiter
      const result = await executeWithRateLimit(
        request.execute,
        this.rateLimiter,
        `${request.type}_${request.id}`
      );

      // Record success
      this.recordRequestResult(true, Date.now() - startTime);
      this.statistics.successfulRequests++;

      request.resolve(result);

    } catch (error) {
      logger.error("Request failed", {
        id: request.id,
        error: error as Error,
        retryCount: request.retryCount,
      });

      // Record failure
      this.recordRequestResult(false, Date.now() - startTime);
      this.statistics.failedRequests++;

      // Check if we should retry
      if (this.shouldRetry(request, error as Error)) {
        request.retryCount++;
        // Re-queue with lower priority
        const retryPriority = Math.min(
          request.priority + 1,
          RequestPriority.LOW
        ) as RequestPriority;

        const queue = this.queues.get(retryPriority)!;
        queue.push(request);
        this.statistics.queuedByPriority[retryPriority]++;
      } else {
        request.reject(error as Error);
      }
    } finally {
      this.concurrentRequests--;
    }
  }

  /**
   * Record request result for adaptive rate limiting
   */
  private recordRequestResult(success: boolean, executionTime: number): void {
    this.requestHistory.push({
      timestamp: Date.now(),
      success,
    });

    // Keep only recent history
    this.requestHistory = this.requestHistory.filter(
      h => Date.now() - h.timestamp < 300000 // 5 minutes
    );

    // Update average execution time
    const totalExecutionTime = this.statistics.avgExecutionTime *
      (this.statistics.successfulRequests + this.statistics.failedRequests - 1);
    this.statistics.avgExecutionTime =
      (totalExecutionTime + executionTime) /
      (this.statistics.successfulRequests + this.statistics.failedRequests);
  }

  /**
   * Check if a request should be retried
   */
  private shouldRetry(request: QueuedRequest, error: Error): boolean {
    // Don't retry critical requests that have already been retried
    if (request.priority === RequestPriority.CRITICAL && request.retryCount > 0) {
      return false;
    }

    // Check for rate limit errors
    const isRateLimitError = error.message.includes("429") ||
                           error.message.includes("rate limit");

    // Retry rate limit errors up to 3 times
    if (isRateLimitError && request.retryCount < 3) {
      return true;
    }

    // Retry network errors once
    const isNetworkError = error.message.includes("ECONNREFUSED") ||
                          error.message.includes("ETIMEDOUT");

    return isNetworkError && request.retryCount === 0;
  }

  /**
   * Update queue statistics
   */
  private updateStatistics(): void {
    const recentRequests = this.requestHistory.filter(
      h => Date.now() - h.timestamp < 60000
    );

    this.statistics.currentThroughput = recentRequests.length / 60; // Requests per second
  }

  /**
   * Get current queue statistics
   */
  getStatistics(): QueueStatistics {
    return { ...this.statistics };
  }

  /**
   * Clear all queues
   */
  clearQueues(): void {
    this.queues.forEach(queue => queue.length = 0);
    Object.keys(this.statistics.queuedByPriority).forEach(priority => {
      this.statistics.queuedByPriority[Number(priority) as RequestPriority] = 0;
    });
  }

  /**
   * Stop processing
   */
  stop(): void {
    this.isProcessing = false;
    this.batchTimers.forEach(timer => clearTimeout(timer));
    this.batchTimers.clear();
    this.batchAccumulator.clear();
  }
}

/**
 * Default configuration for the API queue manager
 */
export const DEFAULT_API_QUEUE_CONFIG: APIQueueConfig = {
  maxConcurrentRequests: 3,
  minRequestDelay: 200, // 200ms between requests
  maxQueueSizePerPriority: 100,
  enableBatching: true,
  batchWindowMs: 500, // Wait 500ms for similar requests
  maxBatchSize: 10,
  enableAdaptiveRateLimit: true,
  smoothingFactor: 0.2, // 20% randomization for smooth distribution
};
