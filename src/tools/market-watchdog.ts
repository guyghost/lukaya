#!/usr/bin/env bun

/**
 * Market Subscription Watchdog
 * 
 * Surveille l'état des souscriptions aux marchés et redémarre les services si nécessaire.
 * Ce script peut être exécuté en parallèle du bot de trading principal pour s'assurer
 * que les données de marché sont toujours disponibles.
 */

import { loadConfig, getNetworkFromString } from "../config/config";
import { createDydxClient } from "../adapters/secondary/dydx-client.adapter";
import { initializeLogger, getLogger } from "../infrastructure/logger";
import { ActorSystem, createActorSystem } from "../actor/system";
import { createMarketSupervisorActorDefinition } from "../application/actors/market-supervisor/market-supervisor.actor";
import { MarketSupervisorConfig } from "../application/actors/market-supervisor/market-supervisor.model";

// Configuration
const WATCHDOG_CHECK_INTERVAL = 60 * 1000; // Vérification toutes les 60 secondes
const MARKET_DATA_MAX_AGE = 30 * 1000; // 30 secondes d'âge maximum pour les données
const MARKETS_TO_MONITOR = ["BTC-USD", "ETH-USD", "SUI-USD"];

// État global
const marketDataTimestamps: Record<string, number> = {};
let supervisorActor: any = null;
let actorSystem: ActorSystem | null = null;

const initializeWatchdog = async () => {
  const config = loadConfig();
  initializeLogger(config);
  const logger = getLogger();
  
  // Initialiser le client dYdX
  logger.info("[WATCHDOG] Initialisation du client dYdX");
  const { marketDataPort } = createDydxClient({
    network: getNetworkFromString(config.network),
    mnemonic: config.dydx.mnemonic,
  });
  
  // Créer le système d'acteurs
  actorSystem = createActorSystem();
  
  // Configuration du superviseur
  const supervisorConfig: MarketSupervisorConfig = {
    maxMarkets: 75,
    pollingInterval: 2000,
    priceChangeThreshold: 0.1,
  };
  
  // Créer le superviseur de marché
  logger.info("[WATCHDOG] Création du superviseur de marché");
  const supervisorDefinition = createMarketSupervisorActorDefinition(
    marketDataPort,
    actorSystem,
    supervisorConfig
  );
  
  supervisorActor = actorSystem.createActor(supervisorDefinition);
  
  // Ajouter les marchés à surveiller
  for (const symbol of MARKETS_TO_MONITOR) {
    logger.info(`[WATCHDOG] Ajout du marché ${symbol} au superviseur`);
    actorSystem.send(supervisorActor, {
      type: "ADD_MARKET",
      symbol
    });
  }
  
  // Abonner à tous les marchés
  logger.info("[WATCHDOG] Abonnement à tous les marchés");
  actorSystem.send(supervisorActor, {
    type: "SUBSCRIBE_ALL"
  });
  
  // Initialiser les timestamps
  for (const symbol of MARKETS_TO_MONITOR) {
    marketDataTimestamps[symbol] = 0;
  }
  
  // Configurer le rappel pour les données de marché
  marketDataPort.onMarketDataReceived = (data) => {
    if (MARKETS_TO_MONITOR.includes(data.symbol)) {
      marketDataTimestamps[data.symbol] = Date.now();
      logger.debug(`[WATCHDOG] Données reçues pour ${data.symbol}: ${data.price}`);
    }
  };
  
  logger.info("[WATCHDOG] Initialisation terminée");
};

const checkMarketSubscriptions = async () => {
  if (!actorSystem || !supervisorActor) {
    return;
  }
  
  const logger = getLogger();
  const now = Date.now();
  let hasIssues = false;
  
  logger.info("[WATCHDOG] Vérification des souscriptions aux marchés");
  
  for (const symbol of MARKETS_TO_MONITOR) {
    const lastTimestamp = marketDataTimestamps[symbol] || 0;
    const age = now - lastTimestamp;
    
    if (lastTimestamp === 0) {
      logger.warn(`[WATCHDOG] Aucune donnée n'a été reçue pour ${symbol}`);
      hasIssues = true;
    } else if (age > MARKET_DATA_MAX_AGE) {
      logger.warn(`[WATCHDOG] Données obsolètes pour ${symbol}, âge: ${age}ms`);
      hasIssues = true;
    } else {
      logger.info(`[WATCHDOG] ${symbol}: OK, dernière mise à jour il y a ${age}ms`);
    }
  }
  
  if (hasIssues) {
    logger.warn("[WATCHDOG] Problèmes détectés, redémarrage des souscriptions");
    
    // Désabonner puis réabonner
    actorSystem.send(supervisorActor, {
      type: "UNSUBSCRIBE_ALL"
    });
    
    // Attendre 5 secondes avant de réabonner
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    actorSystem.send(supervisorActor, {
      type: "SUBSCRIBE_ALL"
    });
    
    logger.info("[WATCHDOG] Réabonnement effectué");
  } else {
    logger.info("[WATCHDOG] Toutes les souscriptions fonctionnent correctement");
  }
};

const main = async () => {
  const logger = getLogger();
  logger.info("[WATCHDOG] Démarrage du watchdog de souscription aux marchés");
  
  await initializeWatchdog();
  
  // Première vérification après 15 secondes
  setTimeout(async () => {
    await checkMarketSubscriptions();
    
    // Vérifications périodiques
    setInterval(async () => {
      await checkMarketSubscriptions();
    }, WATCHDOG_CHECK_INTERVAL);
  }, 15000);
};

main().catch((error) => {
  console.error("[FATAL] Erreur fatale:", error);
  process.exit(1);
});
