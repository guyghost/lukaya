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

Le bot utilise maintenant quatre stratégies avancées de détection des signaux faibles :

1. **RSI Divergence** : Détecte les divergences entre prix et RSI pour anticiper les retournements
2. **Volume Analysis** : Analyse les patterns de volume pour identifier les accumulations/distributions  
3. **Elliott Wave** : Identifie les structures de vagues pour prédire les mouvements
4. **Harmonic Pattern** : Reconnaît les patterns harmoniques basés sur Fibonacci

Configuration globale des paramètres de trading :

```
DEFAULT_POSITION_SIZE=0.015
RISK_PER_TRADE=0.01        # Pourcentage du capital à risquer par trade (1%)
STOP_LOSS_PERCENT=0.02     # Pourcentage de stop loss (2%)
DEFAULT_ACCOUNT_SIZE=10000 # Taille du compte en USD pour le calcul du risque
MAX_CAPITAL_PER_TRADE=0.25 # Pourcentage maximum du capital par trade (25%)
MAX_FUNDS_PER_ORDER=0.25   # Pourcentage maximum des fonds disponibles par ordre (25%)
MAX_SLIPPAGE_PERCENT=1.5   # Pourcentage maximal de slippage accepté
MIN_LIQUIDITY_RATIO=6.0    # Ratio minimum de liquidité par rapport à la taille de l'ordre
USE_LIMIT_ORDERS=false     # Utilisation des ordres au marché forcée (pour compatibilité dYdX)
LIMIT_ORDER_BUFFER=0.0005  # Buffer pour les ordres limite (0.05%) (non utilisé si USE_LIMIT_ORDERS=false)
```

### Autres paramètres

```
POLL_INTERVAL=3000 # Intervalle de mise à jour des données de marché (ms)
MAX_LEVERAGE=2.5 # Effet de levier maximum
POSITION_ANALYSIS_INTERVAL=180000 # Intervalle d'analyse des positions (3 minutes)
LOG_LEVEL="info" # Niveau de log (debug, info, warn, error)
LOG_TO_FILE="true" # Activer les logs dans un fichier
LOG_FILE_PATH="./logs/lukaya.log" # Chemin du fichier de logs
```

### Gestion des ordres

Par défaut, et pour une meilleure compatibilité avec dYdX, le bot utilise des **ordres au marché** (`USE_LIMIT_ORDERS=false`).
L'utilisation d'ordres limite est configurable via la variable d'environnement `USE_LIMIT_ORDERS=true`. Si activée :
- Les ordres d'achat seraient placés légèrement au-dessus du prix bid.
- Les ordres de vente seraient placés légèrement en-dessous du prix ask.
- Le `LIMIT_ORDER_BUFFER` déterminerait la distance.
- Les ordres pourraient être définis comme "postOnly" pour garantir l'ajout de liquidité (si supporté et configuré).

## Stratégies avancées de détection des signaux faibles

### RSI Divergence Strategy
Détecte les divergences entre le prix et l'indicateur RSI pour anticiper les retournements de marché.
- Analyse les divergences haussières et baissières
- Filtrage par niveaux de surachat/survente
- Confirmation par analyse de tendance

### Volume Analysis Strategy  
Monitore les patterns de volume pour identifier les signaux d'accumulation/distribution.
- Détection des pics de volume
- Analyse des moyennes mobiles de volume
- Corrélation volume/prix pour validation des signaux

### Elliott Wave Strategy
Identifie les structures de vagues d'Elliott pour prédire les mouvements de marché.
- Détection des vagues impulsives et correctives
- Analyse des ratios de Fibonacci
- Validation par momentum et volume

### Harmonic Pattern Strategy
Reconnaît les patterns harmoniques basés sur les ratios de Fibonacci.
- Détection des patterns Gartley, Butterfly, Bat
- Validation par confluence des niveaux
- Signaux haute probabilité aux zones de retournement

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

Le bot implémente la règle 3-5-7 pour gérer les prises de profit de manière structurée et disciplinée:

