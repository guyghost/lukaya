# 🤖 Lukaya Trading Bot - Architecture et Fonctionnement

## Vue d'ensemble
Lukaya est un bot de trading automatisé sophistiqué conçu pour le protocole dYdX v4, utilisant une **architecture par acteurs** et quatre stratégies avancées d'analyse technique pour détecter les signaux faibles du marché.

## 🏗️ Architecture Globale

```
┌─────────────────────────────────────────────────────────────────┐
│                        LUKAYA TRADING BOT                       │
├─────────────────────────────────────────────────────────────────┤
│                     COUCHE PRINCIPALE                           │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                 TRADING BOT SERVICE                     │    │
│  │            (Orchestrateur principal)                    │    │
│  └─────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│                    SYSTÈME D'ACTEURS                            │
│  ┌───────────────┐ ┌─────────────────┐ ┌──────────────────┐     │
│  │   MARKET      │ │   STRATEGY      │ │  PERFORMANCE     │     │
│  │   ACTORS      │ │   MANAGER       │ │   TRACKER        │     │
│  │               │ │                 │ │                  │     │
│  │ • BTC-USD     │ │ • Orchestration │ │ • P&L tracking   │     │
│  │ • ETH-USD     │ │ • Weight mgmt   │ │ • Metrics calc   │     │
│  │ • SOL-USD     │ │ • Signals agg   │ │ • Reporting      │     │
│  └───────────────┘ └─────────────────┘ └──────────────────┘     │
│                                                                 │
│  ┌───────────────┐ ┌─────────────────┐ ┌──────────────────┐     │
│  │   RISK        │ │  TAKE PROFIT    │ │   STRATEGY       │     │
│  │   MANAGER     │ │   MANAGER       │ │   ACTORS         │     │
│  │               │ │                 │ │                  │     │
│  │ • Position    │ │ • 3-5-7 Rule    │ │ • RSI Div        │     │
│  │   analysis    │ │ • Profit tiers  │ │ • Volume         │     │
│  │ • Stop loss   │ │ • Trailing SL   │ │ • Elliott Wave   │     │
│  │ • Leverage    │ │                 │ │ • Harmonic       │     │
│  └───────────────┘ └─────────────────┘ └──────────────────┘     │
├─────────────────────────────────────────────────────────────────┤
│                    STRATÉGIES DE TRADING                        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  RSI DIVERGENCE                         │    │
│  │  • Détecte divergences prix/RSI                         │    │
│  │  • Anticipe retournements de marché                     │    │
│  │  • Filtrage surachat/survente                           │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  VOLUME ANALYSIS                        │    │
│  │  • Détecte spikes de volume                             │    │
│  │  • Analyse accumulation/distribution                    │    │
│  │  • Corrélation volume/prix                              │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  ELLIOTT WAVE                           │    │
│  │  • Identifie structures de vagues                       │    │
│  │  • Prédiction mouvements impulsifs                      │    │
│  │  • Vagues 1,3,5 (hausse) et 2,4,A,B,C (correction)      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                 HARMONIC PATTERNS                       │    │
│  │  • Patterns Gartley, Butterfly, Bat, Crab               │    │
│  │  • Ratios de Fibonacci (0.618, 0.786, 1.272...)         │    │
│  │  • Zones de retournement haute probabilité              │    │
│  └─────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│                     COUCHE ADAPTATEURS                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    DYDX CLIENT                          │    │
│  │  • Connexion API dYdX v4                                │    │
│  │  • Market data en temps réel                            │    │
│  │  • Exécution d'ordres                                   │    │
│  │  • Gestion compte et positions                          │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## 🔄 Flux de Données et Exécution

### 1. Collecte des Données Marché
```
dYdX API → Market Actors → Strategy Manager → Strategy Actors
    ↓
Données temps réel (prix, volume, bid/ask)
```

### 2. Analyse Multi-Stratégies
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  RSI Divergence │    │ Volume Analysis │    │  Elliott Wave   │
│                 │    │                 │    │                 │
│ • RSI vs Prix   │    │ • Volume spikes │    │ • Wave counting │
│ • Divergences   │    │ • Delta volume  │    │ • Pivot points  │
│ • Survente/     │    │ • Moving avg    │    │ • Impulsive vs  │
│   Surachat      │    │   correlation   │    │   Corrective    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │   STRATEGY MANAGER      │
                    │                         │
                    │ • Agrège les signaux    │
                    │ • Pondération adaptée   │
                    │ • Résolution conflits   │
                    │ • Optimisation perf     │
                    └─────────────────────────┘
                                 │
                                 ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Harmonic Pattern│    │   RISK MANAGER  │    │ TAKE PROFIT MGR │
│                 │    │                 │    │                 │
│ • Gartley       │    │ • Taille ordre  │    │ • Règle 3-5-7   │
│ • Butterfly     │    │ • Stop loss     │    │ • Profit tiers  │
│ • Bat/Crab      │    │ • Leverage max  │    │ • Trailing stop │
│ • Fibonacci     │    │ • Viabilité pos │    │ • Exit partiel  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 3. Gestion du Risque
```
Signal → Risk Manager → Validation → Order Execution
  ↓           ↓              ↓            ↓
