import { createActorSystem } from '../../actor/system';
import { createRiskManagerActorDefinition } from '../../application/actors/risk-manager/risk-manager.actor';
import { createOrderManagerActorDefinition } from '../../application/actors/order-manager/order-manager.actor';
import { OrderSide, OrderType } from '../../domain/models/market.model';
import { ActorAddress } from '../../actor/models/actor.model';

/**
 * Mocks pour les tests d'intégration
 */
const createMockTradingPort = () => {
  const orders = new Map();
  let nextOrderId = 1;
  
  return {
    placeOrder: jest.fn().mockImplementation(async (orderParams) => {
      const id = `order-${nextOrderId++}`;
      const order = {
        ...orderParams,
        id,
        status: 'OPEN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        filledSize: 0
      };
      orders.set(id, order);
      return order;
    }),
    getOrderStatus: jest.fn().mockImplementation(async (orderId) => {
      return orders.get(orderId) || { status: 'NOT_FOUND' };
    }),
    cancelOrder: jest.fn().mockImplementation(async (orderId) => {
      const order = orders.get(orderId);
      if (order) {
        order.status = 'CANCELED';
        order.updatedAt = Date.now();
        return order;
      }
      throw new Error(`Order not found: ${orderId}`);
    }),
    getAccountBalance: jest.fn().mockResolvedValue({
      'USDC': 10000,
      'BTC': 1.0,
      'ETH': 10.0
    }),
    getOpenOrders: jest.fn().mockResolvedValue([]),
    getOrderHistory: jest.fn().mockResolvedValue([]),
    _orders: orders // Pour accéder aux ordres depuis les tests
  };
};

/**
 * Tests d'intégration pour la gestion centralisée des risques et des ordres
 */
