# 📊 Système de Suivi des Positions Ouvertes - Lukaya Trading Bot

## 🎯 Vue d'ensemble

Le bot Lukaya implémente un **système de suivi multi-niveaux sophistiqué** pour toutes les positions ouvertes, assurant une surveillance continue et une gestion automatisée des risques via trois acteurs principaux coordonnés.

## 🏗️ Architecture du Système de Suivi

### 🔥 Acteurs Principaux

```
┌─────────────────────────────┐
│     TRADING BOT SERVICE     │ (Coordinateur central)
│                             │
├─────────────┬─────────────┬─┴─────────────┐
│             │             │               │
▼             ▼             ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│RISK MANAGER │ │PERFORMANCE  │ │TAKE PROFIT  │ │TAKE PROFIT  │
│             │ │TRACKER      │ │MANAGER      │ │INTEGRATOR   │
│• Position   │ │             │ │             │ │             │
│  Risk       │ │• Trade      │ │• Règle      │ │• Surveillance│
│• Stop Loss  │ │  Tracking   │ │  3-5-7      │ │  Continue   │
│• Viabilité  │ │• P&L Calc   │ │• Auto Take  │ │• Coordination│
│• Account    │ │• Metrics    │ │  Profit     │ │  Acteurs    │
│  Risk       │ │• History    │ │• Tiers      │ │             │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
```

## 🔄 Flux de Vie d'une Position

### 1️⃣ **Ouverture de Position**

```typescript
// 1. Signal généré par une stratégie
Signal → Strategy → generateOrder() → OrderParams

// 2. Évaluation du risque
OrderParams → Risk Manager → ASSESS_ORDER → {
  approved: boolean,
  adjustedSize?: number,
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'
}

// 3. Exécution de l'ordre
if (approved) → TradingPort.placeOrder() → Order placed

// 4. Notification des acteurs
ORDER_FILLED → {
  Risk Manager: createPositionRisk(),
  Performance Tracker: recordTradeOpened(),
  Take Profit Manager: POSITION_OPENED
}
```

### 2️⃣ **Suivi Temps Réel**

#### **Mise à Jour Continue des Prix** (toutes les 3 secondes)
```typescript
// Market Data Update Loop
setInterval(() => {
  for (symbol of watchedSymbols) {
    const marketData = await getLatestMarketData(symbol);
    
    // 1. Risk Manager - Update position prices
    riskManager.send("MARKET_UPDATE", { symbol, price: marketData.price });
    
    // 2. Performance Tracker - Store price history
    performanceTracker.send("UPDATE_PRICE", { 
      symbol, 
      price: marketData.price, 
      timestamp: Date.now() 
    });
    
    // 3. Take Profit Manager - Check profit levels
    takeProfitManager.analyzePosition(symbol, marketData.price);
  }
}, POLL_INTERVAL); // 3000ms par défaut
```

#### **Recalcul des Métriques**
```typescript
// Automatic P&L calculation
position.unrealizedPnl = position.direction === 'long' 
  ? (currentPrice - entryPrice) * size
  : (entryPrice - currentPrice) * size;

// Risk level determination
if (unrealizedPnl < 0) {
  const lossPercent = Math.abs(unrealizedPnl) / (entryPrice * size);
  riskLevel = lossPercent > 0.05 ? 'EXTREME' : 
              lossPercent > 0.035 ? 'HIGH' : 
              lossPercent > 0.02 ? 'MEDIUM' : 'LOW';
}
```

### 3️⃣ **Analyse de Viabilité Périodique**

#### **Analyse Automatique** (toutes les 5 minutes)
```typescript
setInterval(() => {
  riskManager.send("ANALYZE_OPEN_POSITIONS");
}, POSITION_ANALYSIS_INTERVAL); // 300000ms = 5 minutes

// Critères d'analyse pour chaque position
const analyzePositionViability = (position) => {
  // 1. Stop Loss Check
  if (position.direction === 'long' && priceDelta < 0) {
    const lossPercent = Math.abs(priceDelta) / position.entryPrice;
    if (lossPercent >= config.stopLossPercent) { // 2% par défaut
      return {
        isViable: false,
        shouldClose: true,
        reason: "Stop loss triggered"
      };
    }
  }
  
  // 2. Take Profit Check
  if (position.unrealizedPnl > 0) {
    const profitPercent = position.unrealizedPnl / (position.entryPrice * position.size);
    if (profitPercent >= config.takeProfitPercent) { // 4% par défaut
      return {
        isViable: true,
        recommendation: "Consider taking profits"
      };
    }
  }
  
  // 3. Holding Time Analysis
  if (position.holdingTime) {
    const holdingDays = position.holdingTime / (1000 * 60 * 60 * 24);
    if (holdingDays > 7 && position.unrealizedPnl <= 0) {
      return {
        isViable: false,
        shouldClose: true,
        reason: "Held too long without profit"
      };
    }
  }
  
  // 4. Trend Reversal Detection
  if (marketVolatility > 0.03 && position.unrealizedPnl < 0) {
    return {
      isViable: false,
      shouldClose: true,
      reason: "Market trend reversal detected"
    };
  }
};
```

