#!/usr/bin/env bun

// Test minimal pour la stratégie SimpleMA
import { createSimpleMAStrategy } from './adapters/primary/simple-ma.strategy';

console.log("Démarrage du test SimpleMA");

// Créer une stratégie de test
const strategy = createSimpleMAStrategy({
  symbol: 'BTC_USD', 
  shortPeriod: 8,
  longPeriod: 21,
  positionSize: 0.1,
  useBollinger: true,
  bollingerPeriod: 20,
  bollingerStdDev: 2,
  useMACD: true,
  macdFastPeriod: 8,
  macdSlowPeriod: 21,
  macdSignalPeriod: 5,
  useRSI: true,
  rsiPeriod: 14,
  rsiOversold: 45,
  rsiOverbought: 55
});

console.log(`Stratégie créée: ${strategy.getName()}, ID: ${strategy.getId()}`);

// Simuler quelques données de marché pour constituer l'historique des prix
console.log("Initialisation de l'historique des prix...");
const initialData = [];
let price = 16500;

// Générer un historique de prix suffisant
for (let i = 0; i < 50; i++) {
  // Ajouter une variation aléatoire au prix
  price = price + (Math.random() * 50 - 25);
  
  const data = { 
    timestamp: new Date('2023-01-01T00:00:00Z').getTime() + i * 3600000, // Incréments d'une heure
    price: price,
    symbol: 'BTC_USD',
    volume: 1000 + Math.random() * 1000,
    bid: price - 1,
    ask: price + 1
  };
  
  initialData.push(data);
}

// Traiter les données pour construire l'historique
(async () => {
  console.log("Construction de l'historique des prix...");
  for (const data of initialData) {
    await strategy.processMarketData(data);
  }
  
  console.log("Historique des prix construit, testant maintenant les signaux...");
  
  // Maintenant, simulons des signaux
  const testData = [
    // Signal d'achat potentiel (prix en hausse)
    { timestamp: new Date('2023-01-03T00:00:00Z').getTime(), price: price + 100, symbol: 'BTC_USD', volume: 2000, bid: price + 99, ask: price + 101 },
    // Signal de vente potentiel (prix en baisse)
    { timestamp: new Date('2023-01-03T01:00:00Z').getTime(), price: price - 100, symbol: 'BTC_USD', volume: 2000, bid: price - 101, ask: price - 99 }
  ];
  
  for (const data of testData) {
    console.log(`Traitement des données: ${data.symbol} @ ${data.price} (${new Date(data.timestamp).toISOString()})`);
    const signal = await strategy.processMarketData(data);
    
    if (signal) {
      console.log(`Signal généré: ${signal.type} ${signal.direction} à ${data.price}`);
      const order = strategy.generateOrder(signal, data);
      console.log(`Ordre généré: ${order ? JSON.stringify(order) : 'Aucun ordre'}`);
    } else {
      console.log("Aucun signal généré");
    }
  }
})();
