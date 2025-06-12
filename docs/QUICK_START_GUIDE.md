# 🚀 Guide de Démarrage Rapide - Lukaya Trading Bot

Ce guide vous permettra de démarrer rapidement avec Lukaya en moins de 10 minutes.

## 📋 Sommaire

1. [Prérequis](#prerequis)
2. [Installation Rapide](#installation-rapide)
3. [Configuration Minimale](#configuration-minimale)
4. [Premier Démarrage](#premier-demarrage)
5. [Commandes Essentielles](#commandes-essentielles)
6. [Surveillance du Bot](#surveillance)
7. [Dépannage Rapide](#depannage)

---

## 1. Prérequis {#prerequis}

### Configuration Système Minimale

```mermaid
graph LR
    subgraph "Requis"
        OS[OS: Linux/macOS/Windows]
        NODE[Node.js 18+ ou Bun 1.0+]
        RAM[RAM: 1GB minimum]
        NET[Internet: Stable]
    end

    subgraph "Compte dYdX"
        WALLET[Wallet avec USDC]
        MNEMONIC[Phrase mnémonique]
        NETWORK[Réseau: Testnet/Mainnet]
    end

    OS --> READY[Prêt à installer]
    NODE --> READY
    RAM --> READY
    NET --> READY
    WALLET --> READY
    MNEMONIC --> READY
    NETWORK --> READY

    style READY fill:#22C55E,stroke:#16A34A,color:#FFF
```

### Checklist Pré-Installation

- [ ] Bun ou Node.js installé
- [ ] Git installé
- [ ] Compte dYdX créé
- [ ] Phrase mnémonique sauvegardée
- [ ] Au moins 100 USDC sur le compte (mainnet)

---

## 2. Installation Rapide {#installation-rapide}

### Étapes d'Installation

```bash
# 1. Cloner le projet
git clone https://github.com/your-repo/lukaya.git
cd lukaya

# 2. Installer les dépendances
bun install
# ou avec npm: npm install

# 3. Copier la configuration
cp .env.example .env

# 4. Vérifier l'installation
bun test
```

### Diagramme d'Installation

```mermaid
flowchart TD
    START[Début] --> CLONE[git clone lukaya]
    CLONE --> CD[cd lukaya]
    CD --> INSTALL[bun install]
    INSTALL --> CONFIG[cp .env.example .env]
    CONFIG --> EDIT[Éditer .env]
    EDIT --> TEST[bun test]
    TEST --> SUCCESS{Tests OK?}
    SUCCESS -->|Oui| READY[✅ Prêt!]
    SUCCESS -->|Non| DEBUG[Vérifier erreurs]
    DEBUG --> INSTALL

    style START fill:#3B82F6,stroke:#2563EB,color:#FFF
    style READY fill:#22C55E,stroke:#16A34A,color:#FFF
    style DEBUG fill:#EF4444,stroke:#DC2626,color:#FFF
```

---

## 3. Configuration Minimale {#configuration-minimale}

### Fichier .env Essentiel

```env
# 🔐 OBLIGATOIRE - Connexion dYdX
DYDX_MNEMONIC="your twelve word mnemonic phrase goes here"
DYDX_NETWORK="testnet"  # ou "mainnet" pour production

# 📊 Configuration de Trading
DEFAULT_SYMBOLS="BTC-USD,ETH-USD"  # Symboles à trader
DEFAULT_POSITION_SIZE=0.01          # 1% du capital par trade
STOP_LOSS_PERCENT=0.02              # Stop loss à 2%

# 🎯 Stratégie (Recommandé: coordinated)
STRATEGY="coordinated"              # Utilise toutes les stratégies

# 💰 Capital et Risque
DEFAULT_ACCOUNT_SIZE=1000           # Capital en USD
RISK_PER_TRADE=0.01                 # 1% de risque max
```

### Configuration Rapide par Profil

```mermaid
graph TD
    PROFILE{Choisir Profil}

    subgraph "Conservateur"
        C1[Position: 0.5%]
        C2[Stop Loss: 1%]
        C3[Leverage: 1x]
        C4[Symboles: BTC-USD]
    end

    subgraph "Modéré"
        M1[Position: 1%]
        M2[Stop Loss: 2%]
        M3[Leverage: 1.5x]
        M4[Symboles: BTC,ETH]
    end

    subgraph "Agressif"
        A1[Position: 2%]
        A2[Stop Loss: 3%]
        A3[Leverage: 2x]
        A4[Symboles: BTC,ETH,SOL]
    end

    PROFILE -->|Débutant| C1
    PROFILE -->|Expérimenté| M1
    PROFILE -->|Expert| A1

    style C1 fill:#22C55E,stroke:#16A34A,color:#FFF
    style M1 fill:#F59E0B,stroke:#D97706,color:#FFF
    style A1 fill:#EF4444,stroke:#DC2626,color:#FFF
```

---

## 4. Premier Démarrage {#premier-demarrage}

### Commandes de Démarrage

```bash
# 1. Vérifier la connexion
bun run src/examples/check-connection.ts

# 2. Démarrer en mode développement (recommandé pour débuter)
bun dev

# 3. Démarrer en production
bun start
```

### Flux de Démarrage

```mermaid
sequenceDiagram
    participant User
    participant Bot
    participant dYdX
    participant Market

    User->>Bot: bun start
    Bot->>Bot: Load Configuration
    Bot->>Bot: Initialize Actors
    Bot->>dYdX: Connect WebSocket
    dYdX-->>Bot: Connection OK
    Bot->>dYdX: Authenticate
    dYdX-->>Bot: Auth Success
    Bot->>Market: Subscribe to Symbols
    Market-->>Bot: Start Data Stream
    Bot->>User: 🚀 Bot Started Successfully!

    loop Trading Loop
        Market-->>Bot: Price Update
        Bot->>Bot: Analyze Strategies
        Bot->>Bot: Generate Signals
        Bot->>dYdX: Execute Trades
    end
```

### Logs de Démarrage Normal

```
🚀 Starting Lukaya Trading Bot v1.0.0
📡 Connecting to dYdX testnet...
✅ Connected successfully
🔐 Authenticating...
✅ Authentication successful
💰 Account balance: $1,000.00 USDC
📊 Subscribing to BTC-USD, ETH-USD
🎯 Strategy: Coordinated Multi-Strategy
✅ All systems operational
🤖 Bot is now trading!
```

---

## 5. Commandes Essentielles {#commandes-essentielles}

### Tableau des Commandes

| Commande | Description | Utilisation |
|----------|-------------|-------------|
| `bun dev` | Mode développement | Tests et debug |
| `bun start` | Mode production | Trading réel |
| `bun test` | Lancer les tests | Vérification |
| `bun run backtest` | Backtesting | Test stratégies |
| `bun test:quick` | Tests rapides | Validation rapide |

### Workflow de Développement

```mermaid
graph LR
    DEV[bun dev] --> TEST[bun test]
    TEST --> BACKTEST[bun backtest]
    BACKTEST --> OPTIMIZE[Optimiser params]
    OPTIMIZE --> PROD[bun start]

    TEST -->|Échec| FIX[Corriger code]
    FIX --> TEST

    BACKTEST -->|Mauvais résultats| ADJUST[Ajuster stratégie]
    ADJUST --> BACKTEST

    style DEV fill:#3B82F6,stroke:#2563EB,color:#FFF
    style PROD fill:#22C55E,stroke:#16A34A,color:#FFF
```

---

## 6. Surveillance du Bot {#surveillance}

### Dashboard en Console

```
┌─────────────────────────────────────────────────┐
│           LUKAYA TRADING BOT - LIVE             │
├─────────────────────────────────────────────────┤
│ Status: 🟢 RUNNING | Uptime: 2h 34m 12s        │
├─────────────────────────────────────────────────┤
│ Account Balance: $1,054.32 (+5.43%)             │
│ Open Positions: 2/5                             │
├─────────────────────────────────────────────────┤
│ Today's P&L: +$54.32 (+5.43%)                  │
│ Win Rate: 68% (17W / 8L)                        │
├─────────────────────────────────────────────────┤
│ Active Positions:                               │
│ • BTC-USD LONG +2.34% (TP1 hit)                │
│ • ETH-USD LONG +0.87%                          │
├─────────────────────────────────────────────────┤
│ Recent Signals:                                 │
│ • 14:32 RSI Divergence on SOL-USD (Rejected)   │
│ • 14:28 Volume Spike on ETH-USD (Executed)     │
│ • 14:15 Harmonic Pattern on BTC-USD (Executed) │
└─────────────────────────────────────────────────┘
```

### Indicateurs Clés à Surveiller

```mermaid
graph TD
    subgraph "Santé du Système"
        CPU[CPU < 80%]
        MEM[RAM < 1GB]
        CONN[WebSocket Connected]
    end

    subgraph "Performance Trading"
        WINRATE[Win Rate > 50%]
        PROFIT[Profit Factor > 1.5]
        DD[Drawdown < 10%]
    end

    subgraph "Gestion du Risque"
        POS[Positions < 5]
        RISK[Risque < 2%/trade]
        BAL[Balance > Min]
    end

    STATUS{Bot Status}

    CPU --> STATUS
    MEM --> STATUS
    CONN --> STATUS
    WINRATE --> STATUS
    PROFIT --> STATUS
    DD --> STATUS
    POS --> STATUS
    RISK --> STATUS
    BAL --> STATUS

    STATUS -->|Tout OK| HEALTHY[🟢 Sain]
    STATUS -->|Warnings| WARNING[🟡 Attention]
    STATUS -->|Critique| CRITICAL[🔴 Critique]

    style HEALTHY fill:#22C55E,stroke:#16A34A,color:#FFF
    style WARNING fill:#F59E0B,stroke:#D97706,color:#FFF
    style CRITICAL fill:#EF4444,stroke:#DC2626,color:#FFF
```

### Fichiers de Logs

```bash
# Logs principaux
tail -f logs/lukaya.log

# Filtrer par niveau
grep "ERROR" logs/lukaya.log
grep "TRADE" logs/lukaya.log
grep "PROFIT" logs/lukaya.log

# Suivre les performances
grep "METRICS" logs/lukaya.log | tail -20
```

---

## 7. Dépannage Rapide {#depannage}

### Problèmes Fréquents et Solutions

```mermaid
flowchart TD
    PROBLEM{Problème?}

    P1[Connexion échoue]
    P2[Pas de trades]
    P3[Erreurs fréquentes]
    P4[Performance faible]

    S1[Vérifier .env et réseau]
    S2[Vérifier capital et config]
    S3[Voir logs d'erreur]
    S4[Ajuster paramètres]

    PROBLEM --> P1 --> S1
    PROBLEM --> P2 --> S2
    PROBLEM --> P3 --> S3
    PROBLEM --> P4 --> S4

    S1 --> RETRY[Redémarrer bot]
    S2 --> RETRY
    S3 --> FIX[Corriger config]
    S4 --> BACKTEST[Tester stratégie]

    style P1 fill:#EF4444,stroke:#DC2626,color:#FFF
    style P2 fill:#F59E0B,stroke:#D97706,color:#FFF
    style P3 fill:#EF4444,stroke:#DC2626,color:#FFF
    style P4 fill:#F59E0B,stroke:#D97706,color:#FFF
```

### Commandes de Diagnostic

```bash
# Vérifier la connexion
bun run src/examples/check-connection.ts

# Tester une stratégie spécifique
STRATEGY=rsi bun dev

# Mode debug verbose
DEBUG=* bun dev

# Nettoyer et réinstaller
rm -rf node_modules bun.lockb
bun install
```

### Messages d'Erreur Courants

| Erreur | Cause | Solution |
|--------|-------|----------|
| `ECONNREFUSED` | Pas de connexion | Vérifier internet/firewall |
| `Invalid mnemonic` | Mauvaise phrase | Vérifier .env |
| `Insufficient balance` | Pas assez d'USDC | Ajouter des fonds |
| `Rate limit exceeded` | Trop de requêtes | Attendre 60s |

---

## 🎉 Prochaines Étapes

### Une fois le bot démarré avec succès :

1. **Observer** : Laissez tourner 1-2 heures en mode dev
2. **Analyser** : Consultez les logs et métriques
3. **Optimiser** : Ajustez les paramètres si nécessaire
4. **Backtester** : Testez sur données historiques
5. **Production** : Passez en mainnet quand prêt

### Ressources Utiles

- 📚 [Documentation Complète](./DOCUMENTATION_COMPLETE.md)
- 🏗️ [Architecture Détaillée](./diagrams/ARCHITECTURE_DIAGRAMS.md)
- 📈 [Guide des Stratégies](./STRATEGIES_GUIDE.md)
- 🛡️ [Gestion du Risque](./RISK_MANAGEMENT.md)

---

## 📞 Support

Si vous rencontrez des problèmes :

1. Consultez les [logs détaillés](#surveillance)
2. Vérifiez la [FAQ](./FAQ.md)
3. Ouvrez une issue sur GitHub
4. Rejoignez notre Discord

---

**Bon trading avec Lukaya ! 🚀**

*Ce guide est conçu pour un démarrage rapide. Pour une utilisation avancée, consultez la documentation complète.*
