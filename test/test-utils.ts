/**
 * Utilitaires communs pour les tests
 */

import { expect } from "bun:test";

// Types utilitaires pour les tests
export interface MockContext {
  self: { id: string };
  parent: any;
  children: Map<string, any>;
  system: any;
}

export interface TestOrder {
  id: string;
  symbol: string;
  side: string;
  type: string;
  size: number;
  price?: number;
  status: string;
  createdAt: number;
  updatedAt: number;
  filledSize?: number;
  avgFillPrice?: number;
}

// Helpers pour créer des objets de test
export function createMockContext(id: string = "test-actor"): MockContext {
  return {
    self: { id },
    parent: null,
    children: new Map(),
    system: null
  };
}

export function createTestOrder(overrides: Partial<TestOrder> = {}): TestOrder {
  const now = Date.now();
  return {
    id: `test-order-${Math.random().toString(36).substr(2, 9)}`,
    symbol: "BTC-USD",
    side: "BUY",
    type: "MARKET",
    size: 0.001,
    status: "PENDING",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

// Matchers personnalisés pour les tests
export function expectToBeWithinRange(received: number, min: number, max: number) {
  expect(received).toBeGreaterThanOrEqual(min);
  expect(received).toBeLessThanOrEqual(max);
}

export function expectToMatchTimestamp(received: number, tolerance: number = 5000) {
  const now = Date.now();
  expect(received).toBeGreaterThanOrEqual(now - tolerance);
  expect(received).toBeLessThanOrEqual(now + tolerance);
}

// Helpers pour les assertions d'objets complexes
export function expectOrderToMatch(actual: any, expected: Partial<TestOrder>) {
  Object.keys(expected).forEach(key => {
    expect(actual).toHaveProperty(key, expected[key as keyof TestOrder]);
  });
}

// Helpers pour les tests asynchrones
export async function waitFor(condition: () => boolean, timeout: number = 5000): Promise<void> {
  const start = Date.now();
  while (!condition() && Date.now() - start < timeout) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!condition()) {
    throw new Error(`Condition not met within ${timeout}ms`);
  }
}

// Mock data generators
export function generateRandomPrice(base: number = 50000, variance: number = 0.1): number {
  const change = (Math.random() - 0.5) * 2 * variance;
  return Math.round(base * (1 + change) * 100) / 100;
}

export function generateTradeId(): string {
  return `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function generateOrderId(): string {
  return `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Helpers pour les tests de performance
export class TestTimer {
  private startTime: number = 0;

  start(): void {
    this.startTime = performance.now();
  }

  elapsed(): number {
    return performance.now() - this.startTime;
  }

  expectToBeWithin(min: number, max: number): void {
    const elapsed = this.elapsed();
    expectToBeWithinRange(elapsed, min, max);
  }
}

// Helpers pour les tests de logging
export class TestLogger {
  public logs: Array<{ level: string; message: string; data?: any }> = [];

  info(message: string, data?: any): void {
    this.logs.push({ level: "info", message, data });
  }

  error(message: string, data?: any): void {
    this.logs.push({ level: "error", message, data });
  }

  warn(message: string, data?: any): void {
    this.logs.push({ level: "warn", message, data });
  }

  debug(message: string, data?: any): void {
    this.logs.push({ level: "debug", message, data });
  }

  clear(): void {
    this.logs = [];
  }

  getLogsForLevel(level: string): Array<{ message: string; data?: any }> {
    return this.logs
      .filter(log => log.level === level)
      .map(log => ({ message: log.message, data: log.data }));
  }

  expectLogCount(level: string, count: number): void {
    expect(this.getLogsForLevel(level)).toHaveLength(count);
  }

  expectLogToContain(level: string, substring: string): void {
    const logs = this.getLogsForLevel(level);
    const found = logs.some(log => log.message.includes(substring));
    expect(found).toBe(true);
  }
}

// Helpers pour les tests d'erreurs
export function expectToThrowWithMessage(fn: () => any, expectedMessage: string): void {
  expect(fn).toThrow(expectedMessage);
}

export async function expectAsyncToThrowWithMessage(
  fn: () => Promise<any>,
  expectedMessage: string
): Promise<void> {
  try {
    await fn();
    expect(true).toBe(false); // Should not reach here
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(expectedMessage);
  }
}

// Constants pour les tests
export const TEST_SYMBOLS = [
  "BTC-USD",
  "ETH-USD",
  "SOL-USD",
  "AVAX-USD"
] as const;

export const TEST_STRATEGIES = [
  "rsi-strategy",
  "elliott-strategy",
  "volume-strategy",
  "momentum-strategy"
] as const;

export const DEFAULT_TEST_TIMEOUTS = {
  UNIT: 5000,
  INTEGRATION: 10000,
  E2E: 30000
} as const;
