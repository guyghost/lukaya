/**
 * Script de test pour la règle 3-5-7 de prise de profit
 * 
 * Ce script simule une position et vérifie que les prises de profit se déclenchent
 * correctement selon la règle 3-5-7.
 */

import { createTakeProfitManagerActorDefinition } from '../application/actors/take-profit-manager/take-profit-manager.actor';
import { PositionRisk } from '../application/actors/risk-manager/risk-manager.model';
import { OrderParams, OrderSide, OrderType } from '../domain/models/market.model';
import { createActorSystem } from '../actor/system';

// Simulation d'un adaptateur de trading
const mockTradingPort = {
  placeOrder: async (orderParams: OrderParams) => {
    console.log(`[ORDRE SIMULÉ] ${orderParams.side === OrderSide.BUY ? 'ACHAT' : 'VENTE'} ${orderParams.size} ${orderParams.symbol} à ${orderParams.price || 'prix du marché'}`);
    return {
      id: `order-${Math.random().toString(36).substring(7)}`,
      ...orderParams,
      status: 'FILLED'
    };
  },
  cancelOrder: async (orderId: string) => {
    console.log(`[ANNULATION SIMULÉE] Ordre ${orderId} annulé`);
    return true;
  },
  getOrder: async (orderId: string) => {
    return {
      id: orderId,
      symbol: 'BTC-USD',
      side: OrderSide.SELL,
      type: OrderType.MARKET,
      size: 0.1,
      status: 'FILLED'
    };
  },
  getOpenOrders: async () => {
    return [];
  },
  getAccountBalance: async () => {
    return {
      totalEquity: 100000,
      freeCollateral: 50000,
      openPositions: []
    };
  }
};

const runTest = async () => {
  console.log('=== Test de la règle 3-5-7 pour la prise de profit ===');
  
  // Créer un système d'acteurs
  const actorSystem = createActorSystem();
  
  // Configuration de la règle 3-5-7
  const takeProfitConfig = {
    enabled: true,
    profitTiers: [
      { profitPercentage: 3, closePercentage: 30 }, // Niveau 1: 3% → fermer 30%
      { profitPercentage: 5, closePercentage: 30 }, // Niveau 2: 5% → fermer 30%
      { profitPercentage: 7, closePercentage: 40 }, // Niveau 3: 7% → fermer 40%
    ],
    cooldownPeriod: 1000, // 1 seconde pour le test
    priceTolerance: 0.1, // 0.1% de tolérance
    trailingMode: false,
    minOrderSizePercent: 5, // 5% minimum
  };
  
  // Créer l'acteur de gestion des prises de profit
  const takeProfitActor = actorSystem.createActor(
    createTakeProfitManagerActorDefinition(mockTradingPort, takeProfitConfig)
  );
  
  // Simuler une position long BTC-USD
  const position: PositionRisk = {
    symbol: 'BTC-USD',
    direction: 'long',
    size: 0.5, // 0.5 BTC
    entryPrice: 50000, // Prix d'entrée à 50 000 $
    currentPrice: 50000,
    unrealizedPnl: 0,
    riskLevel: 'LOW',
    entryTime: Date.now()
  };
  
  console.log('Position initiale:', position);
  
  // Ouvrir une position
  actorSystem.send(takeProfitActor, {
    type: 'POSITION_OPENED',
    position,
  });
  
  // Attendre un peu pour s'assurer que la position est bien enregistrée
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Simuler une hausse progressive du prix
  const priceSteps = [
    { price: 51000, change: '+2.0%' },  // +2.0%, pas encore au premier palier
    { price: 51500, change: '+3.0%' },  // +3.0%, devrait déclencher le 1er palier
    { price: 52000, change: '+4.0%' },  // +4.0%, après le 1er palier
    { price: 52500, change: '+5.0%' },  // +5.0%, devrait déclencher le 2ème palier
    { price: 53000, change: '+6.0%' },  // +6.0%, après le 2ème palier
    { price: 53500, change: '+7.0%' },  // +7.0%, devrait déclencher le 3ème palier
    { price: 54000, change: '+8.0%' },  // +8.0%, tous les paliers sont déjà déclenchés
  ];
  
  // Simuler les mises à jour de prix
  for (const step of priceSteps) {
    console.log(`\n[PRIX] BTC-USD à ${step.price} (${step.change})`);
    
    // Mise à jour du prix
    actorSystem.send(takeProfitActor, {
      type: 'MARKET_UPDATE',
      symbol: 'BTC-USD',
      price: step.price,
    });
    
    // Attendre pour permettre au système de réagir
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n=== Test terminé ===');
};

// Exécuter le test
runTest().catch(console.error);
