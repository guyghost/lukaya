# 📈 Diagrammes de Flux de Trading - Lukaya

Ce document détaille tous les flux de trading du système Lukaya avec des diagrammes visuels.

## Table des Matières

1. [Flux Principal de Trading](#flux-principal)
2. [Analyse de Marché](#analyse-marche)
3. [Génération de Signaux](#generation-signaux)
4. [Processus de Décision](#processus-decision)
5. [Exécution d'Ordres](#execution-ordres)
6. [Gestion des Positions](#gestion-positions)
7. [Flux de Take Profit](#flux-take-profit)
8. [Gestion des Erreurs](#gestion-erreurs)

---

## 1. Flux Principal de Trading {#flux-principal}

### Vue d'Ensemble du Processus Complet

```mermaid
flowchart TD
    START([🚀 Start Trading Bot])

    subgraph "Initialization"
        INIT[Initialize System]
        CONN[Connect to dYdX]
        LOAD[Load Strategies]
        ACTORS[Start Actors]
    end

    subgraph "Main Trading Loop"
        MARKET[📊 Receive Market Data]
        ANALYZE[🔍 Analyze Market]
        SIGNALS[📡 Generate Signals]
        RISK[🛡️ Risk Assessment]
        DECIDE{Trading Decision}
        EXECUTE[📤 Execute Trade]
        MONITOR[👁️ Monitor Position]
    end

    subgraph "Position Management"
        PROFIT{Profit Target?}
        LOSS{Stop Loss?}
        PARTIAL[Partial Exit]
        FULL[Full Exit]
        UPDATE[Update Metrics]
    end

    END([🛑 Stop Trading Bot])

    START --> INIT
    INIT --> CONN
    CONN --> LOAD
    LOAD --> ACTORS
    ACTORS --> MARKET

    MARKET --> ANALYZE
    ANALYZE --> SIGNALS
    SIGNALS --> RISK
    RISK --> DECIDE

    DECIDE -->|Approved| EXECUTE
    DECIDE -->|Rejected| MARKET

    EXECUTE --> MONITOR
    MONITOR --> PROFIT
    MONITOR --> LOSS

    PROFIT -->|Yes| PARTIAL
    PROFIT -->|No| MONITOR

    LOSS -->|Yes| FULL
    LOSS -->|No| MONITOR

    PARTIAL --> UPDATE
    FULL --> UPDATE
    UPDATE --> MARKET

    MARKET -->|Shutdown Signal| END

    style START fill:#22C55E,stroke:#16A34A,color:#FFF
    style END fill:#EF4444,stroke:#DC2626,color:#FFF
    style DECIDE fill:#F59E0B,stroke:#D97706,color:#FFF
    style PROFIT fill:#3B82F6,stroke:#2563EB,color:#FFF
    style LOSS fill:#EF4444,stroke:#DC2626,color:#FFF
```

---

## 2. Analyse de Marché {#analyse-marche}

### Flux de Collecte et Traitement des Données

```mermaid
flowchart LR
    subgraph "Data Sources"
        WS[WebSocket Stream]
        API[REST API]
        CACHE[Local Cache]
    end

    subgraph "Data Processing"
        VALID[Validate Data]
        NORM[Normalize]
        CALC[Calculate Indicators]
        STORE[Store in Memory]
    end

    subgraph "Market Indicators"
        PRICE[Price Action]
        VOL[Volume Profile]
        BOOK[Order Book]
        TREND[Trend Analysis]
    end

    subgraph "Technical Indicators"
        RSI[RSI Calculation]
        MA[Moving Averages]
        PIVOT[Pivot Points]
        FIBO[Fibonacci Levels]
    end

    WS --> VALID
    API --> VALID
    CACHE --> VALID

    VALID --> NORM
    NORM --> CALC
    CALC --> STORE

    STORE --> PRICE
    STORE --> VOL
    STORE --> BOOK
    STORE --> TREND

    PRICE --> RSI
    PRICE --> MA
    VOL --> PIVOT
    TREND --> FIBO
```

### Processus de Validation des Données

```mermaid
flowchart TD
    DATA[Incoming Data]

    CHECK1{Timestamp Valid?}
    CHECK2{Price Reasonable?}
    CHECK3{Volume Positive?}
    CHECK4{Sequence OK?}

    VALID[✅ Valid Data]
    INVALID[❌ Invalid Data]
    LOG[Log Error]
    RETRY[Retry Fetch]

    DATA --> CHECK1
    CHECK1 -->|Yes| CHECK2
    CHECK1 -->|No| INVALID

    CHECK2 -->|Yes| CHECK3
    CHECK2 -->|No| INVALID

    CHECK3 -->|Yes| CHECK4
    CHECK3 -->|No| INVALID

    CHECK4 -->|Yes| VALID
    CHECK4 -->|No| INVALID

    INVALID --> LOG
    LOG --> RETRY

    style VALID fill:#22C55E,stroke:#16A34A,color:#FFF
    style INVALID fill:#EF4444,stroke:#DC2626,color:#FFF
```

---

## 3. Génération de Signaux {#generation-signaux}

### Flux Multi-Stratégies

```mermaid
flowchart TB
    MARKET[Market Update]

    subgraph "Parallel Strategy Analysis"
        subgraph "RSI Divergence"
            RSI1[Calculate RSI]
            RSI2[Find Divergences]
            RSI3[Filter by Levels]
            RSISIG[RSI Signal]
        end

        subgraph "Volume Analysis"
            VOL1[Volume Spike Check]
            VOL2[Delta Analysis]
            VOL3[Correlation Check]
            VOLSIG[Volume Signal]
        end

        subgraph "Elliott Wave"
            EW1[Wave Counting]
            EW2[Pattern Recognition]
            EW3[Trend Validation]
            EWSIG[Wave Signal]
        end

        subgraph "Harmonic Patterns"
            HP1[Pattern Scan]
            HP2[Fibonacci Check]
            HP3[Completion Zone]
            HPSIG[Harmonic Signal]
        end
    end

    AGG[Signal Aggregator]
    SCORE[Confidence Score]
    FINAL{Final Decision}

    STRONG[💪 Strong Signal]
    MEDIUM[📊 Medium Signal]
    WEAK[🔍 Weak Signal]
    NONE[❌ No Signal]

    MARKET --> RSI1
    MARKET --> VOL1
    MARKET --> EW1
    MARKET --> HP1

    RSI1 --> RSI2 --> RSI3 --> RSISIG
    VOL1 --> VOL2 --> VOL3 --> VOLSIG
    EW1 --> EW2 --> EW3 --> EWSIG
    HP1 --> HP2 --> HP3 --> HPSIG

    RSISIG --> AGG
    VOLSIG --> AGG
    EWSIG --> AGG
    HPSIG --> AGG

    AGG --> SCORE
    SCORE --> FINAL

    FINAL -->|Score > 0.7| STRONG
    FINAL -->|0.5 < Score <= 0.7| MEDIUM
    FINAL -->|0.3 < Score <= 0.5| WEAK
    FINAL -->|Score <= 0.3| NONE

    style STRONG fill:#22C55E,stroke:#16A34A,color:#FFF
    style MEDIUM fill:#F59E0B,stroke:#D97706,color:#FFF
    style WEAK fill:#3B82F6,stroke:#2563EB,color:#FFF
    style NONE fill:#EF4444,stroke:#DC2626,color:#FFF
```

### Processus d'Agrégation des Signaux

```mermaid
flowchart LR
    subgraph "Individual Signals"
        S1[RSI: BUY +0.8]
        S2[Volume: BUY +0.6]
        S3[Elliott: NEUTRAL 0]
        S4[Harmonic: BUY +0.7]
    end

    subgraph "Weighting"
        W1[Weight: 0.25]
        W2[Weight: 0.25]
        W3[Weight: 0.25]
        W4[Weight: 0.25]
    end

    subgraph "Calculation"
        MULT[Multiply & Sum]
        ADJ[Performance Adjustment]
        NORM[Normalize Score]
    end

    RESULT[Final Score: 0.525]
    ACTION[Action: BUY MEDIUM]

    S1 --> MULT
    S2 --> MULT
    S3 --> MULT
    S4 --> MULT

    W1 --> MULT
    W2 --> MULT
    W3 --> MULT
    W4 --> MULT

    MULT --> ADJ
    ADJ --> NORM
    NORM --> RESULT
    RESULT --> ACTION
```

---

## 4. Processus de Décision {#processus-decision}

### Arbre de Décision de Trading

```mermaid
flowchart TD
    SIGNAL[Trading Signal Received]

    subgraph "Pre-Checks"
        C1{Market Open?}
        C2{System Healthy?}
        C3{Signal Valid?}
    end

    subgraph "Risk Validation"
        R1{Account Balance OK?}
        R2{Position Count < 5?}
        R3{Daily Loss < Limit?}
        R4{Correlation Risk OK?}
    end

    subgraph "Position Sizing"
        SIZE[Calculate Size]
        ADJ{Size Adjustment Needed?}
        RESIZE[Adjust Size]
    end

    subgraph "Final Checks"
        F1{Leverage OK?}
        F2{Stop Loss Valid?}
        F3{Take Profit Set?}
    end

    APPROVE[✅ Execute Trade]
    REJECT[❌ Reject Signal]

    SIGNAL --> C1
    C1 -->|No| REJECT
    C1 -->|Yes| C2
    C2 -->|No| REJECT
    C2 -->|Yes| C3
    C3 -->|No| REJECT
    C3 -->|Yes| R1

    R1 -->|No| REJECT
    R1 -->|Yes| R2
    R2 -->|No| REJECT
    R2 -->|Yes| R3
    R3 -->|No| REJECT
    R3 -->|Yes| R4
    R4 -->|No| REJECT
    R4 -->|Yes| SIZE

    SIZE --> ADJ
    ADJ -->|Yes| RESIZE
    ADJ -->|No| F1
    RESIZE --> F1

    F1 -->|No| REJECT
    F1 -->|Yes| F2
    F2 -->|No| REJECT
    F2 -->|Yes| F3
    F3 -->|No| REJECT
    F3 -->|Yes| APPROVE

    style APPROVE fill:#22C55E,stroke:#16A34A,color:#FFF
    style REJECT fill:#EF4444,stroke:#DC2626,color:#FFF
```

---

## 5. Exécution d'Ordres {#execution-ordres}

### Flux d'Exécution d'Ordre

```mermaid
sequenceDiagram
    participant RM as Risk Manager
    participant OE as Order Executor
    participant DC as dYdX Client
    participant EX as Exchange
    participant TPM as Take Profit Mgr
    participant PT as Perf Tracker

    RM->>OE: Approved Trade Request
    OE->>OE: Prepare Order Details

    Note over OE: Order Details:
    Note over OE: - Symbol
    Note over OE: - Side (BUY/SELL)
    Note over OE: - Size
    Note over OE: - Type (MARKET/LIMIT)
    Note over OE: - Stop Loss
    Note over OE: - Take Profit Levels

    OE->>DC: Submit Order
    DC->>EX: Place Order

    alt Order Success
        EX-->>DC: Order Filled
        DC-->>OE: Confirmation
        OE->>TPM: Register Position
        OE->>PT: Log Trade

        Note over TPM: Start Monitoring:
        Note over TPM: - TP1: 3% (33% exit)
        Note over TPM: - TP2: 5% (50% exit)
        Note over TPM: - TP3: 7% (100% exit)

    else Order Failed
        EX-->>DC: Error/Rejection
        DC-->>OE: Error Details
        OE->>PT: Log Failure
        OE->>RM: Notify Failure
    end
```

### Gestion des Types d'Ordres

```mermaid
flowchart TD
    ORDER[Order Request]

    TYPE{Order Type?}

    subgraph "Market Order"
        M1[Check Spread]
        M2[Calculate Slippage]
        M3[Adjust Size if Needed]
        M4[Execute Immediately]
    end

    subgraph "Limit Order"
        L1[Set Limit Price]
        L2[Set Time in Force]
        L3[Monitor Fill Status]
        L4[Handle Partial Fills]
    end

    subgraph "Stop Order"
        S1[Set Stop Price]
        S2[Monitor Trigger]
        S3[Convert to Market]
        S4[Execute on Trigger]
    end

    EXEC[Order Executed]
    MONITOR[Start Monitoring]

    ORDER --> TYPE
    TYPE -->|Market| M1
    TYPE -->|Limit| L1
    TYPE -->|Stop| S1

    M1 --> M2 --> M3 --> M4
    L1 --> L2 --> L3 --> L4
    S1 --> S2 --> S3 --> S4

    M4 --> EXEC
    L4 --> EXEC
    S4 --> EXEC

    EXEC --> MONITOR
```

---

## 6. Gestion des Positions {#gestion-positions}

### Cycle de Vie d'une Position

```mermaid
stateDiagram-v2
    [*] --> Opening: Order Placed

    Opening --> Open: Order Filled
    Opening --> Failed: Order Failed

    Open --> Monitoring: Start Monitoring

    Monitoring --> Profit: In Profit
    Monitoring --> Loss: In Loss
    Monitoring --> Breakeven: At Breakeven

    Profit --> TP1: Reach 3%
    Profit --> TP2: Reach 5%
    Profit --> TP3: Reach 7%

    TP1 --> PartialClose1: Exit 33%
    PartialClose1 --> Monitoring: Continue

    TP2 --> PartialClose2: Exit 50%
    PartialClose2 --> Monitoring: Continue

    TP3 --> FullClose: Exit 100%

    Loss --> StopLoss: Hit Stop Loss
    StopLoss --> FullClose: Emergency Exit

    Breakeven --> TrailingStop: Activate Trailing
    TrailingStop --> FullClose: Stop Triggered

    FullClose --> Closed: Position Closed
    Failed --> Closed: Order Cancelled

    Closed --> [*]
```

### Monitoring en Temps Réel

```mermaid
flowchart TB
    POS[Active Position]

    subgraph "Real-Time Monitoring"
        PRICE[Current Price]
        PNL[P&L Calculation]
        PERC[% Change]
        RISK[Risk Metrics]
    end

    subgraph "Decision Points"
        TP{Take Profit Hit?}
        SL{Stop Loss Hit?}
        TIME{Time Limit?}
        TRAIL{Trailing Stop?}
    end

    subgraph "Actions"
        PARTIAL[Partial Exit]
        FULL[Full Exit]
        ADJUST[Adjust Stop]
        HOLD[Continue Holding]
    end

    UPDATE[Update Metrics]
    LOG[Log Event]

    POS --> PRICE
    PRICE --> PNL
    PNL --> PERC
    PERC --> RISK

    RISK --> TP
    RISK --> SL
    RISK --> TIME
    RISK --> TRAIL

    TP -->|Yes| PARTIAL
    TP -->|No| HOLD

    SL -->|Yes| FULL
    SL -->|No| HOLD

    TIME -->|Yes| FULL
    TIME -->|No| HOLD

    TRAIL -->|Yes| ADJUST
    TRAIL -->|No| HOLD

    PARTIAL --> UPDATE
    FULL --> UPDATE
    ADJUST --> UPDATE
    HOLD --> UPDATE

    UPDATE --> LOG
    LOG --> POS
```

---

## 7. Flux de Take Profit {#flux-take-profit}

### Stratégie 3-5-7% en Détail

```mermaid
flowchart TD
    ENTRY[Position Entry]

    subgraph "Initial Setup"
        POS[Position Size: 100%]
        TP1[TP1: Entry + 3%]
        TP2[TP2: Entry + 5%]
        TP3[TP3: Entry + 7%]
        SL[SL: Entry - 2%]
    end

    subgraph "Monitoring Loop"
        CHECK[Check Current Price]
        CALC[Calculate P&L %]

        D1{P&L >= 3%?}
        D2{P&L >= 5%?}
        D3{P&L >= 7%?}
        D4{P&L <= -2%?}
    end

    subgraph "Exit Actions"
        E1[Exit 33% at TP1]
        E2[Exit 50% of remaining at TP2]
        E3[Exit 100% at TP3]
        ESL[Exit 100% at Stop Loss]
    end

    subgraph "Position Updates"
        U1[Remaining: 67%]
        U2[Remaining: 33%]
        U3[Position Closed]
    end

    TRAIL[Activate Trailing Stop]

    ENTRY --> POS
    POS --> CHECK

    CHECK --> CALC
    CALC --> D1

    D1 -->|Yes & First Time| E1
    D1 -->|No| D4
    E1 --> U1
    U1 --> TRAIL

    D1 -->|Yes & Already Hit| D2
    D2 -->|Yes & First Time| E2
    D2 -->|No| CHECK
    E2 --> U2

    D2 -->|Yes & Already Hit| D3
    D3 -->|Yes| E3
    D3 -->|No| CHECK
    E3 --> U3

    D4 -->|Yes| ESL
    ESL --> U3

    TRAIL --> CHECK

    style E1 fill:#22C55E,stroke:#16A34A,color:#FFF
    style E2 fill:#3B82F6,stroke:#2563EB,color:#FFF
    style E3 fill:#8B5CF6,stroke:#7C3AED,color:#FFF
    style ESL fill:#EF4444,stroke:#DC2626,color:#FFF
```

### Calcul des Sorties Progressives

```mermaid
flowchart LR
    subgraph "Initial Position"
        POS1[Size: $1000<br/>100%]
    end

    subgraph "After TP1 (3%)"
        EXIT1[Exit: $330<br/>33%]
        REM1[Remaining: $670<br/>67%]
    end

    subgraph "After TP2 (5%)"
        EXIT2[Exit: $335<br/>50% of remaining]
        REM2[Remaining: $335<br/>33%]
    end

    subgraph "After TP3 (7%)"
        EXIT3[Exit: $335<br/>100% of remaining]
        REM3[Remaining: $0<br/>0%]
    end

    subgraph "Total Profit"
        PROF[Entry: $1000<br/>Exit Sum: $1000 + gains<br/>Profit: ~5.7% weighted]
    end

    POS1 --> EXIT1
    POS1 --> REM1

    REM1 --> EXIT2
    REM1 --> REM2

    REM2 --> EXIT3
    REM2 --> REM3

    EXIT1 --> PROF
    EXIT2 --> PROF
    EXIT3 --> PROF
```

---

## 8. Gestion des Erreurs {#gestion-erreurs}

### Flux de Gestion d'Erreurs

```mermaid
flowchart TD
    ERROR[Error Detected]

    subgraph "Error Classification"
        TYPE{Error Type?}

        CONN[Connection Error]
        AUTH[Authentication Error]
        RATE[Rate Limit Error]
        TRADE[Trading Error]
        DATA[Data Error]
        SYS[System Error]
    end

    subgraph "Error Handling"
        H1[Retry with Backoff]
        H2[Re-authenticate]
        H3[Wait and Retry]
        H4[Log and Alert]
        H5[Validate and Retry]
        H6[Emergency Shutdown]
    end

    subgraph "Recovery Actions"
        R1[Reconnect WebSocket]
        R2[Refresh Token]
        R3[Queue Requests]
        R4[Cancel Pending Orders]
        R5[Clear Cache]
        R6[Safe Mode]
    end

    CONTINUE[Continue Operation]
    ALERT[Alert Administrator]

    ERROR --> TYPE

    TYPE -->|Connection| CONN
    TYPE -->|Auth| AUTH
    TYPE -->|Rate Limit| RATE
    TYPE -->|Trade| TRADE
    TYPE -->|Data| DATA
    TYPE -->|System| SYS

    CONN --> H1 --> R1
    AUTH --> H2 --> R2
    RATE --> H3 --> R3
    TRADE --> H4 --> R4
    DATA --> H5 --> R5
    SYS --> H6 --> R6

    R1 --> CONTINUE
    R2 --> CONTINUE
    R3 --> CONTINUE
    R4 --> ALERT
    R5 --> CONTINUE
    R6 --> ALERT

    style ERROR fill:#EF4444,stroke:#DC2626,color:#FFF
    style ALERT fill:#F59E0B,stroke:#D97706,color:#FFF
    style CONTINUE fill:#22C55E,stroke:#16A34A,color:#FFF
```

### Circuit Breaker Pattern

```mermaid
stateDiagram-v2
    [*] --> Closed: Initial State

    Closed --> Open: Failure Threshold Reached
    Closed --> Closed: Success

    Open --> HalfOpen: After Timeout

    HalfOpen --> Closed: Success
    HalfOpen --> Open: Failure

    note right of Closed
        Normal operation
        All requests pass through
    end note

    note right of Open
        Circuit open
        All requests fail fast
        No load on failing service
    end note

    note right of HalfOpen
        Testing state
        Limited requests allowed
        Checking if service recovered
    end note
```

---

## 📊 Métriques et KPIs

### Flux de Collecte de Métriques

```mermaid
flowchart LR
    subgraph "Event Sources"
        TRADE[Trade Events]
        POS[Position Updates]
        ERR[Error Events]
        SYS[System Events]
    end

    subgraph "Metric Collectors"
        PERF[Performance Metrics]
        RISK[Risk Metrics]
        OPER[Operational Metrics]
    end

    subgraph "Aggregation"
        AGG[Metric Aggregator]
        CALC[Calculate KPIs]
        STORE[Time Series Store]
    end

    subgraph "Output"
        LOG[Log Files]
        DASH[Dashboard]
        ALERT[Alerts]
    end

    TRADE --> PERF
    POS --> PERF
    POS --> RISK
    ERR --> OPER
    SYS --> OPER

    PERF --> AGG
    RISK --> AGG
    OPER --> AGG

    AGG --> CALC
    CALC --> STORE

    STORE --> LOG
    STORE --> DASH
    STORE --> ALERT
```

---

## 🔄 Flux de Récupération

### Processus de Récupération après Crash

```mermaid
flowchart TD
    CRASH[System Crash Detected]

    subgraph "Recovery Steps"
        S1[Load Last State]
        S2[Verify Positions]
        S3[Sync with Exchange]
        S4[Reconcile Orders]
        S5[Resume Monitoring]
    end

    subgraph "Validation"
        V1{State Valid?}
        V2{Positions Match?}
        V3{Orders Synced?}
    end

    subgraph "Actions"
        A1[Restore from Backup]
        A2[Cancel Orphan Orders]
        A3[Update Position Status]
        A4[Resume Normal Operation]
    end

    ALERT[Alert Sent]
    READY[System Ready]

    CRASH --> S1
    S1 --> V1

    V1 -->|Yes| S2
    V1 -->|No| A1
    A1 --> S1

    S2 --> V2
    V2 -->|Yes| S3
    V2 -->|No| A3
    A3 --> S3

    S3 --> S4
    S4 --> V3

    V3 -->|Yes| S5
    V3 -->|No| A2
    A2 --> S5

    S5 --> A4
    A4 --> READY
    A4 --> ALERT

    style CRASH fill:#EF4444,stroke:#DC2626,color:#FFF
    style READY fill:#22C55E,stroke:#16A34A,color:#FFF
```

---

*Ces diagrammes représentent l'ensemble des flux de trading du système Lukaya. Chaque flux est conçu pour être robuste, scalable et facile à maintenir.*
