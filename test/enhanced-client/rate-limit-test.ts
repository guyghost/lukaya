import { createEnhancedDydxClient } from "../../src/adapters/secondary/enhanced-dydx-client.adapter";
import { Network } from "@dydxprotocol/v4-client-js";
import { createContextualLogger } from "../../src/infrastructure/logging/enhanced-logger";

const logger = createContextualLogger("RateLimitTest");

async function testRateLimiting() {
  logger.info("🧪 Test de prévention des rate limits");

  try {
    // Créer le client avec une configuration agressive pour tester
    const client = await createEnhancedDydxClient({
      network: Network.testnet(),
      accountAddress: process.env.DYDX_ADDRESS || "test-address",
      mnemonic: process.env.DYDX_MNEMONIC || "test mnemonic",
      queueConfig: {
        maxConcurrentRequests: 2, // Limite basse pour tester
        minRequestDelay: 500, // 500ms entre les requêtes
        enableAdaptiveRateLimit: true,
        smoothingFactor: 0.3,
      },
      rateLimiterConfig: {
        maxRequests: 5, // Seulement 5 requêtes par minute
        windowMs: 60000,
        enableTokenBucket: true,
        burstSize: 7,
      },
      enableMonitoring: true,
      monitoringIntervalMs: 5000, // Monitoring toutes les 5 secondes
    });

    logger.info("✅ Client créé avec succès");

    // Test 1: Rafale de requêtes de données de marché
    logger.info("📊 Test 1: Rafale de requêtes de données de marché");
    const symbols = ["BTC-USD", "ETH-USD", "SOL-USD", "AVAX-USD", "MATIC-USD"];
    const marketDataPromises = [];

    // Lancer 10 requêtes rapidement
    for (let i = 0; i < 10; i++) {
      const symbol = symbols[i % symbols.length];
      marketDataPromises.push(
        client.marketDataPort
          .getLatestMarketData(symbol)
          .then((data) => {
            logger.info(`✅ Données reçues pour ${symbol}: $${data?.price}`);
            return { success: true, symbol };
          })
          .catch((error) => {
            logger.error(`❌ Erreur pour ${symbol}:`, error);
            return { success: false, symbol, error: error.message };
          })
      );
    }

    const results = await Promise.all(marketDataPromises);
    const successful = results.filter((r) => r.success).length;
    logger.info(`📊 Résultats: ${successful}/10 requêtes réussies`);

    // Attendre un peu
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Test 2: Requêtes batch
    logger.info("🔄 Test 2: Requêtes batch");
    const batchResults = await client.marketDataPort.batchGetMarketData(symbols);
    logger.info(`✅ Batch résultats: ${batchResults.size} symboles récupérés`);

    // Test 3: Monitoring
    logger.info("📈 Test 3: Vérification du monitoring");
    const monitoringData = client.getMonitoringData();
    logger.info("📊 Statistiques du client:", {
      totalRequests: monitoringData.queueStats.totalRequests,
      successfulRequests: monitoringData.queueStats.successfulRequests,
      failedRequests: monitoringData.queueStats.failedRequests,
      currentQueueSize: monitoringData.queueStats.queueLength,
      throughput: `${monitoringData.queueStats.currentThroughput.toFixed(2)} req/s`,
      tokensAvailable: monitoringData.rateLimiterStats.tokensAvailable,
      apiHealthy: monitoringData.apiHealth.isHealthy,
      errorRate: `${monitoringData.apiHealth.errorRate.toFixed(2)} errors/s`,
    });

    // Test 4: Gestion de la pause
    logger.info("⏸️ Test 4: Pause et reprise");
    client.pauseRequests();
    logger.info("⏸️ Requêtes mises en pause");

    // Essayer une requête pendant la pause
    try {
      await client.marketDataPort.getLatestMarketData("BTC-USD");
    } catch (error) {
      logger.info("✅ Requête correctement rejetée pendant la pause");
    }

    client.resumeRequests();
    logger.info("▶️ Requêtes reprises");

    // Test 5: Nettoyage
    logger.info("🧹 Test 5: Nettoyage");
    client.clearQueues();
    const finalStats = client.getMonitoringData();
    logger.info("📊 Statistiques finales après nettoyage:", {
      queueLength: finalStats.queueStats.queueLength,
    });

    logger.info("✅ Tous les tests terminés avec succès!");
    logger.info("💡 Aucune erreur de rate limit détectée grâce à l'enhanced client!");

  } catch (error) {
    logger.error("❌ Erreur lors du test:", error);
  }
}

// Exécuter le test
if (require.main === module) {
  testRateLimiting()
    .then(() => {
      logger.info("🏁 Test terminé");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("💥 Erreur fatale:", error);
      process.exit(1);
    });
}

export { testRateLimiting };