## 📈 Structures de Données de Suivi

### 🔴 **Risk Manager - PositionRisk**
```typescript
interface PositionRisk {
  symbol: string;
  direction: 'long' | 'short' | 'none';
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  isViable?: boolean;
  viabilityReason?: string;
  holdingTime?: number;
  entryTime?: number;
}

// État global du Risk Manager
interface RiskManagerState {
  config: RiskManagerConfig;
  positions: Record<string, PositionRisk>;
  accountRisk: AccountRisk;
  marketVolatility: Record<string, number>;
  dailyPnL: number;
  lastRebalance: number;
}
```

### 📊 **Performance Tracker - TradeEntry**
```typescript
interface TradeEntry {
  id: string;
  strategyId: string;
  symbol: string;
  entryTime: number;
  entryPrice: number;
  entryOrder: Order;
  exitTime?: number;
  exitPrice?: number;
  exitOrder?: Order;
  quantity: number;
  pnl?: number;
  pnlPercent?: number;
  fees: number;
  status: "open" | "closed" | "canceled";
  duration?: number;
  tags: string[];
}

// État du Performance Tracker
interface PerformanceTrackerState {
  trades: TradeEntry[];
  openTrades: Record<string, TradeEntry>;
  symbolPerformance: Record<string, SymbolPerformance>;
  strategyPerformance: Record<string, StrategyPerformance>;
  accountMetrics: AccountMetrics;
  priceHistory: Record<string, { price: number; timestamp: number }[]>;
}
```

### 💰 **Take Profit Manager - PositionProfitState**
```typescript
interface PositionProfitState {
  symbol: string;
  direction: 'long' | 'short';
  initialSize: number;      // Taille initiale de la position
  currentSize: number;      // Taille actuelle (après prises de profit partielles)
  entryPrice: number;
  triggeredTiers: number[]; // Niveaux 3-5-7 déjà déclenchés
  highWatermark: number;    // Prix le plus favorable atteint
  lastTakeProfit: number;   // Timestamp dernière prise de profit
}

// Configuration de la règle 3-5-7
interface TakeProfitConfig {
  enabled: boolean;
  profitTiers: [
    { profitPercentage: 3, closePercentage: 30 },  // 3% → fermer 30%
    { profitPercentage: 5, closePercentage: 30 },  // 5% → fermer 30%
    { profitPercentage: 7, closePercentage: 100 }  // 7% → fermer 40% restant
  ];
  cooldownPeriod: 300000;   // 5 minutes entre prises de profit
  trailingMode: boolean;
}
```

## ⚡ Mécanismes Automatiques

### 🎯 **Règle 3-5-7 Automatique**

```typescript
// Analyse continue des niveaux de profit
const analyzePositionForTakeProfit = (position, currentPrice) => {
  const profitPercentage = calculateProfitPercentage(position, currentPrice);
  
  // Parcourir les niveaux de profit (3%, 5%, 7%)
  for (let i = sortedTiers.length - 1; i >= 0; i--) {
    const tier = sortedTiers[i];
    
    // Vérifier si niveau éligible et non encore déclenché
    if (profitPercentage >= tier.profitPercentage && 
        !position.triggeredTiers.includes(i)) {
      
      const closeSize = position.currentSize * (tier.closePercentage / 100);
      
      return {
        shouldTakeProfit: true,
        triggerTier: i,
        orderSize: closeSize,
        orderSide: position.direction === "long" ? OrderSide.SELL : OrderSide.BUY,
        reason: `Niveau ${tier.profitPercentage}% atteint`
      };
    }
  }
};

// Exécution automatique
if (result.shouldTakeProfit) {
  const orderParams = {
    symbol: result.symbol,
    side: result.orderSide,
    type: OrderType.MARKET,
    size: result.orderSize,
    reduceOnly: true
  };
  
  const order = await tradingPort.placeOrder(orderParams);
  position.currentSize -= result.orderSize;
  position.triggeredTiers.push(result.triggerTier);
}
```

### 🛡️ **Fermeture Automatique des Positions Non Viables**

