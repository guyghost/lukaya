# Guide de Migration vers le Client dYdX Amélioré

## Vue d'ensemble

Ce guide vous accompagne dans la migration du client dYdX standard vers le client amélioré avec gestion intelligente des limites d'API.

## Pourquoi Migrer ?

### Problèmes Résolus

- ❌ **Avant** : Erreurs 429 fréquentes (rate limit exceeded)
- ✅ **Après** : Gestion automatique et intelligente des limites

- ❌ **Avant** : Interruptions de service lors des pics de charge
- ✅ **Après** : Lissage automatique des requêtes

- ❌ **Avant** : Gestion manuelle des retry et backoff
- ✅ **Après** : Retry automatique avec stratégies adaptatives

### Avantages du Client Amélioré

1. **Zero erreur 429** : Queue intelligente avec priorisation
2. **Performance optimisée** : Batching automatique des requêtes similaires
3. **Monitoring intégré** : Statistiques en temps réel
4. **Configuration flexible** : Adaptable à tous les cas d'usage

## Plan de Migration

### Phase 1 : Préparation

#### 1.1 Installation des Dépendances

Aucune dépendance supplémentaire requise. Le client amélioré utilise les mêmes dépendances que le client standard.

#### 1.2 Sauvegarde de la Configuration Actuelle

```typescript
// Sauvegardez votre configuration actuelle
const currentConfig = {
  network: "mainnet",
  accountAddress: process.env.DYDX_ADDRESS,
  mnemonic: process.env.DYDX_MNEMONIC,
  // ... autres paramètres
};
```

### Phase 2 : Migration du Code

#### 2.1 Changement des Imports

**Avant :**
```typescript
import { createDydxClient } from "./adapters/secondary/dydx-client.adapter";
```

**Après :**
```typescript
import {
  createEnhancedDydxClient,
  DEFAULT_ENHANCED_DYDX_CONFIG
} from "./adapters/secondary/enhanced-dydx-client.adapter";
```

#### 2.2 Mise à jour de l'Initialisation

**Avant :**
```typescript
const client = await createDydxClient({
  network: Network.mainnet(),
  accountAddress: process.env.DYDX_ADDRESS,
  mnemonic: process.env.DYDX_MNEMONIC,
});
```

**Après :**
```typescript
const client = await createEnhancedDydxClient({
  network: Network.mainnet(),
  accountAddress: process.env.DYDX_ADDRESS,
  mnemonic: process.env.DYDX_MNEMONIC,
  ...DEFAULT_ENHANCED_DYDX_CONFIG,
  // Configuration personnalisée optionnelle
  queueConfig: {
    maxConcurrentRequests: 3,
    minRequestDelay: 200,
  }
});
```

#### 2.3 API Compatible

**Bonne nouvelle !** L'API reste identique. Tous vos appels existants fonctionnent sans modification :

```typescript
// Ces appels restent identiques
const marketData = await client.getLatestMarketData("BTC-USD");
const order = await client.placeOrder(orderSignal);
const positions = await client.getPositions();
```

### Phase 3 : Configuration Avancée

#### 3.1 Configuration par Environnement

**Développement :**
```typescript
const devConfig = {
  ...DEFAULT_ENHANCED_DYDX_CONFIG,
  queueConfig: {
    maxConcurrentRequests: 5,
    minRequestDelay: 100,
    enableAdaptiveRateLimit: false, // Désactiver en dev
  },
  enableMonitoring: true,
  monitoringIntervalMs: 10000, // Log toutes les 10s
};
```

**Production :**
```typescript
const prodConfig = {
  ...DEFAULT_ENHANCED_DYDX_CONFIG,
  queueConfig: {
    maxConcurrentRequests: 3,
    minRequestDelay: 200,
    enableAdaptiveRateLimit: true,
    smoothingFactor: 0.3,
  },
  rateLimiterConfig: {
    maxRequests: 10,
    windowMs: 60000,
    circuitBreakerThreshold: 5,
  },
  enableMonitoring: true,
  monitoringIntervalMs: 60000, // Log toutes les minutes
};
```

#### 3.2 Configuration par Use Case

**Trading Haute Fréquence :**
```typescript
const hftConfig = {
  queueConfig: {
    maxConcurrentRequests: 5,
    minRequestDelay: 50,
    enableBatching: false, // Pas de batching pour HFT
    maxQueueSizePerPriority: 200,
  },
  rateLimiterConfig: {
    burstSize: 20,
    tokenRefillRate: 0.5, // 30 req/min
  }
};
```

**Bot d'Analyse :**
```typescript
const analysisConfig = {
  queueConfig: {
    maxConcurrentRequests: 2,
    minRequestDelay: 1000,
    enableBatching: true,
    batchWindowMs: 2000,
    maxBatchSize: 20,
  }
};
```

### Phase 4 : Optimisations

#### 4.1 Utilisation des Nouvelles APIs Batch

**Avant :**
```typescript
// Appels individuels
const btcData = await client.getLatestMarketData("BTC-USD");
const ethData = await client.getLatestMarketData("ETH-USD");
const solData = await client.getLatestMarketData("SOL-USD");
```

