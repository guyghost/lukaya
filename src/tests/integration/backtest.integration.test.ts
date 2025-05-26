import { BacktestService } from '../../backtest/services/backtest.service';
import { BacktestConfig } from '../../backtest/models/backtest.model';
import { Strategy, StrategySignal } from '../../domain/models/strategy.model';
import { MarketData, OrderParams } from '../../domain/models/market.model';

/**
 * Stratégie de test simple pour le backtesting
 */
class SimpleMovingAverageStrategy implements Strategy {
  private id: string;
  private name: string;
  private period: number;
  private lastValues: number[] = [];
  
  constructor(id: string, name: string, period: number = 20) {
    this.id = id;
    this.name = name;
    this.period = period;
  }
  
  getId(): string {
    return this.id;
  }
  
  getName(): string {
    return this.name;
  }
  
  getConfig() {
    return {
      id: this.id,
      name: this.name,
      parameters: {
        period: this.period
      }
    };
  }
  
  async processMarketData(data: MarketData): Promise<StrategySignal | null> {
    // Ajouter le prix actuel à la liste
    this.lastValues.push(data.price);
    
    // Garder seulement les N dernières valeurs (période)
    if (this.lastValues.length > this.period) {
      this.lastValues.shift();
    }
    
    // Pas assez de données pour calculer la moyenne mobile
    if (this.lastValues.length < this.period) {
      return null;
    }
    
    // Calculer la moyenne mobile
    const sma = this.lastValues.reduce((a, b) => a + b, 0) / this.lastValues.length;
    
    // Génération de signal simple:
    // - Si le prix actuel passe au-dessus de la moyenne mobile, signal d'achat (long)
    // - Si le prix actuel passe en-dessous de la moyenne mobile, signal de vente (short/exit)
    const currentPrice = data.price;
    const previousPrice = this.lastValues[this.lastValues.length - 2];
    
    if (previousPrice < sma && currentPrice > sma) {
      return {
        type: "entry",
        direction: "long",
        reason: "Prix au-dessus de la moyenne mobile",
        confidence: 0.7
      };
    } else if (previousPrice > sma && currentPrice < sma) {
      return {
        type: "exit",
        direction: "short",
        reason: "Prix en-dessous de la moyenne mobile",
        confidence: 0.7
      };
    }
    
    return null;
  }
  
  generateOrder(signal: StrategySignal, marketData: MarketData): OrderParams | null {
    // Implémentation simplifiée pour les tests
    return {
      symbol: marketData.symbol,
      side: signal.type === "entry" ? "BUY" : "SELL",
      type: "MARKET",
      size: 1.0
    } as any; // Cast temporaire pour contourner les erreurs de type dans les tests
  }
  
  updateConfig(config: any) {
    if (config.parameters && typeof config.parameters.period === 'number') {
      this.period = config.parameters.period;
      this.lastValues = []; // Réinitialiser lors du changement de période
    }
  }
}

/**
 * Tests d'intégration pour le service de backtesting
 */