1. **Premier palier (3%)**: Fermeture de 30% de la position lorsque le profit atteint 3%
2. **Deuxième palier (5%)**: Fermeture de 30% supplémentaires lorsque le profit atteint 5%
3. **Troisième palier (7%)**: Fermeture du reste de la position lorsque le profit atteint 7%

Cette approche permet de:
- Sécuriser progressivement les gains
- Laisser courir une partie des profits
- Maximiser le ratio risque/récompense
- Maintenir une discipline de trading systématique

### Configuration de la règle 3-5-7

Les paramètres sont entièrement configurables via les variables d'environnement:

```
# Take profit rules (Règle 3-5-7)
TAKE_PROFIT_RULE_ENABLED=true
TAKE_PROFIT_LEVEL_1=3       # Premier niveau de profit (%)
TAKE_PROFIT_SIZE_1=30       # Pourcentage de la position à fermer au premier niveau
TAKE_PROFIT_LEVEL_2=5       # Deuxième niveau de profit (%)
TAKE_PROFIT_SIZE_2=30       # Pourcentage de la position à fermer au deuxième niveau
TAKE_PROFIT_LEVEL_3=7       # Troisième niveau de profit (%)
TAKE_PROFIT_SIZE_3=100      # Pourcentage de la position restante à fermer à ce niveau (assure la fermeture complète si les paliers précédents sont configurés pour ne pas fermer 100%)
TRAILING_MODE=false         # Activer/désactiver le trailing take profit (variable d'env: TRAILING_MODE)
TAKE_PROFIT_COOLDOWN=300000 # Délai entre les prises de profit (ms)
```

### Fonctionnement de la règle 3-5-7

1. **Activation automatique**: Le système surveille en continu toutes les positions ouvertes.
2. **Déclenchement des paliers**: Lorsqu'un niveau de profit est atteint, le système exécute automatiquement une prise de profit partielle.
3. **Suivi des niveaux**: Chaque niveau de profit n'est déclenché qu'une seule fois pour éviter les fermetures multiples.
4. **Mode trailing (optionnel)**: Lorsque activé, les niveaux de profit sont relatifs au prix le plus favorable atteint, permettant de protéger davantage les gains.
5. **Période de refroidissement**: Un délai configurable entre les prises de profit évite les transactions excessives en cas de volatilité.

### Avantages de la règle 3-5-7

- **Équilibre risque/récompense**: Le ratio risque/récompense est optimisé (avec un stop loss standard à 2%, le ratio est de 1:3.5).
- **Discipline de trading**: Élimination des biais émotionnels en automatisant les prises de profit.
- **Flexibilité**: Les paramètres peuvent être ajustés selon la volatilité du marché et votre tolérance au risque.
- **Maximisation des profits**: En laissant courir une partie de la position, vous pouvez capturer des mouvements de prix plus importants.

## Analyse de viabilité des positions

Le bot analyse régulièrement les positions ouvertes pour déterminer si elles sont toujours viables:

- **Vérification des stop-loss**: Clôture automatique des positions qui atteignent le seuil de stop-loss
- **Suivi des prises de bénéfices**: Recommandation de clôture lorsque le niveau de take-profit est atteint
- **Analyse du temps de détention**: Identification des positions maintenues trop longtemps sans profit
- **Détection d'inversion de tendance**: Recommandation de clôture lorsque le marché change de direction

L'analyse de viabilité est effectuée automatiquement toutes les 5 minutes (configurable via POSITION_ANALYSIS_INTERVAL).

### Fermeture automatique des positions non viables

Lorsqu'une position est identifiée comme non viable, le bot la ferme automatiquement:

1. Un ordre de fermeture au marché est créé pour garantir une exécution immédiate
2. L'ordre est marqué comme `reduceOnly` pour s'assurer qu'il ne fait que fermer la position existante
3. La transaction est enregistrée dans le suivi de performance avec le tag `non_viable`
4. Un message détaillé est inscrit dans les logs expliquant la raison de la fermeture

Cette fonctionnalité protège automatiquement votre capital contre les pertes excessives sans intervention manuelle.