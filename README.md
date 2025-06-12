# Lukaya Trading Bot

Lukaya est un bot de trading automatisé avancé conçu pour le protocole dYdX v4, utilisant une architecture d'acteurs moderne et des stratégies d'analyse technique sophistiquées.

## 📚 Documentation Complète

Une documentation complète avec diagrammes détaillés est maintenant disponible :

- 🚀 **[Guide de Démarrage Rapide](docs/QUICK_START_GUIDE.md)** - Démarrez en moins de 10 minutes
- 📖 **[Documentation Complète](docs/DOCUMENTATION_COMPLETE.md)** - Guide exhaustif avec tous les détails
- 🏗️ **[Diagrammes d'Architecture](docs/diagrams/ARCHITECTURE_DIAGRAMS.md)** - Visualisation complète du système
- 📈 **[Flux de Trading](docs/diagrams/TRADING_FLOWS.md)** - Tous les processus de trading illustrés
- 📂 **[Index de la Documentation](docs/README.md)** - Navigation dans toute la documentation

## 🚀 Démarrage Rapide

```bash
# 1. Installation
bun install

# 2. Configuration
cp .env.example .env
# Éditez .env avec vos paramètres dYdX

# 3. Test (recommandé)
bun dev

# 4. Production
bun start
```

**⚡ Configuration Express** :

```env
DYDX_MNEMONIC="votre-phrase-mnémonique"
DYDX_NETWORK="testnet"  # puis "mainnet"
ACTIVE_STRATEGIES="coordinated-multi-strategy"
COORDINATED_OVERALL_CONFIDENCE_THRESHOLD=0.45
```

## Installation

```bash
# Installation des dépendances
npm install
# ou
bun install
```

## Configuration

Le bot se configure via des variables d'environnement (fichier `.env`):

### Configuration de base

```env
DYDX_MNEMONIC="votre phrase mnémonique"
DYDX_NETWORK="mainnet" # ou "testnet"
DYDX_SUBACCOUNT_NUMBER=0
```

### Configuration des symboles

Vous pouvez configurer plusieurs symboles de trading en les séparant par une virgule:

```env
DEFAULT_SYMBOLS="BTC-USD,ETH-USD,SOL-USD,LTC-USD,XRP-USD,RUNE-USD"
```

Le bot appliquera automatiquement les stratégies configurées à tous les symboles spécifiés.

### Configuration globale des paramètres de trading :

```env

### Configuration des stratégies

Le bot propose plusieurs stratégies de trading avancées :

#### Stratégies Individuelles :
1. **RSI Divergence** : Détecte les divergences entre prix et RSI pour anticiper les retournements
2. **Volume Analysis** : Analyse les patterns de volume pour identifier les accumulations/distributions
3. **Elliott Wave** : Identifie les structures de vagues pour prédire les mouvements
4. **Harmonic Pattern** : Reconnaît les patterns harmoniques basés sur Fibonacci
5. **Scalping Entry/Exit** : Stratégie de scalping rapide basée sur EMA et RSI

#### Stratégie Coordonnée (Recommandée) :
6. **Coordinated Multi-Strategy** : Combine intelligemment Elliott Wave → Harmonic Pattern → Volume Analysis → Scalping pour des signaux de haute qualité avec gestion de confiance et confluence

```

ACTIVE_STRATEGIES="coordinated-multi-strategy"

```

## Stratégies Disponibles

### 🎯 Stratégie Coordonnée (Recommandée)

La **Coordinated Multi-Strategy** est la stratégie la plus avancée du bot. Elle combine quatre approches d'analyse technique dans un pipeline séquentiel intelligent :

1. **Elliott Wave Analysis** → Identifie les structures de vagues et la direction du marché
2. **Harmonic Pattern Detection** → Recherche les patterns de retournement aux niveaux Fibonacci
3. **Volume Analysis** → Confirme les signaux avec l'analyse du volume
4. **Scalping Entry/Exit** → Optimise les points d'entrée et de sortie

**Avantages** :
- Signaux de haute qualité grâce à la confluence
- Gestion de la confiance multi-niveaux
- Adaptation aux différentes conditions de marché
- Réduction des faux signaux

**Configuration** :
```

ACTIVE_STRATEGIES="coordinated-multi-strategy"
COORDINATED_OVERALL_CONFIDENCE_THRESHOLD=0.45
COORDINATED_POSITION_SIZE=0.01

```

### 📊 Stratégies Individuelles

Les stratégies peuvent aussi être utilisées individuellement :

- **rsi-divergence** : Divergences RSI/prix
- **volume-analysis** : Analyse des spikes de volume
- **elliott-wave** : Détection des structures de vagues
- **harmonic-pattern** : Patterns harmoniques Fibonacci
- **scalping-entry-exit** : Scalping rapide EMA/RSI

```

DEFAULT_POSITION_SIZE=0.015
RISK_PER_TRADE=0.01 # Pourcentage du capital à risquer par trade (1%)
STOP_LOSS_PERCENT=0.02 # Pourcentage de stop loss (2%)
DEFAULT_ACCOUNT_SIZE=10000 # Taille du compte en USD pour le calcul du risque
MAX_CAPITAL_PER_TRADE=0.25 # Pourcentage maximum du capital par trade (25%)
MAX_FUNDS_PER_ORDER=0.25 # Pourcentage maximum des fonds disponibles par ordre (25%)
MAX_SLIPPAGE_PERCENT=1.5 # Pourcentage maximal de slippage accepté
MIN_LIQUIDITY_RATIO=6.0 # Ratio minimum de liquidité par rapport à la taille de l'ordre
USE_LIMIT_ORDERS=false # Utilisation des ordres au marché forcée (pour compatibilité dYdX)
LIMIT_ORDER_BUFFER=0.0005 # Buffer pour les ordres limite (0.05%) (non utilisé si USE_LIMIT_ORDERS=false)

````

### Autres paramètres

```env
POLL_INTERVAL=3000 # Intervalle de mise à jour des données de marché (ms)
MAX_LEVERAGE=2.5 # Effet de levier maximum
POSITION_ANALYSIS_INTERVAL=180000 # Intervalle d'analyse des positions (3 minutes)
LOG_LEVEL="debug" # Niveau de log (debug, info, warn, error)
LOG_TO_FILE="true" # Activer les logs dans un fichier
LOG_FILE_PATH="./logs/lukaya.log" # Chemin du fichier de logs
````

### Gestion des ordres

Par défaut, le bot utilise des **ordres au marché** (`USE_LIMIT_ORDERS=false`) pour une meilleure compatibilité avec dYdX et une exécution immédiate.

### Configuration de la Stratégie Coordonnée

La stratégie coordonnée dispose de nombreux paramètres configurables pour optimiser les performances :

```env
# Stratégie coordonnée multi-approches
COORDINATED_WAVE_DETECTION_LENGTH=80
COORDINATED_PRICE_SENSITIVITY=0.015
COORDINATED_DETECTION_LENGTH=150
COORDINATED_FIB_RETRACEMENT_TOLERANCE=0.03
COORDINATED_PATTERN_CONFIRMATION_PCT=65
COORDINATED_VOLUME_THRESHOLD=1.3
COORDINATED_VOLUME_MA_LENGTH=18
COORDINATED_PRICE_MA_LENGTH=12
COORDINATED_VOLUME_SPIKE_FACTOR=1.8
COORDINATED_FAST_EMA_PERIOD=20
COORDINATED_SLOW_EMA_PERIOD=50
COORDINATED_RSI_PERIOD=7
COORDINATED_MOMENTUM_PERIOD=10
COORDINATED_MAX_HOLDING_PERIOD=15
COORDINATED_PROFIT_TARGET_PERCENT=0.003
COORDINATED_STOP_LOSS_PERCENT=0.002
COORDINATED_RSI_OVERBOUGHT_LEVEL=70
COORDINATED_RSI_OVERSOLD_LEVEL=30
COORDINATED_MOMENTUM_THRESHOLD=0.002
COORDINATED_PRICE_DEVIATION_THRESHOLD=0.001

# Seuils de confiance (critiques pour la qualité des signaux)
COORDINATED_TREND_CONFIDENCE_THRESHOLD=0.35
COORDINATED_PATTERN_CONFIDENCE_THRESHOLD=0.3
COORDINATED_VOLUME_CONFIDENCE_THRESHOLD=0.25
COORDINATED_OVERALL_CONFIDENCE_THRESHOLD=0.45
COORDINATED_POSITION_SIZE=0.01
```

**Note importante** : Les seuils de confiance déterminent la qualité des signaux. Plus ils sont élevés, moins il y aura de signaux mais ils seront de meilleure qualité.

## Architecture et Performances

### Architecture d'Acteurs

Le bot utilise une architecture d'acteurs moderne qui offre :

- **Modularité** : Chaque composant (Risk Manager, Performance Tracker, Take Profit Manager) est un acteur indépendant
- **Résilience** : Les acteurs peuvent être redémarrés individuellement en cas d'erreur
- **Scalabilité** : Facilité d'ajout de nouvelles stratégies et fonctionnalités
- **Monitoring** : Suivi détaillé des performances en temps réel

### Gestion Centralisée du Risque

- `RiskManager` : Évalue chaque ordre selon les paramètres de risque configurés
- `OrderManager` : Gère le cycle de vie complet des ordres
- Protection automatique du capital avec stop-loss et analyse de viabilité

### Système de Take Profit Automatique (Règle 3-5-7)

Gestion automatisée des prises de profit avec trois niveaux :

- **3%** : Fermeture de 30% de la position
- **5%** : Fermeture de 30% supplémentaires
- **7%** : Fermeture du reste de la position

## Tests et Backtesting

Le projet inclut un système complet de tests et de backtesting :

```bash
# Exécuter tous les tests
bun test

# Exécuter uniquement les tests d'intégration
bun test:integration

# Exécuter les tests avec couverture
bun test:coverage
```

### Utilisation du backtesting

```bash
# Exécuter un backtest simple
bun run backtest run --strategy rsi-divergence --config src/backtest/examples/backtest-config.json

# Comparer plusieurs stratégies
bun run backtest compare --strategies rsi-divergence,volume-analysis,harmonic-pattern --config src/backtest/examples/backtest-config.json

# Optimiser les paramètres d'une stratégie
bun run backtest optimize --strategy elliott-wave --config src/backtest/examples/backtest-config.json --params src/backtest/examples/parameter-ranges.json

# Visualiser la liste des stratégies disponibles
bun run backtest list
```

## Lancement

```bash
# Démarrer le bot
bun start
```

## Fonctionnement

Le bot de trading:

1. Se connecte à dYdX avec vos identifiants
2. Charge les stratégies configurées pour chaque symbole
3. Surveille les marchés en temps réel
4. Calcule la taille de l'ordre en fonction du risque (% du capital / distance au stop loss)
5. Ajuste la taille des ordres proportionnellement au pouvoir d'achat disponible
6. Évalue la liquidité disponible sur le marché
7. Analyse régulièrement la viabilité des positions ouvertes
8. Ferme automatiquement les positions qui ne sont plus viables
9. Place des ordres au marché pour une exécution immédiate (ou des ordres limite si configuré)
10. Suit l'état des ordres et gère les remplissages partiels

## Gestion automatique des prises de profit (Règle 3-5-7)

Le bot implémente automatiquement la règle 3-5-7 pour optimiser les prises de profit :

1. **Premier palier (3%)** : Fermeture de 30% de la position
2. **Deuxième palier (5%)** : Fermeture de 30% supplémentaires
3. **Troisième palier (7%)** : Fermeture du reste de la position

### Configuration

```env
# Take profit rules (Règle 3-5-7)
TAKE_PROFIT_RULE_ENABLED=true
TAKE_PROFIT_LEVEL_1=3       # Premier niveau de profit (%)
TAKE_PROFIT_SIZE_1=30       # Pourcentage de la position à fermer
TAKE_PROFIT_LEVEL_2=5       # Deuxième niveau de profit (%)
TAKE_PROFIT_SIZE_2=30       # Pourcentage de la position à fermer
TAKE_PROFIT_LEVEL_3=7       # Troisième niveau de profit (%)
TAKE_PROFIT_SIZE_3=100      # Fermeture complète du reste
TAKE_PROFIT_TRAILING=false  # Mode trailing (optionnel)
TAKE_PROFIT_COOLDOWN=300000 # Délai entre prises de profit (5 min)
```

### Avantages

- **Sécurisation progressive** des gains
- **Ratio risque/récompense optimisé** (1:3.5 avec stop-loss 2%)
- **Discipline automatique** sans intervention manuelle
- **Flexibilité** : paramètres ajustables selon la volatilité

## Analyse de viabilité des positions

Le bot analyse automatiquement les positions ouvertes toutes les 3 minutes :

- **Vérification des stop-loss** : Clôture automatique si seuil atteint (2% par défaut)
- **Suivi des prises de bénéfices** : Application automatique de la règle 3-5-7
- **Détection d'inversion de tendance** : Fermeture si conditions défavorables
- **Analyse du temps de détention** : Identification des positions non rentables

**Protection automatique** : Les positions non viables sont fermées automatiquement avec des ordres `reduceOnly` pour protéger le capital.

## Lancement

```bash
# Démarrer le bot
bun start

# Mode développement avec logs détaillés
bun dev
```

## Monitoring et Logs

Le bot génère des logs détaillés pour suivre :

- ✅ Ouverture/fermeture des trades avec émojis (🚀💰📉)
- ✅ Performance par stratégie en temps réel
- ✅ PNL non réalisé des positions ouvertes
- ✅ Statistiques globales et métriques de risque
- ✅ Analyse de viabilité des positions

**Fichiers de logs** : `./logs/lukaya.log` (avec rotation automatique)

## Documentation Technique

- **`SCHEMA_ARCHITECTURE.md`** : Architecture détaillée du système
- **`SUIVI_POSITIONS_OUVERTES.md`** : Système de suivi des positions
- **`src/application/actors/performance-tracker/README.md`** : Documentation des logs de performance

---

**Lukaya** représente une approche professionnelle du trading algorithmique, combinant analyse technique sophistiquée et gestion rigoureuse du risque pour maximiser les performances tout en protégeant le capital. 🚀