```typescript
// Détection et fermeture automatique
if (!analysis.isViable && analysis.shouldClose) {
  logger.warn(`Position ${symbol} non viable: ${analysis.reason}`);
  
  // Créer ordre de fermeture au marché
  const closeOrder = {
    symbol,
    side: position.direction === 'long' ? OrderSide.SELL : OrderSide.BUY,
    type: OrderType.MARKET,
    size: position.size,
    reduceOnly: true
  };
  
  const placedOrder = await tradingPort.placeOrder(closeOrder);
  
  // Mise à jour des acteurs
  delete state.positions[symbol];
  performanceTracker.recordTradeClosed(tradeEntry);
  takeProfitManager.positionClosed(symbol);
}
```

## 🔄 Intervalles de Surveillance

### ⏱️ **Fréquences Configurables**

```env
# Données de marché
POLL_INTERVAL=3000                    # 3 secondes - mise à jour prix

# Analyse des positions
POSITION_ANALYSIS_INTERVAL=300000     # 5 minutes - viabilité des positions

# Take Profit
TAKE_PROFIT_PRICE_CHECK=10000        # 10 secondes - vérification niveaux profit
TAKE_PROFIT_POSITION_CHECK=60000     # 1 minute - synchronisation positions
TAKE_PROFIT_COOLDOWN=300000          # 5 minutes - cooldown entre prises de profit

# Performance
PERFORMANCE_CALCULATION_INTERVAL=60000 # 1 minute - recalcul métriques
```

### 📡 **Coordination des Acteurs**

```typescript
// Take Profit Integrator - Coordination centrale
const takeProfitIntegrator = {
  // Surveillance continue des prix
  priceCheckInterval: setInterval(() => {
    for (const symbol of watchedSymbols) {
      const marketData = await getLatestMarketData(symbol);
      takeProfitManager.analyzePosition(symbol, marketData.price);
    }
  }, config.priceCheckInterval),
  
  // Synchronisation des positions
  positionCheckInterval: setInterval(() => {
    const accountRisk = await riskManager.getAccountRisk();
    
    // Mettre à jour positions ouvertes
    for (const position of accountRisk.positions) {
      takeProfitManager.positionUpdated(position);
    }
    
    // Détecter positions fermées
    const knownPositions = await takeProfitManager.getAllPositions();
    for (const symbol in knownPositions) {
      const isStillOpen = accountRisk.positions.some(p => p.symbol === symbol);
      if (!isStillOpen) {
        takeProfitManager.positionClosed(symbol);
      }
    }
  }, config.positionCheckInterval)
};
```

## 📊 Métriques de Suivi

### 📈 **Métriques par Position**

```typescript
// Risk Manager
- unrealizedPnl: number          // P&L non réalisé
- riskLevel: RiskLevel           // Niveau de risque
- holdingTime: number            // Temps de détention
- isViable: boolean              // Position viable ?

// Performance Tracker  
- pnl: number                    // P&L réalisé
- pnlPercent: number             // P&L en pourcentage
- duration: number               // Durée du trade
- fees: number                   // Frais de transaction

// Take Profit Manager
- triggeredTiers: number[]       // Niveaux déclenchés
- currentSize vs initialSize     // Évolution taille position
- highWatermark: number          // Prix le plus favorable
```

### 🎯 **Métriques Globales**

```typescript
// Account Metrics (Performance Tracker)
interface AccountMetrics {
  currentBalance: number;
  totalProfit: number;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  openPositions: number;
}

// Account Risk (Risk Manager)
interface AccountRisk {
  totalValue: number;
  availableBalance: number;
  totalRisk: number;
  leverageUsed: number;
  currentRiskLevel: RiskLevel;
  maxDrawdown: number;
}
```

## 🎯 Avantages du Système

### ✅ **Surveillance Exhaustive**
- **Temps réel** : Mise à jour continue des prix et P&L
- **Multi-niveaux** : Risk, Performance, Take Profit coordonnés
- **Automatisé** : Aucune intervention manuelle requise

### ✅ **Gestion du Risque**
- **Stop Loss automatique** : 2% par défaut
- **Analyse de viabilité** : Détection positions problématiques
- **Fermeture automatique** : Protection du capital

### ✅ **Optimisation des Profits**
- **Règle 3-5-7** : Prise de profit progressive et automatique
- **Trailing mode** : Suivi des prix favorables
- **Cooldown** : Éviter sur-trading

### ✅ **Monitoring Complet**
- **Historique détaillé** : Chaque trade archivé
- **Métriques temps réel** : Performance continue
- **Alertes automatiques** : Positions à risque

Ce système offre une **surveillance professionnelle et automatisée** garantissant la protection du capital tout en optimisant les opportunités de profit ! 🚀
