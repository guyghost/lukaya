#!/usr/bin/env bun

// Fichier de test pour le backtesting
import * as fs from 'fs';
import * as path from 'path';
import { createSimpleMAStrategy } from './adapters/primary/simple-ma.strategy';
import { getLogger } from './infrastructure/logger';

const logger = getLogger();

// Fonction principale pour le test
async function main() {
  logger.info("Démarrage du test de backtesting");
  
  try {
    // Vérifier les fichiers de données
    const dataDir = path.resolve(process.cwd(), 'data');
    const files = fs.readdirSync(dataDir);
    logger.info(`Fichiers disponibles: ${files.join(', ')}`);
    
    // Vérifier le contenu d'un fichier
    const btcFile = path.join(dataDir, 'BTC_USD_1h.csv');
    const ethFile = path.join(dataDir, 'ETH_USD_1h.csv');
    
    if (fs.existsSync(btcFile)) {
      const content = fs.readFileSync(btcFile, 'utf8').split('\n').slice(0, 5).join('\n');
      logger.info(`Exemple de contenu BTC:\n${content}`);
    }
    
    if (fs.existsSync(ethFile)) {
      const content = fs.readFileSync(ethFile, 'utf8').split('\n').slice(0, 5).join('\n');
      logger.info(`Exemple de contenu ETH:\n${content}`);
    }
    
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
    
    logger.info(`Stratégie créée: ${strategy.getName()}, ID: ${strategy.getId()}`);
    
    // Simuler quelques données de marché
    const testData = [
      { timestamp: new Date('2023-01-01T01:00:00Z').getTime(), price: 16565.75, symbol: 'BTC_USD', volume: 1350, bid: 16565.0, ask: 16566.0 },
      { timestamp: new Date('2023-01-01T02:00:00Z').getTime(), price: 16580.50, symbol: 'BTC_USD', volume: 1450, bid: 16580.0, ask: 16581.0 },
      { timestamp: new Date('2023-01-01T03:00:00Z').getTime(), price: 16590.75, symbol: 'BTC_USD', volume: 1550, bid: 16590.0, ask: 16591.0 }
    ];
    
    logger.info("Traitement des données de marché de test...");
    for (const data of testData) {
      logger.info(`Traitement des données: ${data.symbol} @ ${data.price} (${new Date(data.timestamp).toISOString()})`);
      const signal = await strategy.processMarketData(data);
      
      if (signal) {
        logger.info(`Signal généré: ${signal.type} ${signal.direction} à ${data.price}`);
        const order = strategy.generateOrder(signal, data);
        logger.info(`Ordre généré: ${order ? JSON.stringify(order) : 'Aucun ordre'}`);
      } else {
        logger.info("Aucun signal généré");
      }
    }
    
    logger.info("Test de backtesting terminé");
  } catch (error) {
    logger.error("Erreur lors du test:", error instanceof Error ? error : String(error));
    process.exit(1);
  }
}

main().catch(console.error);
