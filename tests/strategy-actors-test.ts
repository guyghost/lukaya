import { createActorSystem } from '../src/actor/system';
import { createStrategyManagerActorDefinition } from '../src/application/actors/strategy-manager/strategy-manager.actor';
import { createStrategyActorDefinition } from '../src/adapters/primary/strategy-actor.adapter';
import { Strategy, StrategySignal } from '../src/domain/models/strategy.model';
import { MarketData } from '../src/domain/models/market.model';
import { getLogger } from '../src/infrastructure/logger';

// Créer une instance de stratégie mock
class MockRsiDivergenceStrategy implements Strategy {
  private id: string;
  private name: string;
  private config: any;
  
  constructor(id: string, name: string, symbol: string) {
    this.id = id;
    this.name = name;
    this.config = {
      parameters: {
        symbol,
        timeframe: '1h',
        rsiPeriod: 14,
        overBought: 70,
        overSold: 30
      }
    };
  }
  
  getId(): string {
    return this.id;
  }
  
  getName(): string {
    return this.name;
  }
  
  getConfig(): any {
    return this.config;
  }
  
  async processMarketData(data: MarketData): Promise<StrategySignal | null> {
    // Simuler un signal de divergence RSI
    if (Math.random() > 0.7) {
      const isLong = Math.random() > 0.5;
      
      return {
        type: 'entry',
        direction: isLong ? 'long' : 'short',
        price: data.price,
        reason: `RSI divergence detected: ${isLong ? 'bullish' : 'bearish'}`,
        confidence: 0.75,
        metadata: {
          indicator: 'rsi',
          value: isLong ? 25 : 75
        }
      };
    }
    
    return null;
  }
}

class MockVolumeAnalysisStrategy implements Strategy {
  private id: string;
  private name: string;
  private config: any;
  
  constructor(id: string, name: string, symbol: string) {
    this.id = id;
    this.name = name;
    this.config = {
      parameters: {
        symbol,
        timeframe: '1h',
        volumeThreshold: 1.5
      }
    };
  }
  
  getId(): string {
    return this.id;
  }
  
  getName(): string {
    return this.name;
  }
  
  getConfig(): any {
    return this.config;
  }
  
  async processMarketData(data: MarketData): Promise<StrategySignal | null> {
    // Simuler un signal de volume anormal
    if (Math.random() > 0.8) {
      const isLong = Math.random() > 0.3; // Biais haussier pour cette stratégie
      
      return {
        type: 'entry',
        direction: isLong ? 'long' : 'short',
        price: data.price,
        reason: `Volume spike detected: ${isLong ? 'high buying pressure' : 'high selling pressure'}`,
        confidence: 0.65,
        metadata: {
          indicator: 'volume',
          value: (Math.random() * 2 + 1.5).toFixed(2) // Volume de 1.5 à 3.5 fois la moyenne
        }
      };
    }
    
    return null;
  }
}

// Fonction de test principale
async function runTest() {
  const logger = getLogger();
  logger.info("Starting strategy actors test...");
  
  // Créer le système d'acteurs
  const actorSystem = createActorSystem();
  
  // Créer le gestionnaire de stratégies
  const strategyManagerDef = createStrategyManagerActorDefinition({
    conflictResolutionMode: 'performance_weighted'
  });
  
  const strategyManagerAddr = actorSystem.createActor(strategyManagerDef);
  logger.info(`Strategy manager created: ${strategyManagerAddr}`);
  
  // Créer les stratégies
  const symbol = "BTC-USD";
  const rsiStrategy = new MockRsiDivergenceStrategy("rsi-div-1", "RSI Divergence Strategy", symbol);
  const volumeStrategy = new MockVolumeAnalysisStrategy("volume-1", "Volume Analysis Strategy", symbol);
  
  // Enregistrer les stratégies dans le gestionnaire
  actorSystem.send(strategyManagerAddr, {
    type: "REGISTER_STRATEGY",
    strategy: rsiStrategy,
    markets: [symbol]
  });
  
  actorSystem.send(strategyManagerAddr, {
    type: "REGISTER_STRATEGY",
    strategy: volumeStrategy,
    markets: [symbol]
  });
  
  // Créer les acteurs de stratégie et les connecter au gestionnaire
  const rsiActorDef = createStrategyActorDefinition(rsiStrategy, strategyManagerAddr);
  const volumeActorDef = createStrategyActorDefinition(volumeStrategy, strategyManagerAddr);
  
  const rsiActorAddr = actorSystem.createActor(rsiActorDef);
  const volumeActorAddr = actorSystem.createActor(volumeActorDef);
  
  logger.info(`RSI strategy actor created: ${rsiActorAddr}`);
  logger.info(`Volume strategy actor created: ${volumeActorAddr}`);
  
  // Simuler des données de marché
  logger.info("Simulating market data updates...");
  
  for (let i = 0; i < 5; i++) {
    // Créer des données de marché avec un prix qui fluctue légèrement
    const basePrice = 50000;
    const variation = (Math.random() - 0.5) * 1000;
    const marketData: MarketData = {
      symbol,
      price: basePrice + variation,
      bid: basePrice + variation - 10,
      ask: basePrice + variation + 10,
      volume: Math.random() * 100,
      timestamp: Date.now(),
      indicators: {}
    };
    
    logger.info(`Market data update #${i+1}: ${symbol} @ ${marketData.price}`);
    
    // Envoyer les données aux acteurs de stratégie
    actorSystem.send(rsiActorAddr, {
      type: "PROCESS_MARKET_DATA",
      data: marketData
    });
    
    actorSystem.send(volumeActorAddr, {
      type: "PROCESS_MARKET_DATA",
      data: marketData
    });
    
    // Attendre un peu avant la prochaine mise à jour
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  logger.info("Test completed. Check logs for signal processing results.");
}

// Exécuter le test
runTest().catch(error => {
  console.error("Test failed:", error);
});