describe('Risk and Order Management Integration Tests', () => {
  let actorSystem;
  let mockTradingPort;
  let riskManagerActor;
  let orderManagerActor;
  let tradingBotActor;
  
  beforeEach(() => {
    // Créer le système d'acteurs
    actorSystem = createActorSystem();
    
    // Créer le mock du port de trading
    mockTradingPort = createMockTradingPort();
    
    // Créer un mock pour l'acteur du bot de trading
    const tradingBotActorAddress = 'trading-bot-actor' as unknown as ActorAddress;
    
    // Intercepter les messages envoyés au bot de trading
    const tradingBotMessages = [];
    actorSystem.send = jest.fn().mockImplementation((address, message) => {
      if (address === tradingBotActorAddress) {
        tradingBotMessages.push(message);
      }
    });
    
    // Créer les acteurs de gestion des risques et des ordres
    const riskManagerConfig = {
      maxRiskPerTrade: 2, // 2% du capital par trade
      maxTotalRisk: 20,   // 20% du capital total
      positionSizingModel: 'fixedRisk' as const,
      riskLevelThresholds: {
        low: 5,
        medium: 10,
        high: 15,
        extreme: 20
      }
    };
    
    const orderManagerConfig = {
      orderTimeout: 10000,
      maxRetryAttempts: 2,
      retryDelay: 500,
      maxOrderHistorySize: 100,
      orderRateLimit: 10
    };
    
    // Créer les acteurs
    const riskManagerDef = createRiskManagerActorDefinition(mockTradingPort, riskManagerConfig);
    riskManagerActor = actorSystem.createActor(riskManagerDef);
    
    const orderManagerDef = createOrderManagerActorDefinition(mockTradingPort, orderManagerConfig);
    orderManagerActor = actorSystem.createActor(orderManagerDef);
    
    // Configurer l'acteur du trading bot
    tradingBotActor = tradingBotActorAddress;
    
    // Enregistrer les acteurs les uns avec les autres
    actorSystem.send(riskManagerActor, {
      type: 'REGISTER_ORDER_MANAGER',
      orderManagerAddress: orderManagerActor
    });
    
    actorSystem.send(orderManagerActor, {
      type: 'REGISTER_RISK_MANAGER',
      riskManagerAddress: riskManagerActor
    });
    
    actorSystem.send(orderManagerActor, {
      type: 'REGISTER_TRADING_BOT',
      tradingBotAddress: tradingBotActor
    });
  });
  
  test('Order should be assessed by risk manager before execution', async () => {
    // Créer un ordre de test
    const orderParams = {
      symbol: 'BTC/USDT',
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      size: 0.1,
      price: 50000
    };
    
    // Envoyer l'ordre à l'OrderManager
    actorSystem.send(orderManagerActor, {
      type: 'PLACE_ORDER',
      order: orderParams,
      source: 'test'
    });
    
    // Attendre que l'ordre soit traité
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Vérifier que placeOrder a été appelé sur le tradingPort
    expect(mockTradingPort.placeOrder).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'BTC/USDT',
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      size: expect.any(Number)
    }));
    
    // Vérifier que des ordres ont été créés
    expect(mockTradingPort._orders.size).toBeGreaterThan(0);
  });
  
  test('Risk manager should adjust order size if needed', async () => {
    // Créer un ordre de test avec une taille excessive
    const orderParams = {
      symbol: 'BTC/USDT',
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      size: 5.0, // Une taille importante qui devrait être ajustée
      price: 50000
    };
    
    // Envoyer l'ordre à l'OrderManager
    actorSystem.send(orderManagerActor, {
      type: 'PLACE_ORDER',
      order: orderParams,
      source: 'test'
    });
    
    // Attendre que l'ordre soit traité
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Vérifier que placeOrder a été appelé avec une taille ajustée
    const placedOrder = mockTradingPort.placeOrder.mock.calls[0][0];
    expect(placedOrder.size).toBeLessThan(orderParams.size);
    
    // La taille ajustée devrait être conforme à la limite de risque
    // Pour un capital de 10000 USDC et un risque max de 2%, 
    // la taille maximale serait d'environ 0.4 BTC à 50000 USDT
    expect(placedOrder.size * placedOrder.price).toBeLessThanOrEqual(10000 * 0.02 * 1.1); // 10% de marge
  });
  
  test('Order manager should handle order lifecycle', async () => {
    // Créer un ordre de test
    const orderParams = {
      symbol: 'ETH/USDT',
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      size: 1.0,
      price: 3000
    };
    
    // Modifier le mock pour simuler un ordre rempli
    mockTradingPort.getOrderStatus.mockImplementation(async (orderId) => {
      const order = mockTradingPort._orders.get(orderId);
      if (order) {
        // Simuler que l'ordre est rempli après un court délai
        if (Date.now() - order.createdAt > 50) {
          order.status = 'FILLED';
          order.filledSize = order.size;
          order.updatedAt = Date.now();
        }
        return order;
      }
      return { status: 'NOT_FOUND' };
    });
    
    // Envoyer l'ordre à l'OrderManager
    actorSystem.send(orderManagerActor, {
      type: 'PLACE_ORDER',
      order: orderParams,
      source: 'test'
    });
    
    // Attendre que l'ordre soit traité et rempli
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Vérifier que l'ordre a été placé
    expect(mockTradingPort.placeOrder).toHaveBeenCalled();
    
    // Vérifier que getOrderStatus a été appelé pour suivre l'ordre
    expect(mockTradingPort.getOrderStatus).toHaveBeenCalled();
    
    // Tous les ordres devraient être à l'état FILLED
    const allOrders = Array.from(mockTradingPort._orders.values());
    expect(allOrders.every(order => order.status === 'FILLED')).toBe(true);
  });
  
  test('Order manager should cancel stale orders', async () => {
    // Créer un ordre de test
    const orderParams = {
      symbol: 'ETH/USDT',
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      size: 1.0,
      price: 2800 // Un prix limite bas qui ne sera pas atteint
    };
    
    // Modifier le mock pour simuler un ordre qui reste ouvert
    mockTradingPort.getOrderStatus.mockImplementation(async (orderId) => {
      const order = mockTradingPort._orders.get(orderId);
      if (order) {
        // L'ordre reste ouvert
        return order;
      }
      return { status: 'NOT_FOUND' };
    });
    
    // Réduire le timeout des ordres pour le test
    actorSystem.send(orderManagerActor, {
      type: 'UPDATE_CONFIG',
      config: {
        orderTimeout: 50 // 50ms
      }
    });
    
    // Envoyer l'ordre à l'OrderManager
    actorSystem.send(orderManagerActor, {
      type: 'PLACE_ORDER',
      order: orderParams,
      source: 'test'
    });
    
    // Attendre que le timeout soit déclenché
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Vérifier que cancelOrder a été appelé
    expect(mockTradingPort.cancelOrder).toHaveBeenCalled();
  });
});