Analyse   Position      Ajustement   Suivi P&L
Marché    Sizing        Taille       Performance
```

### 4. Exécution et Suivi
```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   ORDER PLACED   │    │  POSITION OPEN   │    │  PROFIT TAKING   │
│                  │    │                  │    │                  │
│ • Market/Limit   │    │ • Entry tracking │    │ • 3% → 33% exit  │
│ • Size adjusted  │    │ • Risk monitoring│    │ • 5% → 50% exit  │
│ • Slippage mgmt  │    │ • Stop loss      │    │ • 7% → 100% exit │
└──────────────────┘    └──────────────────┘    └──────────────────┘
```

## 🎯 Stratégies en Détail

### 1. **RSI Divergence Strategy**
- **Principe** : Détecte quand le prix et le RSI évoluent en sens opposé
- **Signaux** :
  - 🟢 **Long** : Prix baisse + RSI monte (divergence haussière)
  - 🔴 **Short** : Prix monte + RSI baisse (divergence baissière)
- **Filtres** : RSI < 30 (survente) ou RSI > 70 (surachat)

### 2. **Volume Analysis Strategy**
- **Principe** : Analyse les anomalies de volume pour détecter l'intérêt institutionnel
- **Signaux** :
  - 🟢 **Long** : Volume spike + pression d'achat + tendance haussière
  - 🔴 **Short** : Volume spike + pression de vente + tendance baissière
- **Indicateurs** : Volume/MA ratio, Delta volume, Corrélation prix-volume

### 3. **Elliott Wave Strategy**
- **Principe** : Identifie les structures de vagues pour prédire les mouvements
- **Signaux** :
  - 🟢 **Long** : Début vagues impulsives 1, 3, 5
  - 🔴 **Short** : Début vagues correctives 2, 4, A, B, C
- **Méthode** : Détection de pivots + comptage de vagues

### 4. **Harmonic Pattern Strategy**
- **Principe** : Reconnaît les patterns géométriques basés sur Fibonacci
- **Patterns** :
  - **Gartley** : 0.618-0.382-1.272-0.786
  - **Butterfly** : 0.786-0.382-1.618-1.272
  - **Bat** : 0.382-0.886-2.618-0.886
  - **Crab** : 0.382-0.618-3.618-1.618
- **Signaux** : Aux points de completion (D) avec retournement attendu

## ⚙️ Configuration et Paramètres

### Variables d'environnement clés :
```bash
# Connexion dYdX
DYDX_MNEMONIC="phrase mnémonique"
DYDX_NETWORK="mainnet"

# Symboles tradés
DEFAULT_SYMBOLS="BTC-USD,ETH-USD,SOL-USD,LTC-USD"

# Gestion du risque
DEFAULT_POSITION_SIZE=0.015      # 1.5% du capital par trade
RISK_PER_TRADE=0.01             # 1% de risque max par trade  
STOP_LOSS_PERCENT=0.02          # 2% de stop loss
DEFAULT_ACCOUNT_SIZE=10000      # Taille compte en USD
MAX_CAPITAL_PER_TRADE=0.25      # 25% capital max par trade
```

## 📊 Performance et Monitoring

### Métriques suivies :
- **Win Rate** : Ratio trades gagnants/perdants
- **Profit Factor** : Profit moyen / Perte moyenne
- **Sharpe Ratio** : Rendement ajusté du risque
- **Max Drawdown** : Perte maximale depuis le pic
- **Holding Time** : Durée moyenne des positions

### Rapports générés :
- Performance par symbole
- Performance par stratégie
- Métriques de compte globales
- Historique des trades

## 🛡️ Gestion du Risque

### Protection multi-niveaux :
1. **Sizing dynamique** : Basé sur la volatilité et le capital
2. **Stop loss automatique** : 2% par défaut
3. **Limite de leverage** : 2x maximum
4. **Diversification** : Max 5 positions simultanées
5. **Take profit progressif** : Règle 3-5-7%

### Analyse de viabilité :
- Vérification continue des positions ouvertes
- Fermeture automatique des positions non viables
- Adaptation aux conditions de marché

## 🚀 Points Forts du Système

1. **Architecture resiliente** : Système d'acteurs avec supervision
2. **Multi-stratégies** : Diversification des approches d'analyse
3. **Gestion risque avancée** : Protection capital et optimisation
4. **Scalabilité** : Facilité d'ajout de nouvelles stratégies
5. **Monitoring complet** : Suivi performance en temps réel
6. **Adaptabilité** : Configuration flexible selon les marchés

Ce bot représente une approche professionnelle du trading algorithmique, combinant analyse technique sophistiquée et gestion rigoureuse du risque pour maximiser les performances tout en protégeant le capital.
