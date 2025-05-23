#!/usr/bin/env bun

/**
 * Outil de diagnostic pour vérifier les souscriptions aux marchés
 * 
 * Ce script permet de tester indépendamment les souscriptions aux marchés
 * sans exécuter l'ensemble du bot de trading. Il est utile pour déboguer
 * les problèmes de connectivité et de réception des données de marché.
 */

import { loadConfig, getNetworkFromString } from "../config/config";
import { createDydxClient } from "../adapters/secondary/dydx-client.adapter";
import { initializeLogger, getLogger } from "../infrastructure/logger";
import { MarketData } from "../domain/models/market.model";

const markets = [
  "BTC-USD", 
  "ETH-USD", 
  "SUI-USD", 
  "AIXBT-USD",
  "KAITO-USD",
  "DYDX-USD",
  "XRP-USD"
];

// Stockage des données reçues par marché
const receivedData: Record<string, { 
  count: number, 
  lastPrice: number, 
  lastTimestamp: number,
  updates: Array<{ price: number, timestamp: number }>
}> = {};

// Fonction pour initialiser le suivi
const initializeTracking = (symbol: string) => {
  receivedData[symbol] = {
    count: 0,
    lastPrice: 0,
    lastTimestamp: 0,
    updates: []
  };
};

// Fonction pour afficher un rapport sur les souscriptions
const printReport = () => {
  const logger = getLogger();
  
  logger.info("==================== RAPPORT DE DIAGNOSTIC ====================");
  logger.info(`Heure actuelle: ${new Date().toISOString()}`);
  logger.info(`Statut des marchés surveillés:`);
  
  for (const symbol of markets) {
    const data = receivedData[symbol];
    
    if (!data || data.count === 0) {
      logger.error(`❌ ${symbol}: AUCUNE DONNÉE REÇUE`);
      continue;
    }
    
    const lastUpdate = Date.now() - data.lastTimestamp;
    const status = lastUpdate < 10000 ? "🟢 ACTIF" : 
                 (lastUpdate < 30000 ? "🟡 RETARDÉ" : "🔴 INACTIF");
    
    logger.info(`${status} ${symbol}: ${data.count} mises à jour, dernière prix=${data.lastPrice}, il y a ${Math.round(lastUpdate/1000)}s`);
    
    // Afficher les 3 dernières mises à jour
    const recentUpdates = data.updates.slice(-3);
    if (recentUpdates.length > 0) {
      logger.info(`   Dernières mises à jour pour ${symbol}:`);
      recentUpdates.forEach(update => {
        logger.info(`   - ${new Date(update.timestamp).toISOString()}: ${update.price}`);
      });
    }
  }
  
  logger.info("===============================================================");
};

// Fonction de rappel pour les données de marché
const onMarketData = (symbol: string, data: MarketData) => {
  const logger = getLogger();
  
  if (!receivedData[symbol]) {
    initializeTracking(symbol);
  }
  
  // Mettre à jour les statistiques
  receivedData[symbol].count++;
  receivedData[symbol].lastPrice = data.price;
  receivedData[symbol].lastTimestamp = data.timestamp || Date.now();
  
  // Conserver les 10 dernières mises à jour
  receivedData[symbol].updates.push({
    price: data.price,
    timestamp: data.timestamp || Date.now()
  });
  
  if (receivedData[symbol].updates.length > 10) {
    receivedData[symbol].updates.shift();
  }
  
  // Afficher en temps réel
  logger.info(`[${new Date().toISOString()}] Mise à jour ${symbol}: prix=${data.price}, bid=${data.bid}, ask=${data.ask}`);
};

const main = async (): Promise<void> => {
  // Charger la configuration
  const config = loadConfig();
  
  // Initialiser le journal
  initializeLogger(config);
  const logger = getLogger();
  
  logger.info("[DIAGNOSTIC] Démarrage de l'outil de diagnostic des souscriptions aux marchés");
  
  // Initialiser le client dYdX
  logger.info("[DIAGNOSTIC] Initialisation du client dYdX...");
  const { marketDataPort } = createDydxClient({
    network: getNetworkFromString(config.network),
    mnemonic: config.dydx.mnemonic,
  });
  
  // Initialiser le suivi pour tous les marchés
  markets.forEach(initializeTracking);
  
  // S'abonner à tous les marchés
  logger.info(`[DIAGNOSTIC] Abonnement aux marchés: ${markets.join(', ')}`);
  
  const subscriptions = markets.map(async (symbol) => {
    try {
      logger.info(`[DIAGNOSTIC] Abonnement à ${symbol}...`);
      await marketDataPort.subscribeToMarketData(symbol);
      logger.info(`[DIAGNOSTIC] Abonnement réussi pour ${symbol}`);
      return true;
    } catch (error) {
      logger.error(`[DIAGNOSTIC] Erreur lors de l'abonnement à ${symbol}:`, error as Error);
      return false;
    }
  });
  
  // Attendre que tous les abonnements soient traités
  await Promise.all(subscriptions);
  logger.info("[DIAGNOSTIC] Tous les abonnements ont été initiés");
  
  // Fonction de polling pour récupérer les données
  const pollMarketData = async () => {
    for (const symbol of markets) {
      try {
        const data = await marketDataPort.getLatestMarketData(symbol);
        onMarketData(symbol, data);
      } catch (error) {
        logger.error(`[DIAGNOSTIC] Erreur lors de la récupération des données pour ${symbol}:`, error as Error);
      }
    }
  };
  
  // Programmer le polling et les rapports périodiques
  let pollingCount = 0;
  const pollingInterval = setInterval(async () => {
    await pollMarketData();
    pollingCount++;
    
    // Afficher un rapport complet toutes les 5 itérations
    if (pollingCount % 5 === 0) {
      printReport();
    }
  }, 3000); // Polling toutes les 3 secondes
  
  // Premier polling immédiat
  pollMarketData().catch(error => {
    logger.error("[DIAGNOSTIC] Erreur lors du premier polling:", error as Error);
  });
  
  // Afficher un rapport après 10 et 30 secondes
  setTimeout(() => printReport(), 10 * 1000);
  setTimeout(() => printReport(), 30 * 1000);
  
  // Gérer l'arrêt propre
  process.on("SIGINT", () => {
    logger.info("[DIAGNOSTIC] Arrêt de l'outil de diagnostic...");
    clearInterval(pollingInterval);
    
    // Afficher un rapport final
    printReport();
    
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  });
  
  logger.info("[DIAGNOSTIC] Outil de diagnostic en cours d'exécution. Appuyez sur Ctrl+C pour arrêter.");
};

main().catch((error) => {
  console.error("[FATAL] Erreur fatale:", error);
  process.exit(1);
});
