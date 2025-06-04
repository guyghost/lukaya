import { createPerformanceTrackerActorDefinition } from "../performance-tracker.actor";
import { PerformanceTrackerMessage, TradeEntry } from "../performance-tracker.model";
import { OrderSide, OrderType, OrderStatus } from "../../../../domain/models/market.model";

describe("PerformanceTracker Logging", () => {
  let actorDefinition: any;
  let mockContext: any;

  beforeEach(() => {
    actorDefinition = createPerformanceTrackerActorDefinition({
      historyLength: 100,
      realTimeUpdates: true,
      trackOpenPositions: true
    });

    mockContext = {
      self: { id: "test-performance-tracker" },
      parent: null,
      children: new Map(),
      system: null
    };
  });

  const createSampleTrade = (id: string, strategyId: string, symbol: string, price: number): TradeEntry => ({
    id,
    strategyId,
    symbol,
    entryTime: Date.now(),
    entryPrice: price,
    entryOrder: {
      id: `order-${id}`,
      symbol,
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      size: 1.0,
      status: OrderStatus.FILLED,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      filledSize: 1.0,
      avgFillPrice: price
    },
    quantity: 1.0,
    fees: 0.1,
    status: "open" as const,
    tags: ["test"]
  });

  test("should log trade opening with detailed information", async () => {
    const trade = createSampleTrade("test-001", "rsi-strategy", "BTC-USD", 45000);
    
    const message: PerformanceTrackerMessage = {
      type: "TRADE_OPENED",
      trade
    };

    const result = await actorDefinition.behavior(
      actorDefinition.initialState,
      { payload: message },
      mockContext
    );

    // Verify trade was added to state
    expect(result.state.trades).toHaveLength(1);
    expect(result.state.openTrades[trade.id]).toBeDefined();
    expect(result.state.trades[0].id).toBe("test-001");
    expect(result.state.trades[0].strategyId).toBe("rsi-strategy");
  });

  test("should log trade closing with PNL information", async () => {
    const openTrade = createSampleTrade("test-002", "elliott-strategy", "ETH-USD", 3000);
    
    // First open the trade
    let state = actorDefinition.initialState;
    const openMessage: PerformanceTrackerMessage = {
      type: "TRADE_OPENED",
      trade: openTrade
    };
    
    const openResult = await actorDefinition.behavior(state, { payload: openMessage }, mockContext);
    state = openResult.state;

    // Then close it with profit
    const closedTrade: TradeEntry = {
      ...openTrade,
      exitTime: Date.now(),
      exitPrice: 3200,
      exitOrder: {
        id: "order-exit-test-002",
        symbol: "ETH-USD",
        side: OrderSide.SELL,
        type: OrderType.MARKET,
        size: 1.0,
        status: OrderStatus.FILLED,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        filledSize: 1.0,
        avgFillPrice: 3200
      },
      pnl: 200, // 3200 - 3000 = 200
      pnlPercent: 6.67,
      status: "closed" as const,
      duration: 300000
    };

    const closeMessage: PerformanceTrackerMessage = {
      type: "TRADE_CLOSED",
      trade: closedTrade
    };

    const closeResult = await actorDefinition.behavior(state, { payload: closeMessage }, mockContext);

    // Verify trade was moved from open to closed
    expect(closeResult.state.openTrades[openTrade.id]).toBeUndefined();
    expect(closeResult.state.trades[0].status).toBe("closed");
    expect(closeResult.state.trades[0].pnl).toBe(200);
    expect(closeResult.state.strategyPerformance["elliott-strategy"]).toBeDefined();
  });

  test("should update price and log unrealized PNL", async () => {
    const trade = createSampleTrade("test-003", "volume-strategy", "BTC-USD", 40000);
    
    // Open trade first
    let state = actorDefinition.initialState;
    const openMessage: PerformanceTrackerMessage = {
      type: "TRADE_OPENED",
      trade
    };
    
    const openResult = await actorDefinition.behavior(state, { payload: openMessage }, mockContext);
    state = openResult.state;

    // Update price
    const priceMessage: PerformanceTrackerMessage = {
      type: "UPDATE_PRICE",
      symbol: "BTC-USD",
      price: 42000,
      timestamp: Date.now()
    };

    const priceResult = await actorDefinition.behavior(state, { payload: priceMessage }, mockContext);

    // Verify price was stored
    expect(priceResult.state.priceHistory["BTC-USD"]).toBeDefined();
    expect(priceResult.state.priceHistory["BTC-USD"]).toHaveLength(1);
    expect(priceResult.state.priceHistory["BTC-USD"][0].price).toBe(42000);
  });

  test("should generate positions summary", async () => {
    const trade1 = createSampleTrade("test-004", "rsi-strategy", "BTC-USD", 45000);
    const trade2 = createSampleTrade("test-005", "elliott-strategy", "ETH-USD", 3000);
    
    // Open both trades
    let state = actorDefinition.initialState;
    
    const openMessage1: PerformanceTrackerMessage = {
      type: "TRADE_OPENED",
      trade: trade1
    };
    
    const openMessage2: PerformanceTrackerMessage = {
      type: "TRADE_OPENED",
      trade: trade2
    };

    const result1 = await actorDefinition.behavior(state, { payload: openMessage1 }, mockContext);
    const result2 = await actorDefinition.behavior(result1.state, { payload: openMessage2 }, mockContext);

    // Generate summary
    const summaryMessage: PerformanceTrackerMessage = {
      type: "LOG_POSITIONS_SUMMARY",
      currentPrices: {
        "BTC-USD": 46000,
        "ETH-USD": 3100
      }
    };

    const summaryResult = await actorDefinition.behavior(result2.state, { payload: summaryMessage }, mockContext);

    // Verify state remains unchanged (summary is just logging)
    expect(summaryResult.state.openTrades).toHaveProperty("test-004");
    expect(summaryResult.state.openTrades).toHaveProperty("test-005");
    expect(Object.keys(summaryResult.state.openTrades)).toHaveLength(2);
  });

  test("should update configuration and log changes", async () => {
    const state = actorDefinition.initialState;
    
    const configMessage: PerformanceTrackerMessage = {
      type: "UPDATE_CONFIG",
      config: {
        realTimeUpdates: false,
        calculationInterval: 120000
      }
    };

    const result = await actorDefinition.behavior(state, { payload: configMessage }, mockContext);

    // Verify config was updated
    expect(result.state.config.realTimeUpdates).toBe(false);
    expect(result.state.config.calculationInterval).toBe(120000);
    expect(result.state.config.historyLength).toBe(100); // Should keep old values
  });

  test("should track statistics by strategy", async () => {
    const rsiTrade1 = createSampleTrade("rsi-001", "rsi-strategy", "BTC-USD", 45000);
    const rsiTrade2 = createSampleTrade("rsi-002", "rsi-strategy", "ETH-USD", 3000);
    const elliottTrade = createSampleTrade("elliott-001", "elliott-strategy", "BTC-USD", 44000);
    
    let state = actorDefinition.initialState;
    
    // Open all trades
    const trades = [rsiTrade1, rsiTrade2, elliottTrade];
    for (const trade of trades) {
      const message: PerformanceTrackerMessage = {
        type: "TRADE_OPENED",
        trade
      };
      const result = await actorDefinition.behavior(state, { payload: message }, mockContext);
      state = result.state;
    }
    
    // Close one RSI trade with profit
    const closedRsiTrade: TradeEntry = {
      ...rsiTrade1,
      exitTime: Date.now(),
      exitPrice: 46000,
      pnl: 1000,
      status: "closed" as const
    };
    
    const closeMessage: PerformanceTrackerMessage = {
      type: "TRADE_CLOSED",
      trade: closedRsiTrade
    };
    
    const finalResult = await actorDefinition.behavior(state, { payload: closeMessage }, mockContext);
    
    // Verify strategy performance tracking
    expect(finalResult.state.strategyPerformance["rsi-strategy"]).toBeDefined();
    expect(finalResult.state.strategyPerformance["rsi-strategy"].trades).toBe(1); // Only closed trades count
    expect(finalResult.state.strategyPerformance["rsi-strategy"].netProfit).toBe(1000);
    
    // Should have 2 open trades remaining (1 RSI + 1 Elliott)
    expect(Object.keys(finalResult.state.openTrades)).toHaveLength(2);
  });
});
