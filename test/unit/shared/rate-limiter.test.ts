import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  RateLimiter,
  RateLimiterConfig,
} from "../../../src/shared/utils/rate-limiter";
import { TestTimer, waitFor } from "../../test-utils";

describe("RateLimiter Tests", () => {
  let rateLimiter: RateLimiter;
  let defaultConfig: RateLimiterConfig;

  beforeEach(() => {
    defaultConfig = {
      maxRequests: 5,
      windowMs: 10000, // 10 seconds
      retryDelay: 1000,
      maxRetries: 3,
      backoffMultiplier: 2,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 30000,
    };
    rateLimiter = new RateLimiter(defaultConfig);
  });

  afterEach(() => {
    // Clean up any timers or intervals
  });

  describe("Basic Rate Limiting", () => {
    test("should allow requests within limit", () => {
      for (let i = 0; i < defaultConfig.maxRequests; i++) {
        const result = rateLimiter.checkLimit();
        expect(result.allowed).toBe(true);
        expect(result.waitTime).toBeUndefined();
      }
    });

    test("should reject requests over limit", () => {
      // Fill up the rate limit
      for (let i = 0; i < defaultConfig.maxRequests; i++) {
        rateLimiter.checkLimit();
      }

      // Next request should be rejected
      const result = rateLimiter.checkLimit();
      expect(result.allowed).toBe(false);
      expect(result.waitTime).toBeGreaterThan(0);
    });

    test("should calculate correct wait time", () => {
      // Fill up the rate limit
      for (let i = 0; i < defaultConfig.maxRequests; i++) {
        rateLimiter.checkLimit();
      }

      const result = rateLimiter.checkLimit();
      expect(result.waitTime).toBeLessThanOrEqual(defaultConfig.windowMs);
      expect(result.waitTime).toBeGreaterThan(0);
    });
  });

  describe("Window Management", () => {
    test("should reset counter after window expires", async () => {
      const shortWindowConfig: RateLimiterConfig = {
        ...defaultConfig,
        maxRequests: 2,
        windowMs: 100, // 100ms window
      };
      const shortRateLimiter = new RateLimiter(shortWindowConfig);

      // Fill up the limit
      expect(shortRateLimiter.checkLimit().allowed).toBe(true);
      expect(shortRateLimiter.checkLimit().allowed).toBe(true);
      expect(shortRateLimiter.checkLimit().allowed).toBe(false);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should allow requests again
      expect(shortRateLimiter.checkLimit().allowed).toBe(true);
    });

    test("should handle sliding window correctly", async () => {
      const config: RateLimiterConfig = {
        ...defaultConfig,
        maxRequests: 3,
        windowMs: 200,
      };
      const limiter = new RateLimiter(config);

      // Make 3 requests
      expect(limiter.checkLimit().allowed).toBe(true);
      expect(limiter.checkLimit().allowed).toBe(true);
      expect(limiter.checkLimit().allowed).toBe(true);

      // 4th request should be rejected
      expect(limiter.checkLimit().allowed).toBe(false);

      // Wait half window
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Still should be rejected
      expect(limiter.checkLimit().allowed).toBe(false);

      // Wait for full window to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Now should be allowed
      expect(limiter.checkLimit().allowed).toBe(true);
    });
  });

  describe("Circuit Breaker", () => {
    test("should open circuit breaker after consecutive failures", () => {
      const limiter = new RateLimiter({
        ...defaultConfig,
        circuitBreakerThreshold: 3,
      });

      // Simulate failures
      for (let i = 0; i < 3; i++) {
        limiter.recordFailure();
      }

      // Circuit breaker should be open
      const result = limiter.checkLimit();
      expect(result.allowed).toBe(false);
      expect(result.waitTime).toBeGreaterThan(0);
    });

    test("should close circuit breaker after timeout", async () => {
      const config: RateLimiterConfig = {
        ...defaultConfig,
        circuitBreakerThreshold: 2,
        circuitBreakerTimeout: 100,
      };
      const limiter = new RateLimiter(config);

      // Open circuit breaker
      limiter.recordFailure();
      limiter.recordFailure();

      expect(limiter.checkLimit().allowed).toBe(false);

      // Wait for circuit breaker to close
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should allow requests again
      expect(limiter.checkLimit().allowed).toBe(true);
    });

    test("should reset failure count when circuit closes", async () => {
      const config: RateLimiterConfig = {
        ...defaultConfig,
        circuitBreakerThreshold: 2,
        circuitBreakerTimeout: 100,
      };
      const limiter = new RateLimiter(config);

      // Open circuit breaker
      limiter.recordFailure();
      limiter.recordFailure();

      // Verify circuit is open
      expect(limiter.checkLimit().allowed).toBe(false);

      // Wait for circuit to close
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Circuit should be closed now - check by making a successful request
      expect(limiter.checkLimit().allowed).toBe(true);

      // Verify failures were reset
      const status = limiter.getStatus();
      expect(status.consecutiveFailures).toBe(0);
    });
  });

  describe("Retry Logic", () => {
    test("should calculate exponential backoff", () => {
      const limiter = new RateLimiter(defaultConfig);

      const delays = [];
      for (let i = 0; i < 4; i++) {
        const delay = limiter.calculateBackoffDelay(i);
        delays.push(delay);
      }

      // Should follow exponential backoff pattern
      expect(delays[0]).toBe(defaultConfig.retryDelay); // 1000
      expect(delays[1]).toBe(defaultConfig.retryDelay * 2); // 2000
      expect(delays[2]).toBe(defaultConfig.retryDelay * 4); // 4000
      expect(delays[3]).toBe(defaultConfig.retryDelay * 8); // 8000
    });

    test("should have status information", () => {
      const limiter = new RateLimiter(defaultConfig);

      // Make some requests
      limiter.checkLimit();
      limiter.checkLimit();

      const status = limiter.getStatus();
      expect(status.requestsInWindow).toBe(2);
      expect(status.maxRequests).toBe(defaultConfig.maxRequests);
      expect(status.circuitBreakerOpen).toBe(false);
      expect(status.consecutiveFailures).toBe(0);
    });
  });

  describe("Performance and Memory", () => {
    test("should clean up old requests from memory", async () => {
      const config: RateLimiterConfig = {
        ...defaultConfig,
        maxRequests: 100,
        windowMs: 100,
      };
      const limiter = new RateLimiter(config);

      // Make many requests
      for (let i = 0; i < 50; i++) {
        limiter.checkLimit();
      }

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Make one more request to trigger cleanup
      limiter.checkLimit();

      // Internal request array should be much smaller now
      const status = limiter.getStatus();
      expect(status.requestsInWindow).toBeLessThan(10);
    });

    test("should handle high frequency requests", () => {
      const timer = new TestTimer();
      timer.start();

      // Make 1000 rapid requests
      for (let i = 0; i < 1000; i++) {
        rateLimiter.checkLimit();
      }

      // Should complete quickly (under 100ms)
      timer.expectToBeWithin(0, 100);
    });
  });

  describe("Edge Cases", () => {
    test("should handle zero max requests", () => {
      const limiter = new RateLimiter({
        ...defaultConfig,
        maxRequests: 0,
      });

      const result = limiter.checkLimit();
      expect(result.allowed).toBe(false);
    });

    test("should handle very small window", () => {
      const limiter = new RateLimiter({
        ...defaultConfig,
        windowMs: 1,
      });

      const result = limiter.checkLimit();
      expect(result.allowed).toBe(true);
    });

    test("should handle concurrent access", async () => {
      const results = await Promise.all([
        Promise.resolve(rateLimiter.checkLimit()),
        Promise.resolve(rateLimiter.checkLimit()),
        Promise.resolve(rateLimiter.checkLimit()),
        Promise.resolve(rateLimiter.checkLimit()),
        Promise.resolve(rateLimiter.checkLimit()),
      ]);

      // All should be allowed since we're within the limit
      results.forEach((result) => {
        expect(result.allowed).toBe(true);
      });
    });

    test("should handle system clock changes", () => {
      // Simulate system clock going backwards
      const originalNow = Date.now;
      let timeOffset = 0;

      Date.now = () => originalNow() + timeOffset;

      try {
        rateLimiter.checkLimit();

        // Move clock backwards
        timeOffset = -5000;

        // Should still work correctly
        const result = rateLimiter.checkLimit();
        expect(typeof result.allowed).toBe("boolean");
      } finally {
        Date.now = originalNow;
      }
    });
  });

  describe("Configuration Validation", () => {
    test("should work with minimal config", () => {
      const minimalConfig: RateLimiterConfig = {
        maxRequests: 1,
        windowMs: 1000,
        retryDelay: 500,
        maxRetries: 1,
        backoffMultiplier: 1.5,
        circuitBreakerThreshold: 3,
        circuitBreakerTimeout: 10000,
      };

      const limiter = new RateLimiter(minimalConfig);
      expect(limiter.checkLimit().allowed).toBe(true);
    });

    test("should handle large configuration values", () => {
      const largeConfig: RateLimiterConfig = {
        maxRequests: 10000,
        windowMs: 3600000, // 1 hour
        retryDelay: 30000,
        maxRetries: 10,
        backoffMultiplier: 3,
        circuitBreakerThreshold: 50,
        circuitBreakerTimeout: 300000, // 5 minutes
      };

      const limiter = new RateLimiter(largeConfig);

      // Should allow many requests
      for (let i = 0; i < 100; i++) {
        expect(limiter.checkLimit().allowed).toBe(true);
      }
    });
  });

  describe("Status and Monitoring", () => {
    test("should track request status", () => {
      for (let i = 0; i < 3; i++) {
        rateLimiter.checkLimit();
      }

      const status = rateLimiter.getStatus();
      expect(status.requestsInWindow).toBe(3);
      expect(status.maxRequests).toBe(defaultConfig.maxRequests);
      expect(status.circuitBreakerOpen).toBe(false);
    });

    test("should track circuit breaker status", () => {
      // Trigger circuit breaker
      for (let i = 0; i < defaultConfig.circuitBreakerThreshold; i++) {
        rateLimiter.recordFailure();
      }

      const status = rateLimiter.getStatus();
      expect(status.circuitBreakerOpen).toBe(true);
      expect(status.consecutiveFailures).toBe(
        defaultConfig.circuitBreakerThreshold,
      );
    });

    test("should reset consecutive failures on success", () => {
      // Record some failures
      rateLimiter.recordFailure();
      rateLimiter.recordFailure();

      let status = rateLimiter.getStatus();
      expect(status.consecutiveFailures).toBe(2);

      // Record success
      rateLimiter.recordSuccess();

      status = rateLimiter.getStatus();
      expect(status.consecutiveFailures).toBe(0);
    });
  });
});
