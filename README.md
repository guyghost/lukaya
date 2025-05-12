# Lukaya Trading Bot

Lukaya est un bot de trading automatisé conçu pour fonctionner avec le protocole dYdX v4.

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

```
DYDX_MNEMONIC="votre phrase mnémonique"
DYDX_NETWORK="mainnet" # ou "testnet"
DYDX_SUBACCOUNT_NUMBER=0
```

### Configuration des symboles

Vous pouvez configurer plusieurs symboles de trading en les séparant par une virgule:

```
DEFAULT_SYMBOLS="BTC-USD,ETH-USD,SOL-USD,LTC-USD"
```

Le bot appliquera automatiquement les stratégies configurées à tous les symboles spécifiés.

### Configuration des stratégies

Paramètres pour la stratégie de moyennes mobiles:

```
MA_SHORT_PERIOD=10
MA_LONG_PERIOD=30
DEFAULT_POSITION_SIZE=0.01
MAX_SLIPPAGE_PERCENT=1.0   # Pourcentage maximal de slippage accepté
MIN_LIQUIDITY_RATIO=10.0   # Ratio minimum de liquidité par rapport à la taille de l'ordre
RISK_PER_TRADE=0.01        # Pourcentage du capital à risquer par trade (1%)
STOP_LOSS_PERCENT=0.02     # Pourcentage de stop loss (2%)
DEFAULT_ACCOUNT_SIZE=10000 # Taille du compte en USD pour le calcul du risque
MAX_CAPITAL_PER_TRADE=0.25 # Pourcentage maximum du capital par trade (25%)
MAX_FUNDS_PER_ORDER=0.25   # Pourcentage maximum des fonds disponibles par ordre (25%)
```

### Autres paramètres

```
POLL_INTERVAL=5000 # Intervalle de mise à jour des données de marché (ms)
MAX_LEVERAGE=2 # Effet de levier maximum
POSITION_ANALYSIS_INTERVAL=300000 # Intervalle d'analyse des positions (5 minutes)
LOG_LEVEL="info" # Niveau de log (debug, info, warn, error)
LOG_TO_FILE="true" # Activer les logs dans un fichier
LOG_FILE_PATH="./logs/lukaya.log" # Chemin du fichier de logs
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
8. Place des ordres lorsqu'un signal est détecté et que toutes les conditions sont remplies

## Stratégies disponibles

### Simple Moving Average (SMA)

Stratégie basée sur le croisement de deux moyennes mobiles:
- Une période courte (par défaut: 10)
- Une période longue (par défaut: 30)

Signaux:
- Achat: lorsque la moyenne courte croise au-dessus de la moyenne longue
- Vente: lorsque la moyenne courte croise en-dessous de la moyenne longue

Gestion du risque et de la liquidité:
- Pour chaque signal d'entrée, le bot calcule la taille de position optimale:
  - Montant à risquer = Taille du compte × RISK_PER_TRADE
  - Distance au stop loss = Prix d'entrée × STOP_LOSS_PERCENT
  - Taille de position = Montant à risquer / Distance au stop loss
  - Limitation à MAX_CAPITAL_PER_TRADE du capital total
  - Limitation à MAX_FUNDS_PER_ORDER des fonds disponibles
- Le bot vérifie le slippage actuel du marché et le compare avec MAX_SLIPPAGE_PERCENT
- Il évalue la liquidité disponible par rapport à MIN_LIQUIDITY_RATIO
- Si la liquidité est insuffisante, la taille de l'ordre est réduite
- Si la liquidité est trop faible (moins de 10% de la taille calculée), l'ordre n'est pas exécuté

## Analyse de viabilité des positions

Le bot analyse régulièrement les positions ouvertes pour déterminer si elles sont toujours viables:

- **Vérification des stop-loss**: Clôture automatique des positions qui atteignent le seuil de stop-loss
- **Suivi des prises de bénéfices**: Recommandation de clôture lorsque le niveau de take-profit est atteint
- **Analyse du temps de détention**: Identification des positions maintenues trop longtemps sans profit
- **Détection d'inversion de tendance**: Recommandation de clôture lorsque le marché change de direction

L'analyse de viabilité est effectuée automatiquement toutes les 5 minutes (configurable via POSITION_ANALYSIS_INTERVAL).