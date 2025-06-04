// Exemple d'utilisation du Performance Tracker avec logs détaillés
import { createPerformanceTrackerActorDefinition } from "./performance-tracker.actor";
import { PerformanceTrackerMessage, TradeEntry } from "./performance-tracker.model";
import { OrderSide, OrderType, OrderStatus } from "../../../domain/models/market.model";

// Exemple d'utilisation du performance tracker avec logs
export const demonstratePerformanceTrackerLogging = async () => {
  
  // Créer l'acteur definition avec configuration personnalisée
  const actorDefinition = createPerformanceTrackerActorDefinition({
    historyLength: 500,
    realTimeUpdates: true,
    calculationInterval: 30000, // 30 secondes
    trackOpenPositions: true
  });
  
  // État initial
  let state = actorDefinition.initialState;
  
  // Mock context pour les tests
  const mockContext = {
    self: "performance-tracker-test" as any,
    parent: null,
    children: new Map(),
    system: null as any
  } as any;

  // Mock sender pour les messages
  const mockSender = "test-sender" as any;

  // Exemple de trade d'ouverture
  const openTradeMessage: PerformanceTrackerMessage = {
    type: "TRADE_OPENED",
    trade: {
      id: "trade-001",
      strategyId: "rsi-divergence",
      symbol: "BTC-USD",
      entryTime: Date.now(),
      entryPrice: 45000,
      entryOrder: {
        id: "order-001",
        symbol: "BTC-USD",
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        size: 0.1,
        status: OrderStatus.FILLED,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        filledSize: 0.1,
        avgFillPrice: 45000
      },
      quantity: 0.1,
      fees: 5.0,
      status: "open",
      tags: ["rsi", "divergence", "bullish"]
    } as TradeEntry
  };

  // Ouvrir le trade
  console.log("=== Ouverture du trade ===");
  const result1 = await actorDefinition.behavior(state, { payload: openTradeMessage, sender: mockSender }, mockContext);
  state = result1.state;

  // Simuler une mise à jour de prix
  console.log("\n=== Mise à jour du prix ===");
  const priceUpdateMessage: PerformanceTrackerMessage = {
    type: "UPDATE_PRICE",
    symbol: "BTC-USD",
    price: 46500, // +1500$ de gain
    timestamp: Date.now()
  };
  
  const result2 = await actorDefinition.behavior(state, { payload: priceUpdateMessage, sender: mockSender }, mockContext);
  state = result2.state;

  // Afficher un résumé des positions
  console.log("\n=== Résumé des positions ===");
  const summaryMessage: PerformanceTrackerMessage = {
    type: "LOG_POSITIONS_SUMMARY",
    currentPrices: { "BTC-USD": 46500 }
  };
  
  const result3 = await actorDefinition.behavior(state, { payload: summaryMessage, sender: mockSender }, mockContext);
  state = result3.state;

  // Ouvrir un deuxième trade avec une autre stratégie
  console.log("\n=== Ouverture d'un second trade ===");
  const secondTradeMessage: PerformanceTrackerMessage = {
    type: "TRADE_OPENED",
    trade: {
      id: "trade-002",
      strategyId: "elliott-wave",
      symbol: "ETH-USD",
      entryTime: Date.now(),
      entryPrice: 3200,
      entryOrder: {
        id: "order-002",
        symbol: "ETH-USD",
        side: OrderSide.SELL, // Position courte
        type: OrderType.MARKET,
        size: 1.0,
        status: OrderStatus.FILLED,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        filledSize: 1.0,
        avgFillPrice: 3200
      },
      quantity: 1.0,
      fees: 3.2,
      status: "open",
      tags: ["elliott", "wave", "bearish"]
    } as TradeEntry
  };

  const result4 = await actorDefinition.behavior(state, { payload: secondTradeMessage, sender: mockSender }, mockContext);
  state = result4.state;

  // Clôturer le premier trade avec profit
  console.log("\n=== Clôture du premier trade (avec profit) ===");
  const closeTradeMessage: PerformanceTrackerMessage = {
    type: "TRADE_CLOSED",
    trade: {
      ...openTradeMessage.trade,
      exitTime: Date.now(),
      exitPrice: 46500,
      exitOrder: {
        id: "order-001-exit",
        symbol: "BTC-USD",
        side: OrderSide.SELL,
        type: OrderType.MARKET,
        size: 0.1,
        status: OrderStatus.FILLED,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        filledSize: 0.1,
        avgFillPrice: 46500
      },
      pnl: 150, // (46500 - 45000) * 0.1 = 150
      pnlPercent: 3.33, // (150 / 4500) * 100
      status: "closed",
      duration: 300000 // 5 minutes
    } as TradeEntry
  };

  const result5 = await actorDefinition.behavior(state, { payload: closeTradeMessage, sender: mockSender }, mockContext);
  state = result5.state;

  // Afficher le résumé final
  console.log("\n=== Résumé final ===");
  const finalSummaryMessage: PerformanceTrackerMessage = {
    type: "LOG_POSITIONS_SUMMARY",
    currentPrices: { "BTC-USD": 46500, "ETH-USD": 3150 } // ETH baisse de 50$
  };
  
  await actorDefinition.behavior(state, { payload: finalSummaryMessage, sender: mockSender }, mockContext);

  console.log("\n=== Démonstration terminée ===");
};

// Pour exécuter la démonstration:
// demonstratePerformanceTrackerLogging().catch(console.error);
