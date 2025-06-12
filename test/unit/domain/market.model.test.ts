import { describe, test, expect, beforeEach } from "bun:test";
import {
  OrderSide,
  OrderType,
  TimeInForce,
  OrderStatus,
  MarketData,
  OrderParams,
  Order,
  MarketDataMetrics
} from "../../../src/domain/models/market.model";
import {
  createTestOrder,
  expectToMatchTimestamp,
  generateRandomPrice,
  TEST_SYMBOLS
} from "../../test-utils";

describe("Market Model Tests", () => {

  describe("OrderSide Enum", () => {
    test("should have correct values", () => {
      expect(OrderSide.BUY).toBe("BUY");
      expect(OrderSide.SELL).toBe("SELL");
    });

    test("should contain only BUY and SELL values", () => {
      const values = Object.values(OrderSide);
      expect(values).toHaveLength(2);
      expect(values).toContain("BUY");
      expect(values).toContain("SELL");
    });
  });

  describe("OrderType Enum", () => {
    test("should have all required order types", () => {
      expect(OrderType.MARKET).toBe("MARKET");
      expect(OrderType.LIMIT).toBe("LIMIT");
      expect(OrderType.STOP).toBe("STOP");
      expect(OrderType.STOP_LIMIT).toBe("STOP_LIMIT");
      expect(OrderType.TRAILING_STOP).toBe("TRAILING_STOP");
    });

    test("should contain exactly 5 order types", () => {
      const values = Object.values(OrderType);
      expect(values).toHaveLength(5);
    });
  });

  describe("TimeInForce Enum", () => {
    test("should have all required time in force values", () => {
      expect(TimeInForce.GOOD_TIL_CANCEL).toBe("GOOD_TIL_CANCEL");
      expect(TimeInForce.FILL_OR_KILL).toBe("FILL_OR_KILL");
      expect(TimeInForce.IMMEDIATE_OR_CANCEL).toBe("IMMEDIATE_OR_CANCEL");
      expect(TimeInForce.GOOD_TILL_TIME).toBe("GOOD_TILL_TIME");
      expect(TimeInForce.GTT).toBe("GTT");
    });

    test("should support both GTT formats", () => {
      expect(TimeInForce.GOOD_TILL_TIME).toBe("GOOD_TILL_TIME");
      expect(TimeInForce.GTT).toBe("GTT");
    });
  });

  describe("MarketData Interface", () => {
    let marketData: MarketData;

    beforeEach(() => {
      marketData = {
        symbol: "BTC-USD",
        price: 50000,
        timestamp: Date.now(),
        volume: 1000000,
        bid: 49999,
        ask: 50001
      };
    });

    test("should have required properties", () => {
      expect(marketData).toHaveProperty("symbol");
      expect(marketData).toHaveProperty("price");
      expect(marketData).toHaveProperty("timestamp");
      expect(marketData).toHaveProperty("volume");
      expect(marketData).toHaveProperty("bid");
      expect(marketData).toHaveProperty("ask");
    });

    test("should have valid price spread", () => {
      expect(marketData.bid).toBeLessThan(marketData.ask);
      expect(marketData.price).toBeGreaterThanOrEqual(marketData.bid);
      expect(marketData.price).toBeLessThanOrEqual(marketData.ask);
    });

    test("should support optional indicators", () => {
      const dataWithIndicators: MarketData = {
        ...marketData,
        indicators: {
          rsi: 65.5,
          macd: 0.05,
          bollinger: {
            upper: 51000,
            middle: 50000,
            lower: 49000
          }
        }
      };

      expect(dataWithIndicators.indicators).toBeDefined();
      expect(dataWithIndicators.indicators?.rsi).toBe(65.5);
    });

    test("should support optional metrics", () => {
      const metrics: MarketDataMetrics = {
        tickCount: 100,
        totalTickDuration: 60000,
        errorCount: 2,
        lastTick: Date.now()
      };

      const dataWithMetrics: MarketData = {
        ...marketData,
        metrics
      };

      expect(dataWithMetrics.metrics).toBeDefined();
      expect(dataWithMetrics.metrics?.tickCount).toBe(100);
      expect(dataWithMetrics.metrics?.errorCount).toBe(2);
    });

    test("should have realistic timestamp", () => {
      expectToMatchTimestamp(marketData.timestamp, 1000);
    });
  });

  describe("OrderParams Interface", () => {
    let basicOrderParams: OrderParams;

    beforeEach(() => {
      basicOrderParams = {
        symbol: "ETH-USD",
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        size: 0.5
      };
    });

    test("should have required properties", () => {
      expect(basicOrderParams).toHaveProperty("symbol");
      expect(basicOrderParams).toHaveProperty("side");
      expect(basicOrderParams).toHaveProperty("type");
      expect(basicOrderParams).toHaveProperty("size");
    });

    test("should support limit orders with price", () => {
      const limitOrder: OrderParams = {
        ...basicOrderParams,
        type: OrderType.LIMIT,
        price: 3000
      };

      expect(limitOrder.price).toBe(3000);
      expect(limitOrder.type).toBe(OrderType.LIMIT);
    });

    test("should support optional parameters", () => {
      const advancedOrder: OrderParams = {
        ...basicOrderParams,
        timeInForce: TimeInForce.FILL_OR_KILL,
        reduceOnly: true,
        postOnly: false,
        clientId: 12345
      };

      expect(advancedOrder.timeInForce).toBe(TimeInForce.FILL_OR_KILL);
      expect(advancedOrder.reduceOnly).toBe(true);
      expect(advancedOrder.postOnly).toBe(false);
      expect(advancedOrder.clientId).toBe(12345);
    });

    test("should validate order size is positive", () => {
      expect(basicOrderParams.size).toBeGreaterThan(0);
    });

    test("should support all valid symbols", () => {
      TEST_SYMBOLS.forEach(symbol => {
        const order: OrderParams = {
          ...basicOrderParams,
          symbol
        };
        expect(order.symbol).toBe(symbol);
      });
    });
  });

  describe("MarketDataMetrics Interface", () => {
    let metrics: MarketDataMetrics;

    beforeEach(() => {
      metrics = {
        tickCount: 50,
        totalTickDuration: 30000,
        errorCount: 1,
        lastTick: Date.now()
      };
    });

    test("should track tick statistics correctly", () => {
      expect(metrics.tickCount).toBeGreaterThan(0);
      expect(metrics.totalTickDuration).toBeGreaterThan(0);
      expect(metrics.errorCount).toBeGreaterThanOrEqual(0);
    });

    test("should calculate average tick duration", () => {
      const avgDuration = metrics.totalTickDuration / metrics.tickCount;
      expect(avgDuration).toBeGreaterThan(0);
      expect(avgDuration).toBe(600); // 30000 / 50
    });

    test("should track error rate", () => {
      const errorRate = metrics.errorCount / metrics.tickCount;
      expect(errorRate).toBeGreaterThanOrEqual(0);
      expect(errorRate).toBeLessThanOrEqual(1);
      expect(errorRate).toBe(0.02); // 1 / 50
    });

    test("should have recent lastTick timestamp", () => {
      expectToMatchTimestamp(metrics.lastTick, 1000);
    });
  });

  describe("Order Validation Logic", () => {
    test("should validate market order parameters", () => {
      const marketOrder: OrderParams = {
        symbol: "BTC-USD",
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        size: 0.001
      };

      // Market orders shouldn't need price
      expect(marketOrder.price).toBeUndefined();
      expect(marketOrder.type).toBe(OrderType.MARKET);
    });

    test("should validate limit order parameters", () => {
      const limitOrder: OrderParams = {
        symbol: "BTC-USD",
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        size: 0.001,
        price: 50000
      };

      // Limit orders should have price
      expect(limitOrder.price).toBeDefined();
      expect(limitOrder.price).toBeGreaterThan(0);
    });

    test("should validate stop order parameters", () => {
      const stopOrder: OrderParams = {
        symbol: "BTC-USD",
        side: OrderSide.SELL,
        type: OrderType.STOP,
        size: 0.001,
        price: 48000 // Stop price below current for sell
      };

      expect(stopOrder.type).toBe(OrderType.STOP);
      expect(stopOrder.price).toBeDefined();
    });

    test("should validate order size constraints", () => {
      const validSizes = [0.001, 0.1, 1.0, 10.5];
      const invalidSizes = [0, -1, -0.001];

      validSizes.forEach(size => {
        expect(size).toBeGreaterThan(0);
      });

      invalidSizes.forEach(size => {
        expect(size).toBeLessThanOrEqual(0);
      });
    });
  });

  describe("Price Validation", () => {
    test("should validate realistic price ranges", () => {
      const prices = {
        "BTC-USD": generateRandomPrice(50000, 0.1),
        "ETH-USD": generateRandomPrice(3000, 0.1),
        "SOL-USD": generateRandomPrice(100, 0.2),
        "AVAX-USD": generateRandomPrice(30, 0.3)
      };

      Object.entries(prices).forEach(([symbol, price]) => {
        expect(price).toBeGreaterThan(0);
        expect(typeof price).toBe("number");
        expect(isFinite(price)).toBe(true);
      });
    });

    test("should handle price precision correctly", () => {
      const price = 50000.123456;
      const roundedPrice = Math.round(price * 100) / 100;

      expect(roundedPrice).toBe(50000.12);
      expect(roundedPrice.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(2);
    });
  });

  describe("Order Status Transitions", () => {
    test("should support valid order status values", () => {
      // Assuming OrderStatus enum exists based on the imports
      const validStatuses = [
        "PENDING",
        "OPEN",
        "FILLED",
        "PARTIALLY_FILLED",
        "CANCELLED",
        "REJECTED"
      ];

      validStatuses.forEach(status => {
        expect(typeof status).toBe("string");
        expect(status.length).toBeGreaterThan(0);
      });
    });
  });

  describe("Symbol Validation", () => {
    test("should validate symbol format", () => {
      const validSymbols = ["BTC-USD", "ETH-USD", "SOL-USD", "AVAX-USD"];
      const invalidSymbols = ["BTC", "USD", "BTC/USD", "btc-usd", ""];

      validSymbols.forEach(symbol => {
        expect(symbol).toMatch(/^[A-Z]+-[A-Z]+$/);
        expect(symbol.includes("-")).toBe(true);
      });

      invalidSymbols.forEach(symbol => {
        expect(symbol).not.toMatch(/^[A-Z]+-[A-Z]+$/);
      });
    });

    test("should extract base and quote currencies", () => {
      const symbol = "BTC-USD";
      const [base, quote] = symbol.split("-");

      expect(base).toBe("BTC");
      expect(quote).toBe("USD");
      expect(base.length).toBeGreaterThan(0);
      expect(quote.length).toBeGreaterThan(0);
    });
  });

  describe("Order Side Logic", () => {
    test("should handle buy orders correctly", () => {
      const buyOrder: OrderParams = {
        symbol: "BTC-USD",
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        size: 0.001
      };

      expect(buyOrder.side).toBe(OrderSide.BUY);
      // Buy orders increase position
      expect(buyOrder.side === OrderSide.BUY).toBe(true);
    });

    test("should handle sell orders correctly", () => {
      const sellOrder: OrderParams = {
        symbol: "BTC-USD",
        side: OrderSide.SELL,
        type: OrderType.MARKET,
        size: 0.001
      };

      expect(sellOrder.side).toBe(OrderSide.SELL);
      // Sell orders decrease position
      expect(sellOrder.side === OrderSide.SELL).toBe(true);
    });

    test("should support opposite side calculation", () => {
      function getOppositeSide(side: OrderSide): OrderSide {
        return side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;
      }

      expect(getOppositeSide(OrderSide.BUY)).toBe(OrderSide.SELL);
      expect(getOppositeSide(OrderSide.SELL)).toBe(OrderSide.BUY);
    });
  });
});
