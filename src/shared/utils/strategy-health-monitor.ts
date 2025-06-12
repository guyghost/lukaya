import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";

const logger = createContextualLogger('StrategyHealthMonitor');

export interface StrategyHealthStatus {
  strategyId: string;
  isHealthy: boolean;
  lastSignalTime: number;
  consecutiveErrors: number;
  totalOrders: number;
  successfulOrders: number;
  rejectedOrders: number;
  lastErrorTime?: number;
  lastErrorMessage?: string;
  recoveryCount: number;
  healthScore: number; // 0-100
}

export class StrategyHealthMonitor {
  private healthStats = new Map<string, StrategyHealthStatus>();
  private readonly MAX_CONSECUTIVE_ERRORS = 5;
  private readonly ERROR_RECOVERY_TIMEOUT = 300000; // 5 minutes
  private readonly INACTIVITY_THRESHOLD = 600000; // 10 minutes

  /**
   * Record a successful order for a strategy
   */
  recordSuccess(strategyId: string): void {
    const health = this.getOrCreateHealth(strategyId);
    
    health.totalOrders++;
    health.successfulOrders++;
    health.consecutiveErrors = 0; // Reset error count on success
    health.lastSignalTime = Date.now();
    
    this.updateHealthScore(health);
    
    logger.debug(`Strategy ${strategyId} success recorded`, {
      totalOrders: health.totalOrders,
      successRate: ((health.successfulOrders / health.totalOrders) * 100).toFixed(2)
    });
  }

  /**
   * Record an error for a strategy
   */
  recordError(strategyId: string, errorMessage: string): void {
    const health = this.getOrCreateHealth(strategyId);
    
    health.totalOrders++;
    health.rejectedOrders++;
    health.consecutiveErrors++;
    health.lastErrorTime = Date.now();
    health.lastErrorMessage = errorMessage;
    
    this.updateHealthScore(health);
    
    logger.warn(`Strategy ${strategyId} error recorded`, {
      consecutiveErrors: health.consecutiveErrors,
      errorMessage,
      healthScore: health.healthScore
    });
  }

  /**
   * Record strategy recovery
   */
  recordRecovery(strategyId: string): void {
    const health = this.getOrCreateHealth(strategyId);
    
    health.recoveryCount++;
    health.consecutiveErrors = Math.max(0, health.consecutiveErrors - 2); // Reduce error count
    
    this.updateHealthScore(health);
    
    logger.info(`Strategy ${strategyId} recovery recorded`, {
      recoveryCount: health.recoveryCount,
      healthScore: health.healthScore
    });
  }

  /**
   * Check if a strategy needs intervention
   */
  needsIntervention(strategyId: string): boolean {
    const health = this.healthStats.get(strategyId);
    if (!health) return false;

    const now = Date.now();
    const timeSinceLastError = health.lastErrorTime ? now - health.lastErrorTime : Infinity;
    const timeSinceLastSignal = now - health.lastSignalTime;

    // Needs intervention if:
    // 1. Too many consecutive errors
    // 2. Recent errors and low health score
    // 3. Strategy has been inactive for too long
    return (
      health.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS ||
      (health.consecutiveErrors >= 3 && health.healthScore < 30) ||
      (timeSinceLastSignal > this.INACTIVITY_THRESHOLD && health.healthScore < 50)
    );
  }

  /**
   * Check if a strategy can be auto-recovered
   */
  canAutoRecover(strategyId: string): boolean {
    const health = this.healthStats.get(strategyId);
    if (!health) return true;

    const now = Date.now();
    const timeSinceLastError = health.lastErrorTime ? now - health.lastErrorTime : Infinity;

    // Can auto-recover if enough time has passed since last error
    return (
      timeSinceLastError > this.ERROR_RECOVERY_TIMEOUT &&
      health.recoveryCount < 3 // Don't auto-recover more than 3 times
    );
  }

  /**
   * Get health status for a strategy
   */
  getHealthStatus(strategyId: string): StrategyHealthStatus {
    return this.getOrCreateHealth(strategyId);
  }

  /**
   * Get all unhealthy strategies
   */
  getUnhealthyStrategies(): StrategyHealthStatus[] {
    return Array.from(this.healthStats.values()).filter(health => !health.isHealthy);
  }

  /**
   * Reset health stats for a strategy (useful after manual intervention)
   */
  resetHealth(strategyId: string): void {
    const health = this.getOrCreateHealth(strategyId);
    
    health.consecutiveErrors = 0;
    health.lastErrorTime = undefined;
    health.lastErrorMessage = undefined;
    health.lastSignalTime = Date.now();
    
    this.updateHealthScore(health);
    
    logger.info(`Strategy ${strategyId} health reset`, {
      healthScore: health.healthScore
    });
  }

  /**
   * Get or create health status for a strategy
   */
  private getOrCreateHealth(strategyId: string): StrategyHealthStatus {
    if (!this.healthStats.has(strategyId)) {
      this.healthStats.set(strategyId, {
        strategyId,
        isHealthy: true,
        lastSignalTime: Date.now(),
        consecutiveErrors: 0,
        totalOrders: 0,
        successfulOrders: 0,
        rejectedOrders: 0,
        recoveryCount: 0,
        healthScore: 100
      });
    }
    
    return this.healthStats.get(strategyId)!;
  }

  /**
   * Update health score based on current stats
   */
  private updateHealthScore(health: StrategyHealthStatus): void {
    let score = 100;
    
    // Reduce score based on consecutive errors
    score -= health.consecutiveErrors * 15;
    
    // Reduce score based on failure rate
    if (health.totalOrders > 0) {
      const failureRate = health.rejectedOrders / health.totalOrders;
      score -= failureRate * 50;
    }
    
    // Reduce score based on inactivity
    const now = Date.now();
    const timeSinceLastSignal = now - health.lastSignalTime;
    if (timeSinceLastSignal > this.INACTIVITY_THRESHOLD) {
      score -= 30;
    }
    
    // Boost score for recoveries
    score += health.recoveryCount * 5;
    
    // Ensure score is between 0 and 100
    health.healthScore = Math.max(0, Math.min(100, score));
    health.isHealthy = health.healthScore >= 50 && health.consecutiveErrors < 3;
  }
}

// Global instance
export const strategyHealthMonitor = new StrategyHealthMonitor();
