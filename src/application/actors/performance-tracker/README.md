# Performance Tracker - Documentation des Logs

Le Performance Tracker a été amélioré avec un système de logs détaillé pour suivre en temps réel les performances de trading, les stratégies actives et les PNL des positions ouvertes.

## 🚀 Fonctionnalités de Logging

### 1. Logs d'Ouverture de Trade

Quand un trade est ouvert, le système affiche :
- 🚀 Emoji pour identifier facilement
- ID du trade
- Symbole et stratégie
- Côté (BUY/SELL)
- Prix d'entrée et quantité
- Heure d'ouverture
- Frais
- Tags associés

**Exemple de log :**
```
🚀 Nouveau trade ouvert : trade-001
{
  "tradeId": "trade-001",
  "symbol": "BTC-USD",
  "strategy": "rsi-divergence",
  "side": "BUY",
  "entryPrice": 45000,
  "quantity": 0.1,
  "entryTime": "2025-05-29T10:30:00.000Z",
  "fees": 5.0,
  "tags": ["rsi", "divergence", "bullish"]
}
```

### 2. Logs de Clôture de Trade

Quand un trade est fermé, le système affiche :
- 💰 Emoji pour profit, 📉 pour perte, ⚖️ pour break-even
- Tous les détails du trade fermé
- PNL réalisé et pourcentage
- Durée du trade
- Heure de sortie

**Exemple de log :**
```
💰 Trade clôturé : trade-001
{
  "tradeId": "trade-001",
  "symbol": "BTC-USD",
  "strategy": "rsi-divergence",
  "side": "BUY",
  "entryPrice": 45000,
  "exitPrice": 46500,
  "quantity": 0.1,
  "pnl": 150,
  "pnlPercent": 3.33,
  "fees": 5.0,
  "duration": 300000,
  "durationMinutes": 5
}
```

### 3. Statistiques Générales

Après chaque ouverture/clôture de trade, le système affiche :
- 📊 Nombre total de trades
- Trades fermés vs ouverts
- PNL total réalisé
- Statistiques par stratégie

**Exemple de log :**
```
📊 Statistiques générales des trades
{
  "totalTrades": 10,
  "closedTrades": 8,
  "openTrades": 2,
  "totalPnlRealized": 1250.50
}

📈 Stats stratégie: rsi-divergence
{
  "strategy": "rsi-divergence",
  "totalTrades": 5,
  "openTrades": 1,
  "totalPnlRealized": 750.25,
  "avgPnlPerTrade": "150.05"
}
```

### 4. Suivi des PNL Non Réalisés

À chaque mise à jour de prix, le système calcule et affiche :
- 💹 Nouveau prix pour le symbole
- 🔄 PNL non réalisé pour chaque position ouverte
- Pourcentage de gain/perte

**Exemple de log :**
```
💹 Mise à jour prix BTC-USD: 46500
{
  "symbol": "BTC-USD",
  "newPrice": 46500,
  "timestamp": "2025-05-29T10:35:00.000Z",
  "openPositions": 1
}

🔄 PNL unrealized trade-001
{
  "tradeId": "trade-001",
  "symbol": "BTC-USD",
  "strategy": "rsi-divergence",
  "side": "BUY",
  "entryPrice": 45000,
  "currentPrice": 46500,
  "unrealizedPnl": "150.00",
  "unrealizedPnlPercent": "3.33"
}
```

### 5. Résumé des Positions

Le nouveau message `LOG_POSITIONS_SUMMARY` affiche un rapport complet :
- 📋 Résumé général
- 💼 Détail de toutes les positions ouvertes
- 📊 Performance par stratégie
- 📈 Performance par symbole

## 🛠️ Utilisation

### 1. Initialisation avec Logs

```typescript
import { createPerformanceTrackerActorDefinition } from "./performance-tracker.actor";

const actorDefinition = createPerformanceTrackerActorDefinition({
  historyLength: 1000,
  realTimeUpdates: true,
  calculationInterval: 60000,
  trackOpenPositions: true
});

// Le système logge automatiquement l'initialisation :
// 🚀 Initialisation du Performance Tracker
```

### 2. Envoi de Messages

```typescript
// Ouvrir un trade
const openMessage = {
  type: "TRADE_OPENED",
  trade: {
    id: "trade-001",
    strategyId: "rsi-divergence",
    symbol: "BTC-USD",
    // ... autres propriétés
  }
};

// Mettre à jour un prix
const priceMessage = {
  type: "UPDATE_PRICE",
  symbol: "BTC-USD",
  price: 46500,
  timestamp: Date.now()
};

// Demander un résumé complet
const summaryMessage = {
  type: "LOG_POSITIONS_SUMMARY",
  currentPrices: { "BTC-USD": 46500, "ETH-USD": 3200 }
};
```

### 3. Configuration du Logging

Les logs utilisent le système `enhanced-logger` avec le contexte "PerformanceTracker".
Vous pouvez ajuster le niveau de log dans votre configuration :

```typescript
// Les logs de PNL unrealized sont en niveau DEBUG
// Les logs de trades et statistiques sont en niveau INFO
```

## 📊 Types de Logs par Niveau

### INFO
- Ouverture/fermeture de trades
- Statistiques générales
- Résumés de performance
- Configuration

### DEBUG
- Mises à jour de prix
- PNL non réalisés
- Détails techniques

## 🔧 Messages Disponibles

1. `TRADE_OPENED` - Logs automatiques à l'ouverture
2. `TRADE_CLOSED` - Logs automatiques à la fermeture
3. `UPDATE_PRICE` - Logs des PNL unrealized
4. `LOG_POSITIONS_SUMMARY` - Rapport complet sur demande
5. `UPDATE_CONFIG` - Logs des changements de configuration

## 🎯 Exemple d'Utilisation Complète

Consultez le fichier `performance-tracker.example.ts` pour voir une démonstration complète des fonctionnalités de logging.

## 🏷️ Emojis de Référence

- 🚀 Initialisation / Nouveau trade
- 💰 Trade profitable fermé
- 📉 Trade déficitaire fermé
- ⚖️ Trade break-even fermé
- 💹 Mise à jour de prix
- 🔄 PNL non réalisé
- 💼 Positions ouvertes
- 📊 Statistiques générales
- 📈 Performance par symbole/stratégie
- 📋 Résumés
- ⚙️ Configuration
- 🔹 Détail d'une position

Ces logs vous permettront de suivre en temps réel :
- ✅ Le nombre de trades par stratégie
- ✅ Les stratégies qui déclenchent le plus de trades
- ✅ Le PNL en cours de chaque position
- ✅ Les performances historiques
- ✅ Les statistiques globales
