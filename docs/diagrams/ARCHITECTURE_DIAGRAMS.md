# 🏗️ Diagrammes d'Architecture - Lukaya Trading Bot

Ce document contient tous les diagrammes d'architecture détaillés du système Lukaya.

## Table des Matières

1. [Vue d'Ensemble du Système](#vue-densemble)
2. [Architecture des Composants](#architecture-composants)
3. [Flux de Données](#flux-donnees)
4. [Système d'Acteurs](#systeme-acteurs)
5. [Stratégies de Trading](#strategies-trading)
6. [Gestion du Risque](#gestion-risque)
7. [Cycle de Vie des Positions](#cycle-vie-positions)
8. [Architecture de Déploiement](#architecture-deploiement)

---

## 1. Vue d'Ensemble du Système {#vue-densemble}

### Diagramme de Contexte Système (C4 Level 1)

```mermaid
graph TB
    subgraph "Utilisateurs"
        TRADER["👤 Trader<br/>(Configure et monitore)"]
        ADMIN["👨‍💼 Admin<br/>(Déploie et maintient)"]
    end

    subgraph "Système Lukaya"
        LUKAYA["🤖 Lukaya Trading Bot<br/>[Software System]<br/><br/>Bot de trading algorithmique<br/>multi-stratégies pour dYdX v4"]
    end

    subgraph "Systèmes Externes"
        DYDX["🏦 dYdX v4 Protocol<br/>[External System]<br/><br/>DEX perpétuels décentralisé"]
        MARKET["📊 Market Data<br/>[External System]<br/><br/>Flux de données temps réel"]
        LOGS["📝 Log Aggregator<br/>[External System]<br/><br/>ELK/Datadog (optionnel)"]
    end

    TRADER -->|"Configure stratégies<br/>Monitore performance"| LUKAYA
    ADMIN -->|"Déploie<br/>Maintient"| LUKAYA

    LUKAYA -->|"Place orders<br/>Manage positions"| DYDX
    DYDX -->|"Order status<br/>Account info"| LUKAYA

    MARKET -->|"Price feeds<br/>Volume data"| LUKAYA
    LUKAYA -->|"Logs<br/>Metrics"| LOGS

    style LUKAYA fill:#2E86AB,stroke:#1A5278,color:#FFF
    style DYDX fill:#F24236,stroke:#B91C10,color:#FFF
    style MARKET fill:#F6AE2D,stroke:#C48919,color:#000
    style LOGS fill:#2F4858,stroke:#1B2A36,color:#FFF
```

### Diagramme de Conteneurs (C4 Level 2)

```mermaid
graph TB
    subgraph "Lukaya Trading System"
        subgraph "Application Layer"
            MAIN["🎯 Main Service<br/>[TypeScript/Bun]<br/><br/>Orchestrateur principal<br/>et point d'entrée"]

            ACTORS["🎭 Actor System<br/>[TypeScript]<br/><br/>Gestion des acteurs<br/>et communication"]
        end

        subgraph "Domain Layer"
            STRATEGIES["📊 Strategy Engine<br/>[TypeScript]<br/><br/>RSI, Volume, Elliott,<br/>Harmonic, Coordinated"]

            RISK["🛡️ Risk Manager<br/>[TypeScript]<br/><br/>Validation des trades<br/>et gestion du risque"]

            PROFIT["💰 Take Profit Manager<br/>[TypeScript]<br/><br/>Gestion des sorties<br/>progressives 3-5-7%"]
        end

        subgraph "Infrastructure Layer"
            CLIENT["🔌 dYdX Client<br/>[TypeScript]<br/><br/>Wrapper API dYdX v4<br/>avec rate limiting"]

            LOGGER["📝 Logger Service<br/>[TypeScript]<br/><br/>Logs structurés<br/>avec emojis"]

            PERF["📈 Performance Tracker<br/>[TypeScript]<br/><br/>Métriques et<br/>reporting"]
        end

        subgraph "Storage"
            LOGS[("📁 Log Files<br/>[File System]<br/><br/>lukaya.log")]
            STATE[("💾 State Store<br/>[In-Memory]<br/><br/>Positions & Orders")]
        end
    end

    MAIN --> ACTORS
    ACTORS --> STRATEGIES
    ACTORS --> RISK
    ACTORS --> PROFIT
    ACTORS --> PERF

    STRATEGIES --> CLIENT
    RISK --> CLIENT
    PROFIT --> CLIENT

    CLIENT --> DYDX_API["🏦 dYdX API"]

    LOGGER --> LOGS
    PERF --> STATE

    style MAIN fill:#2E86AB,stroke:#1A5278,color:#FFF
    style ACTORS fill:#A23B72,stroke:#6B264B,color:#FFF
    style STRATEGIES fill:#F18F01,stroke:#B86C01,color:#FFF
    style RISK fill:#C73E1D,stroke:#852915,color:#FFF
```

---

## 2. Architecture des Composants {#architecture-composants}

### Diagramme des Composants Principaux

```mermaid
graph TB
    subgraph "Trading Bot Core"
        TBS["TradingBotService<br/><<component>>"]
        AS["ActorSystem<br/><<component>>"]

        TBS -->|uses| AS
    end

    subgraph "Actor Components"
        MA["MarketActor<br/><<component>>"]
        SM["StrategyManager<br/><<component>>"]
        RM["RiskManager<br/><<component>>"]
        TPM["TakeProfitManager<br/><<component>>"]
        PT["PerformanceTracker<br/><<component>>"]

        AS -->|creates| MA
        AS -->|creates| SM
        AS -->|creates| RM
        AS -->|creates| TPM
        AS -->|creates| PT
    end

    subgraph "Strategy Components"
        RSI["RSIDivergence<br/><<component>>"]
        VOL["VolumeAnalysis<br/><<component>>"]
        EW["ElliottWave<br/><<component>>"]
        HP["HarmonicPattern<br/><<component>>"]
        CS["CoordinatedStrategy<br/><<component>>"]

        SM -->|manages| RSI
        SM -->|manages| VOL
        SM -->|manages| EW
        SM -->|manages| HP
        SM -->|manages| CS
    end

    subgraph "Infrastructure Components"
        DC["DydxClient<br/><<component>>"]
        WS["WebSocketService<br/><<component>>"]
        LOG["LoggerService<br/><<component>>"]

        MA -->|uses| DC
        RM -->|uses| DC
        TPM -->|uses| DC
        DC -->|uses| WS
    end

    style TBS fill:#4A90E2,stroke:#357ABD,color:#FFF
    style AS fill:#7B68EE,stroke:#5A4FCF,color:#FFF
    style SM fill:#FF6B6B,stroke:#FF5252,color:#FFF
    style RM fill:#48BB78,stroke:#38A169,color:#FFF
```

---

## 3. Flux de Données {#flux-donnees}

### Diagramme de Flux Principal

```mermaid
flowchart TB
    subgraph "Data Sources"
        MD["📊 Market Data<br/>(Prix, Volume)"]
        AD["💼 Account Data<br/>(Balance, Positions)"]
    end

    subgraph "Data Processing"
        subgraph "Market Analysis"
            MA1["Parse & Validate"]
            MA2["Calculate Indicators"]
            MA3["Detect Patterns"]
        end

        subgraph "Signal Generation"
            SG1["Strategy Analysis"]
            SG2["Signal Aggregation"]
            SG3["Confidence Scoring"]
        end

        subgraph "Risk Assessment"
            RA1["Position Sizing"]
            RA2["Risk Validation"]
            RA3["Order Preparation"]
        end
    end

    subgraph "Actions"
        EO["📤 Execute Order"]
        RP["📊 Report Metrics"]
        UL["📝 Update Logs"]
    end

    MD --> MA1
    AD --> MA1
    MA1 --> MA2
    MA2 --> MA3
    MA3 --> SG1

    SG1 --> SG2
    SG2 --> SG3
    SG3 --> RA1

    RA1 --> RA2
    RA2 --> RA3

    RA3 --> EO
    RA3 --> RP
    RA3 --> UL

    style MD fill:#FFE66D,stroke:#FFC300,color:#000
    style AD fill:#A8DADC,stroke:#457B9D,color:#000
    style EO fill:#E63946,stroke:#C1121F,color:#FFF
```

### Séquence de Trading Complète

```mermaid
sequenceDiagram
    participant Market as Market Data
    participant MA as Market Actor
    participant SM as Strategy Manager
    participant Strats as Strategies[4]
    participant RM as Risk Manager
    participant TPM as Take Profit Mgr
    participant Client as dYdX Client
    participant PT as Perf Tracker

    Market->>MA: Price Update
    MA->>MA: Validate Data
    MA->>SM: Broadcast Update

    SM->>Strats: Analyze Market

    par RSI Analysis
        Strats->>Strats: Calculate RSI
        Strats->>Strats: Detect Divergence
    and Volume Analysis
        Strats->>Strats: Analyze Volume
        Strats->>Strats: Check Anomalies
    and Elliott Wave
        Strats->>Strats: Count Waves
        Strats->>Strats: Identify Pattern
    and Harmonic
        Strats->>Strats: Detect Patterns
        Strats->>Strats: Validate Fibonacci
    end

    Strats->>SM: Return Signals
    SM->>SM: Aggregate Signals
    SM->>SM: Calculate Confidence

    alt Strong Signal (>0.6)
        SM->>RM: Request Trade
        RM->>RM: Check Risk Rules
        RM->>RM: Calculate Size

        alt Risk Approved
            RM->>Client: Place Order
            Client->>Client: Execute Trade
            Client->>TPM: Position Opened
            Client->>PT: Log Trade

            TPM->>TPM: Monitor Position

            loop Every Tick
                Market->>TPM: Price Update
                TPM->>TPM: Check Profit %

                alt Profit >= 3%
                    TPM->>Client: Partial Exit 33%
                else Profit >= 5%
                    TPM->>Client: Partial Exit 50%
                else Profit >= 7%
                    TPM->>Client: Full Exit
                end
            end

        else Risk Rejected
            RM->>PT: Log Rejection
            RM->>SM: Notify Rejection
        end
    end
```

---

## 4. Système d'Acteurs {#systeme-acteurs}

### Hiérarchie des Acteurs

```mermaid
graph TD
    AS["ActorSystem<br/>(Root Supervisor)"]

    AS -->|supervises| MA["MarketActor<br/>(BTC-USD)"]
    AS -->|supervises| MA2["MarketActor<br/>(ETH-USD)"]
    AS -->|supervises| MA3["MarketActor<br/>(SOL-USD)"]

    AS -->|supervises| SM["StrategyManager"]

    SM -->|supervises| RSI["RSI Actor"]
    SM -->|supervises| VOL["Volume Actor"]
    SM -->|supervises| EW["Elliott Actor"]
    SM -->|supervises| HP["Harmonic Actor"]

    AS -->|supervises| RM["RiskManager"]
    AS -->|supervises| TPM["TakeProfitManager"]
    AS -->|supervises| PT["PerformanceTracker"]

    style AS fill:#FF6B6B,stroke:#FF5252,color:#FFF
    style SM fill:#4ECDC4,stroke:#3DBBB3,color:#FFF
    style RM fill:#95E1D3,stroke:#7DD3C5,color:#000
```

### Communication Inter-Acteurs

```mermaid
graph LR
    subgraph "Market Layer"
        MA1["BTC Actor"]
        MA2["ETH Actor"]
    end

    subgraph "Strategy Layer"
        SM["Strategy<br/>Manager"]
        S1["RSI"]
        S2["Volume"]
        S3["Elliott"]
        S4["Harmonic"]
    end

    subgraph "Execution Layer"
        RM["Risk<br/>Manager"]
        TPM["TakeProfit<br/>Manager"]
    end

    subgraph "Monitoring"
        PT["Performance<br/>Tracker"]
    end

    MA1 -->|MarketUpdate| SM
    MA2 -->|MarketUpdate| SM

    SM -->|AnalyzeRequest| S1
    SM -->|AnalyzeRequest| S2
    SM -->|AnalyzeRequest| S3
    SM -->|AnalyzeRequest| S4

    S1 -->|Signal| RM
    S2 -->|Signal| RM
    S3 -->|Signal| RM
    S4 -->|Signal| RM

    RM -->|Approved| TPM
    RM -->|Metrics| PT
    TPM -->|Updates| PT

    style SM fill:#6C5CE7,stroke:#5F4DD3,color:#FFF
    style RM fill:#00B894,stroke:#00A885,color:#FFF
```

---

## 5. Stratégies de Trading {#strategies-trading}

### Architecture des Stratégies

```mermaid
classDiagram
    class Strategy {
        <<interface>>
        +name: string
        +analyze(data: MarketData): Signal
        +getParameters(): StrategyParams
        +updatePerformance(result: TradeResult): void
    }

    class RSIDivergenceStrategy {
        -rsiPeriod: number
        -oversoldLevel: number
        -overboughtLevel: number
        +detectDivergence(): boolean
        +calculateRSI(): number
    }

    class VolumeAnalysisStrategy {
        -volumeThreshold: number
        -maLength: number
        +analyzeVolumeSpike(): boolean
        +calculateDelta(): number
    }

    class ElliottWaveStrategy {
        -waveCount: number
        -pivotStrength: number
        +identifyWaves(): WavePattern
        +predictNextMove(): Direction
    }

    class HarmonicPatternStrategy {
        -patterns: PatternType[]
        -tolerance: number
        +detectPattern(): Pattern
        +validateFibonacci(): boolean
    }

    class CoordinatedStrategy {
        -strategies: Strategy[]
        -weights: Map<string, number>
        +aggregateSignals(): Signal
        +adjustWeights(): void
    }

    Strategy <|.. RSIDivergenceStrategy
    Strategy <|.. VolumeAnalysisStrategy
    Strategy <|.. ElliottWaveStrategy
    Strategy <|.. HarmonicPatternStrategy
    Strategy <|.. CoordinatedStrategy

    CoordinatedStrategy o-- Strategy : uses multiple
```

### Flux de Décision Stratégie Coordonnée

```mermaid
flowchart TD
    START["🎯 Market Update"]

    subgraph "Parallel Analysis"
        RSI["RSI Divergence<br/>Weight: 0.25"]
        VOL["Volume Analysis<br/>Weight: 0.25"]
        EW["Elliott Wave<br/>Weight: 0.25"]
        HP["Harmonic Pattern<br/>Weight: 0.25"]
    end

    AGG["Signal Aggregator"]
    CALC["Calculate Weighted Score"]

    PERF["Historical Performance"]
    ADJ["Adjust Weights<br/>(Performance-based)"]

    DEC1{Score > 0.6?}
    DEC2{Score > 0.4?}

    STRONG["💪 Strong Signal<br/>High Confidence"]
    MEDIUM["📊 Medium Signal<br/>Normal Confidence"]
    WEAK["🔍 Weak Signal<br/>Low Confidence"]
    NONE["❌ No Signal"]

    START --> RSI
    START --> VOL
    START --> EW
    START --> HP

    RSI --> AGG
    VOL --> AGG
    EW --> AGG
    HP --> AGG

    AGG --> CALC
    PERF --> ADJ
    ADJ --> CALC

    CALC --> DEC1
    DEC1 -->|Yes| STRONG
    DEC1 -->|No| DEC2
    DEC2 -->|Yes| MEDIUM
    DEC2 -->|No| WEAK

    WEAK --> NONE

    style START fill:#FF6B6B,stroke:#FF5252,color:#FFF
    style STRONG fill:#48BB78,stroke:#38A169,color:#FFF
    style MEDIUM fill:#ECC94B,stroke:#D69E2E,color:#000
    style NONE fill:#E53E3E,stroke:#C53030,color:#FFF
```

---

## 6. Gestion du Risque {#gestion-risque}

### Processus de Validation du Risque

```mermaid
flowchart TD
    SIGNAL["📊 Trading Signal"]

    subgraph "Risk Checks"
        CHECK1["Check Account Balance"]
        CHECK2["Check Open Positions"]
        CHECK3["Check Daily Loss Limit"]
        CHECK4["Check Correlation Risk"]
        CHECK5["Calculate Position Size"]
        CHECK6["Validate Leverage"]
    end

    subgraph "Decision Tree"
        D1{Balance OK?}
        D2{Positions < 5?}
        D3{Daily Loss OK?}
        D4{Correlation OK?}
        D5{Size Valid?}
        D6{Leverage OK?}
    end

    APPROVE["✅ Approve Trade"]
    REJECT["❌ Reject Trade"]
    ADJUST["⚙️ Adjust Size"]

    SIGNAL --> CHECK1
    CHECK1 --> D1
    D1 -->|Yes| CHECK2
    D1 -->|No| REJECT

    CHECK2 --> D2
    D2 -->|Yes| CHECK3
    D2 -->|No| REJECT

    CHECK3 --> D3
    D3 -->|Yes| CHECK4
    D3 -->|No| REJECT

    CHECK4 --> D4
    D4 -->|Yes| CHECK5
    D4 -->|No| REJECT

    CHECK5 --> D5
    D5 -->|Yes| CHECK6
    D5 -->|No| ADJUST

    ADJUST --> CHECK5

    CHECK6 --> D6
    D6 -->|Yes| APPROVE
    D6 -->|No| REJECT

    style APPROVE fill:#48BB78,stroke:#38A169,color:#FFF
    style REJECT fill:#E53E3E,stroke:#C53030,color:#FFF
    style ADJUST fill:#ECC94B,stroke:#D69E2E,color:#000
```

### Take Profit Strategy Flow

```mermaid
stateDiagram-v2
    [*] --> PositionOpened

    PositionOpened --> Monitoring: Start monitoring

    Monitoring --> Profit3Percent: Price +3%
    Monitoring --> StopLoss: Price -2%

    Profit3Percent --> PartialExit33: Exit 33%
    PartialExit33 --> Monitoring67: 67% remaining

    Monitoring67 --> Profit5Percent: Price +5%
    Monitoring67 --> TrailingStop: Activate trailing

    Profit5Percent --> PartialExit50: Exit 50%
    PartialExit50 --> Monitoring33: 33% remaining

    Monitoring33 --> Profit7Percent: Price +7%
    Monitoring33 --> TrailingStop2: Tighten trailing

    Profit7Percent --> FullExit: Exit 100%

    TrailingStop --> FullExit: Stop triggered
    TrailingStop2 --> FullExit: Stop triggered
    StopLoss --> FullExit: Stop loss hit

    FullExit --> [*]
```

---

## 7. Cycle de Vie des Positions {#cycle-vie-positions}

### États d'une Position

```mermaid
stateDiagram-v2
    [*] --> SignalGenerated

    SignalGenerated --> RiskValidation: Signal received

    RiskValidation --> OrderPending: Risk approved
    RiskValidation --> Rejected: Risk rejected

    OrderPending --> OrderPlaced: Send to exchange
    OrderPending --> Failed: Order failed

    OrderPlaced --> PositionOpen: Order filled
    OrderPlaced --> Cancelled: Order cancelled

    PositionOpen --> Monitoring: Start monitoring

    Monitoring --> ProfitTarget1: TP1 reached (3%)
    Monitoring --> ProfitTarget2: TP2 reached (5%)
    Monitoring --> ProfitTarget3: TP3 reached (7%)
    Monitoring --> StopLossHit: SL triggered

    ProfitTarget1 --> PartialClose1: Close 33%
    PartialClose1 --> Monitoring

    ProfitTarget2 --> PartialClose2: Close 50%
    PartialClose2 --> Monitoring

    ProfitTarget3 --> FullClose: Close 100%
    StopLossHit --> FullClose: Close position

    FullClose --> PositionClosed: Update metrics

    PositionClosed --> [*]
    Rejected --> [*]
    Failed --> [*]
    Cancelled --> [*]
```

### Timeline d'une Position Type

```mermaid
gantt
    title Position Trading Timeline
    dateFormat HH:mm
    axisFormat %H:%M

    section Signal Phase
    Signal Detection          :done, signal, 09:00, 1m
    Strategy Analysis         :done, analysis, after signal, 2m
    Risk Validation          :done, risk, after analysis, 1m

    section Entry Phase
    Order Preparation        :done, prep, after risk, 30s
    Order Execution         :done, exec, after prep, 30s
    Position Opened         :milestone, after exec, 0m

    section Management Phase
    Initial Monitoring      :active, monitor1, after exec, 30m
    TP1 Reached (3%)       :milestone, after monitor1, 0m
    Partial Exit 33%       :done, exit1, after monitor1, 1m
    Continued Monitoring   :active, monitor2, after exit1, 45m
    TP2 Reached (5%)      :milestone, after monitor2, 0m
    Partial Exit 50%      :done, exit2, after monitor2, 1m
    Final Monitoring      :active, monitor3, after exit2, 20m
    TP3 Reached (7%)     :milestone, after monitor3, 0m
    Full Exit            :done, exit3, after monitor3, 1m

    section Reporting
    Update Metrics       :done, metrics, after exit3, 30s
    Log Performance     :done, logs, after metrics, 30s
```

---

## 8. Architecture de Déploiement {#architecture-deploiement}

### Diagramme de Déploiement

```mermaid
graph TB
    subgraph "Development Environment"
        DEV["💻 Developer Machine<br/><<device>>"]
        DEVNODE["Bun Runtime<br/><<execution environment>>"]
        DEVBOT["Lukaya Bot<br/><<artifact>>"]

        DEV --> DEVNODE
        DEVNODE --> DEVBOT
    end

    subgraph "Production Environment"
        subgraph "Cloud VPS / Docker"
            PROD["🖥️ Production Server<br/><<device>>"]
            PRODNODE["Bun Runtime<br/><<execution environment>>"]
            PRODBOT["Lukaya Bot<br/><<artifact>>"]
            MONITOR["Monitoring Stack<br/><<artifact>>"]
        end

        PROD --> PRODNODE
        PRODNODE --> PRODBOT
        PROD --> MONITOR
    end

    subgraph "External Services"
        DYDX["dYdX Network<br/><<external system>>"]
        LOGS["Log Aggregator<br/><<external system>>"]
        ALERTS["Alert Service<br/><<external system>>"]
    end

    DEVBOT -.->|WebSocket| DYDX
    PRODBOT -->|WebSocket| DYDX
    PRODBOT -->|HTTPS| LOGS
    MONITOR -->|Webhooks| ALERTS

    style PROD fill:#48BB78,stroke:#38A169,color:#FFF
    style DYDX fill:#E53E3E,stroke:#C53030,color:#FFF
```

### Infrastructure as Code

```mermaid
graph LR
    subgraph "Deployment Pipeline"
        GIT["Git Repository"]
        CI["CI/CD Pipeline"]
        BUILD["Build Process"]
        TEST["Test Suite"]
        DEPLOY["Deployment"]
    end

    subgraph "Environments"
        DEV["Development"]
        STAGING["Staging"]
        PROD["Production"]
    end

    GIT --> CI
    CI --> BUILD
    BUILD --> TEST

    TEST -->|Pass| DEPLOY
    TEST -->|Fail| GIT

    DEPLOY --> DEV
    DEV -->|Promote| STAGING
    STAGING -->|Promote| PROD

    style TEST fill:#ECC94B,stroke:#D69E2E,color:#000
    style PROD fill:#48BB78,stroke:#38A169,color:#FFF
```

---

## 📋 Légende des Diagrammes

### Symboles Utilisés

- **🤖** : Composant automatisé
- **👤** : Acteur humain
- **📊** : Données/Métriques
- **🛡️** : Sécurité/Protection
- **💰** : Finance/Profit
- **⚡** : Action/Événement
- **📝** : Logs/Documentation
- **🔌** : Connexion/Interface

### Codes Couleur

- 🟦 **Bleu** : Composants principaux
- 🟩 **Vert** : Succès/Approbation
- 🟥 **Rouge** : Erreur/Rejet
- 🟨 **Jaune** : Avertissement/En cours
- 🟪 **Violet** : Acteurs/Services

---

*Ces diagrammes représentent l'architecture complète du système Lukaya Trading Bot. Pour plus de détails sur chaque composant, consultez la documentation technique correspondante.*