**Après :**
```typescript
// Appel batch optimisé
const symbols = ["BTC-USD", "ETH-USD", "SOL-USD"];
const marketDataMap = await client.batchGetMarketData(symbols);
```

#### 4.2 Monitoring et Alertes

```typescript
// Configurer le monitoring
setInterval(async () => {
  const stats = client.getMonitoringData();

  // Alertes personnalisées
  if (stats.apiHealth.errorRate > 0.1) {
    logger.alert("High API error rate detected", {
      errorRate: stats.apiHealth.errorRate,
      consecutiveErrors: stats.apiHealth.consecutiveErrors
    });
  }

  if (stats.queueStats.currentThroughput < 0.5) {
    logger.warn("Low throughput detected", {
      throughput: stats.queueStats.currentThroughput
    });
  }
}, 30000);
```

### Phase 5 : Tests de Migration

#### 5.1 Tests Unitaires

```typescript
describe("Enhanced dYdX Client Migration", () => {
  let client: EnhancedDydxClient;

  beforeEach(async () => {
    client = await createEnhancedDydxClient({
      ...testConfig,
      queueConfig: {
        maxConcurrentRequests: 1,
        minRequestDelay: 0,
      }
    });
  });

  it("should handle rate limits gracefully", async () => {
    // Générer 20 requêtes rapides
    const requests = Array(20).fill(null).map(() =>
      client.getLatestMarketData("BTC-USD")
    );

    // Toutes doivent réussir grâce à la queue
    const results = await Promise.all(requests);
    expect(results).toHaveLength(20);
    expect(results.every(r => r.symbol === "BTC-USD")).toBe(true);
  });
});
```

#### 5.2 Tests d'Intégration

```typescript
// Test avec environnement de staging
const stagingClient = await createEnhancedDydxClient({
  network: Network.testnet(),
  ...stagingConfig
});

// Simuler charge réelle
async function loadTest() {
  const operations = [
    // Données de marché (priorité normale)
    ...Array(10).fill(null).map(() =>
      stagingClient.getLatestMarketData("BTC-USD")
    ),

    // Ordres (priorité critique)
    stagingClient.placeOrder(testOrder),

    // Données historiques (priorité basse)
    stagingClient.getHistoricalMarketData("ETH-USD", 100)
  ];

  const results = await Promise.allSettled(operations);
  const successRate = results.filter(r => r.status === "fulfilled").length / results.length;

  console.log(`Success rate: ${(successRate * 100).toFixed(2)}%`);
}
```

### Phase 6 : Déploiement

#### 6.1 Déploiement Progressif

1. **Canary (5%)** : Déployer sur 5% du trafic
2. **Monitoring** : Observer pendant 24h
3. **Expansion (25%)** : Si stable, étendre à 25%
4. **Full rollout** : Après validation, déployer à 100%

#### 6.2 Métriques à Surveiller

- Taux d'erreur API
- Latence moyenne des requêtes
- Utilisation mémoire/CPU
- Nombre de requêtes en queue
- Activations du circuit breaker

### Phase 7 : Rollback Plan

#### 7.1 Switch Rapide

Gardez une fonction de switch pour revenir rapidement :

```typescript
const USE_ENHANCED_CLIENT = process.env.USE_ENHANCED_CLIENT === "true";

export async function createTradingClient(config: any) {
  if (USE_ENHANCED_CLIENT) {
    return createEnhancedDydxClient(config);
  } else {
    return createDydxClient(config);
  }
}
```

#### 7.2 Procédure de Rollback

1. Changer `USE_ENHANCED_CLIENT` à `false`
2. Redéployer l'application
3. Vérifier les logs pour confirmer l'utilisation du client standard
4. Investiguer les problèmes rencontrés

## Checklist de Migration

- [ ] Sauvegarder la configuration actuelle
- [ ] Mettre à jour les imports
- [ ] Ajouter la configuration du client amélioré
- [ ] Tester en environnement de développement
- [ ] Implémenter le monitoring
- [ ] Écrire les tests de migration
- [ ] Configurer le feature flag de rollback
- [ ] Déployer en canary
- [ ] Monitorer les métriques
- [ ] Compléter le rollout

## Support et Dépannage

### Problèmes Courants

**1. "Queue full" errors**
```typescript
// Augmenter la taille de la queue
queueConfig: {
  maxQueueSizePerPriority: 200 // Au lieu de 100
}
```

**2. Performance dégradée**
```typescript
// Augmenter la concurrence
queueConfig: {
  maxConcurrentRequests: 5 // Au lieu de 3
}
```

**3. Trop de logs**
```typescript
// Désactiver les statistiques détaillées
rateLimiterConfig: {
  enableDetailedStats: false
}
```

### Ressources

- [Documentation API Queue Manager](./src/shared/utils/api-queue/README.md)
- [Guide de Configuration Rate Limiter](./RATE_LIMITING_SOLUTION.md)
- [Exemples d'Usage](./src/examples/enhanced-api-client-usage.ts)

## Conclusion

La migration vers le client amélioré est conçue pour être simple et sans risque. L'API reste identique, seule l'initialisation change. Les bénéfices en termes de stabilité et de performance justifient largement l'effort minimal de migration.