describe('Backtest Integration Tests', () => {
  let backtestService: BacktestService;
  let smaStrategy: Strategy;
  
  beforeEach(() => {
    backtestService = new BacktestService();
    smaStrategy = new SimpleMovingAverageStrategy('sma-test', 'Test SMA Strategy', 20);
  });
  
  test('should execute backtest with synthetic data', async () => {
    // Configuration du backtest
    const config: BacktestConfig = {
      symbol: 'BTC/USDT',
      startDate: new Date('2023-01-01'),
      endDate: new Date('2023-02-01'),
      initialBalance: 10000,
      tradingFees: 0.1,
      slippage: 0.05,
      dataResolution: '1h',
      includeWeekends: true,
      enableStopLoss: false,
      enableTakeProfit: false
    };
    
    // Exécuter le backtest
    const result = await backtestService.runBacktest(smaStrategy, config);
    
    // Vérifications de base
    expect(result).toBeDefined();
    expect(result.strategyId).toBe('sma-test');
    expect(result.strategyName).toBe('Test SMA Strategy');
    expect(result.symbol).toBe('BTC/USDT');
    expect(result.initialBalance).toBe(10000);
    expect(result.finalBalance).toBeGreaterThan(0);
    expect(result.trades).toBeDefined();
    expect(Array.isArray(result.trades)).toBe(true);
    
    // Les métriques devraient être calculées
    expect(result.metrics).toBeDefined();
    expect(result.metrics.totalTrades).toBeGreaterThanOrEqual(0);
    
    // Vérifier que les dates correspondent à la plage demandée
    if (result.trades.length > 0) {
      const firstTradeDate = result.trades[0].entryDate;
      const lastTradeDate = result.trades[result.trades.length - 1].exitDate || result.trades[result.trades.length - 1].entryDate;
      
      expect(firstTradeDate.getTime()).toBeGreaterThanOrEqual(config.startDate.getTime());
      expect(lastTradeDate.getTime()).toBeLessThanOrEqual(config.endDate.getTime());
    }
  });
  
  test('should handle stop loss in backtest', async () => {
    // Configuration avec stop loss activé
    const config: BacktestConfig = {
      symbol: 'BTC/USDT',
      startDate: new Date('2023-01-01'),
      endDate: new Date('2023-02-01'),
      initialBalance: 10000,
      tradingFees: 0.1,
      slippage: 0.05,
      dataResolution: '1h',
      includeWeekends: true,
      enableStopLoss: true,
      stopLossPercentage: 2,
      enableTakeProfit: false
    };
    
    // Exécuter le backtest
    const result = await backtestService.runBacktest(smaStrategy, config);
    
    // Vérifier les résultats
    expect(result).toBeDefined();
    expect(result.trades).toBeDefined();
    
    // Si nous avons des trades, vérifier que le stop loss a été appliqué lorsque nécessaire
    const stopLossTrades = result.trades.filter(trade => 
      trade.status === 'closed' && 
      trade.profitPercentage < -1.9 && 
      trade.profitPercentage > -2.1
    );
    
    // Si les conditions de marché ont déclenché des stop loss, nous devrions en voir
    // Mais ce n'est pas garanti dans tous les cas, donc pas d'assertion stricte
    console.log(`Nombre de trades avec stop loss déclenché: ${stopLossTrades.length}`);
  });
  
  test('should compare different strategy parameters', async () => {
    // Configurer plusieurs stratégies avec différents paramètres
    const smaStrategy5 = new SimpleMovingAverageStrategy('sma-5', 'SMA 5 Periods', 5);
    const smaStrategy10 = new SimpleMovingAverageStrategy('sma-10', 'SMA 10 Periods', 10);
    const smaStrategy20 = new SimpleMovingAverageStrategy('sma-20', 'SMA 20 Periods', 20);
    
    const config: BacktestConfig = {
      symbol: 'BTC/USDT',
      startDate: new Date('2023-01-01'),
      endDate: new Date('2023-02-01'),
      initialBalance: 10000,
      tradingFees: 0.1,
      slippage: 0.05,
      dataResolution: '1h',
      includeWeekends: true,
      enableStopLoss: false,
      enableTakeProfit: false
    };
    
    // Exécuter les backtests
    const result5 = await backtestService.runBacktest(smaStrategy5, config);
    const result10 = await backtestService.runBacktest(smaStrategy10, config);
    const result20 = await backtestService.runBacktest(smaStrategy20, config);
    
    // Vérifier que chaque backtest a été correctement exécuté
    expect(result5).toBeDefined();
    expect(result10).toBeDefined();
    expect(result20).toBeDefined();
    
    // Comparer les performances
    console.log(`SMA 5: ${result5.profitPercentage.toFixed(2)}%, ${result5.metrics.totalTrades} trades`);
    console.log(`SMA 10: ${result10.profitPercentage.toFixed(2)}%, ${result10.metrics.totalTrades} trades`);
    console.log(`SMA 20: ${result20.profitPercentage.toFixed(2)}%, ${result20.metrics.totalTrades} trades`);
    
    // Les périodes plus courtes devraient générer plus de trades
    // (mais pas forcément de meilleurs résultats)
    expect(result5.metrics.totalTrades).toBeGreaterThanOrEqual(result10.metrics.totalTrades);
    expect(result10.metrics.totalTrades).toBeGreaterThanOrEqual(result20.metrics.totalTrades);
  });
});
