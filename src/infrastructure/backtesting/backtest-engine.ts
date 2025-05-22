import { createActorSystem } from "../../actor/system";
import { MarketDataPort } from "../../application/ports/market-data.port";
import { TradingPort } from "../../application/ports/trading.port";
import { Strategy } from "../../domain/models/strategy.model";
import { getLogger } from "../logger";
import { BacktestDataProvider } from "./backtest-data-provider";
import { BacktestTradingAdapter } from "./backtest-trading-adapter";
import { BacktestConfig, BacktestResults, BacktestTrade } from "./backtest-models";
import { createTradingBotService } from "../../application/services";
import { RiskManagerConfig } from "../../application/actors/risk-manager/risk-manager.model";
import { StrategyManagerConfig } from "../../application/actors/strategy-manager/strategy-manager.model";
import { PerformanceTrackerConfig } from "../../application/actors/performance-tracker/performance-tracker.model";
import { TakeProfitConfig } from "../../application/actors/take-profit-manager/take-profit-manager.model";
import { TakeProfitIntegratorConfig } from "../../application/integrators/take-profit-integrator";
import { MarketData } from "../../domain/models/market.model";

/**
 * Le moteur de backtesting principal qui exécute les simulations
 */
export class BacktestEngine {
  private logger = getLogger();
  private results: BacktestResults | null = null;
  private dataProvider: BacktestDataProvider;
  private tradingAdapter: BacktestTradingAdapter;
  private config: BacktestConfig;

  constructor(config: BacktestConfig) {
    this.config = config;
    this.dataProvider = new BacktestDataProvider(config.dataOptions);
    this.tradingAdapter = new BacktestTradingAdapter(config.tradingOptions);
  }

  /**
   * Exécute un backtest avec les stratégies fournies sur les données historiques
   */
  public async run(strategies: Strategy[]): Promise<BacktestResults> {
    this.logger.info("[BACKTEST] Starting backtest...", {
      startDate: this.config.startDate,
      endDate: this.config.endDate,
      initialBalance: this.config.tradingOptions.initialBalance,
      strategyCount: strategies.length
    });

    // Charger les données historiques
    await this.dataProvider.loadHistoricalData(
      strategies.map(s => s.getConfig().parameters.symbol),
      this.config.startDate,
      this.config.endDate
    );

    // Initialiser le moteur de trading simulé
    const marketDataPort: MarketDataPort = this.dataProvider.getMarketDataPort();
    const tradingPort: TradingPort = this.tradingAdapter.getTradingPort();

    // Configurer les options pour le bot de trading
    const riskConfig: Partial<RiskManagerConfig> = {
      ...this.config.riskConfig,
      accountSize: this.config.tradingOptions.initialBalance
    };

    // Créer le service de bot de trading avec des configurations adaptées au backtesting
    const tradingBot = createTradingBotService(
      marketDataPort,
      tradingPort,
      {
        pollInterval: 0, // Pas besoin d'intervalle de polling en backtest
        positionAnalysisInterval: 0, // Analyse déclenchée manuellement
        maxFundsPerOrder: this.config.tradingOptions.maxFundsPerOrder,
        riskConfig,
        strategyConfig: this.config.strategyConfig,
        performanceConfig: {
          historyLength: Infinity, // Conserver tout l'historique pour les backtests
          trackOpenPositions: true,
          realTimeUpdates: false
        },
        takeProfitConfig: this.config.takeProfitConfig,
        takeProfitIntegratorConfig: this.config.takeProfitIntegratorConfig,
        supervisorConfig: {
          maxMarkets: 100,
          pollingInterval: 0,
          priceChangeThreshold: 0,
          aggressiveMode: this.config.highRiskMode
        }
      }
    );

    // Ajouter les stratégies
    strategies.forEach(strategy => {
      tradingBot.addStrategy(strategy);
      this.logger.debug(`[BACKTEST] Added strategy: ${strategy.getName()}`);
    });
    
    // Connecter le bot aux événements du marché
    this.dataProvider.addMarketDataListener(async (data: MarketData) => {
      try {
        this.logger.debug(`[BACKTEST] Processing market data: ${data.symbol} at ${new Date(data.timestamp).toISOString()}, Price: ${data.price}`);
        
        // Traiter les données de marché pour chaque stratégie
        for (const strategy of strategies) {
          const strategyConfig = strategy.getConfig().parameters;
          const strategySymbol = strategyConfig.symbol;
          
          // Normaliser les symboles pour la comparaison
          const normalizedDataSymbol = data.symbol.replace(/[-_]/g, '').toUpperCase();
          const normalizedStrategySymbol = strategySymbol.replace(/[-_]/g, '').toUpperCase();
          
          this.logger.debug(`[BACKTEST] Checking strategy match: Strategy symbol: "${strategySymbol}" (${normalizedStrategySymbol}) vs Data symbol: "${data.symbol}" (${normalizedDataSymbol})`);
          
          if (normalizedStrategySymbol === normalizedDataSymbol) {
            this.logger.debug(`[BACKTEST] Matched strategy ${strategy.getName()} for ${data.symbol} data, passing to processMarketData`);
            const signal = await strategy.processMarketData(data);
            
            if (signal) {
              this.logger.info(`[BACKTEST] Signal generated: ${strategy.getName()} for ${data.symbol}: ${signal.type} ${signal.direction} at price ${data.price}`);
              const orderParams = strategy.generateOrder(signal, data);
              if (orderParams) {
                this.logger.info(`[BACKTEST] Placing order: ${orderParams.side} ${orderParams.size} ${orderParams.symbol} at ${orderParams.price || 'market'}`);
                await tradingPort.placeOrder(orderParams);
              } else {
                this.logger.warn(`[BACKTEST] No order params generated for signal: ${signal.type} ${signal.direction}`);
              }
            } else {
              this.logger.debug(`[BACKTEST] No signal generated for ${data.symbol} from ${strategy.getName()}`);
            }
          }
        }
      } catch (error) {
        this.logger.error(`[BACKTEST] Error processing market data event: ${error instanceof Error ? error.message : String(error)}`);
        console.error(error);
      }
    });

    // Démarrer le bot de trading
    tradingBot.start();
    
    // Traiter les données historiques de manière séquentielle
    let marketDataEvents = this.dataProvider.getMarketDataEvents();
    let totalEvents = marketDataEvents.length;
    
    // Log symbols in dataset for debugging
    const symbols = [...new Set(marketDataEvents.map(e => e.symbol))];
    this.logger.info(`[BACKTEST] Found data for following symbols: ${symbols.join(', ')}`);
    
    if (totalEvents > 0) {
      this.logger.info(`[BACKTEST] Processing ${totalEvents} market data events from ${new Date(marketDataEvents[0]?.timestamp).toISOString()} to ${new Date(marketDataEvents[marketDataEvents.length - 1]?.timestamp).toISOString()}`);
    }
    
    // Si nous n'avons pas assez de données, générer des données synthétiques
    if (totalEvents < 100 && this.config.dataOptions.interpolateData) {
      this.logger.info(`[BACKTEST] Only ${totalEvents} events found, generating synthetic data...`);
      
      // Organiser les données par symbole
      const dataBySymbol = new Map<string, MarketData[]>();
      
      for (const event of marketDataEvents) {
        const symbolData = dataBySymbol.get(event.symbol) || [];
        symbolData.push(event);
        dataBySymbol.set(event.symbol, symbolData);
      }
      
      // Générer des données pour chaque symbole
      const syntheticEvents: MarketData[] = [];
      
      for (const [symbol, events] of dataBySymbol.entries()) {
        if (events.length === 0) continue;
        
        // Trier par timestamp
        events.sort((a, b) => a.timestamp - b.timestamp);
        
        const lastEvent = events[events.length - 1];
        let lastPrice = lastEvent.price;
        let lastTimestamp = lastEvent.timestamp;
        
        // Créer des données supplémentaires
        for (let i = 0; i < Math.max(100 - events.length, 0); i++) {
          // Ajouter une variation aléatoire au prix (entre -1% et +1%)
          const variation = lastPrice * (Math.random() * 0.02 - 0.01);
          lastPrice += variation;
          lastTimestamp += 3600000; // +1 heure
          
          syntheticEvents.push({
            timestamp: lastTimestamp,
            symbol: lastEvent.symbol,
            price: lastPrice,
            volume: lastEvent.volume * (0.8 + Math.random() * 0.4),
            bid: lastPrice * 0.9999,
            ask: lastPrice * 1.0001
          });
        }
      }
      
      // Ajouter les événements synthétiques
      marketDataEvents = [...marketDataEvents, ...syntheticEvents];
      // Trier par timestamp
      marketDataEvents.sort((a, b) => a.timestamp - b.timestamp);
      
      totalEvents = marketDataEvents.length;
      this.logger.info(`[BACKTEST] Generated ${syntheticEvents.length} synthetic events, total events: ${totalEvents}`);
    }
    
    if (totalEvents === 0) {
      this.logger.error("[BACKTEST] No market data events found. Check symbol names and data files.");
    }
    
    let processedEvents = 0;
    const progressInterval = Math.floor(totalEvents / 10); // Afficher 10 mises à jour de progression
    
    for (const event of marketDataEvents) {
      // Simuler l'événement de données de marché
      await this.processMarketEvent(event, marketDataPort);
      
      processedEvents++;
      if (processedEvents % progressInterval === 0 || processedEvents === totalEvents) {
        const progressPercent = (processedEvents / totalEvents * 100).toFixed(1);
        this.logger.info(`[BACKTEST] Progress: ${progressPercent}% (${processedEvents}/${totalEvents})`);
      }
    }
    
    // Effectuer une analyse finale des positions
    tradingBot.analyzeOpenPositions();
    
    // Clôturer toutes les positions ouvertes à la fin de la simulation
    this.tradingAdapter.closeAllPositions();
    
    // Arrêter le bot de trading
    tradingBot.stop();
    
    // Collecter les résultats
    this.results = this.tradingAdapter.getResults();
    
    this.logger.info("[BACKTEST] Backtest completed", {
      finalBalance: this.results.finalBalance,
      profit: this.results.profit,
      profitPercentage: this.results.profitPercentage,
      totalTrades: this.results.trades.length,
      winRate: this.results.winRate
    });
    
    return this.results;
  }
  
  /**
   * Traite un événement de données de marché dans la simulation
   */
  private async processMarketEvent(event: MarketData, marketDataPort: MarketDataPort): Promise<void> {
    try {
      // Mettre à jour la date virtuelle du système
      this.tradingAdapter.setCurrentTimestamp(event.timestamp);
      
      // Debug log for market data processing
      this.logger.info(`[BACKTEST] Processing market event: ${event.symbol} price=${event.price} time=${new Date(event.timestamp).toISOString()}`);
      
      // S'assurer que les données de marché ont un prix valide
      if (!event.price || isNaN(event.price)) {
        this.logger.error(`[BACKTEST] Invalid price in market data event: ${event.symbol}`);
        return;
      }
      
      // Émettre l'événement de marché
      await this.dataProvider.emitMarketDataEvent(event);
      
      // Permettre au système de traiter l'événement
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Vérifier les ordres limites qui pourraient être exécutés avec ce prix
      try {
        await this.tradingAdapter.checkLimitOrders(event);
      } catch (error) {
        this.logger.error(`[BACKTEST] Error checking limit orders: ${error instanceof Error ? error.message : String(error)}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[BACKTEST] Error processing market event: ${errorMessage}`);
    }
  }
  
  /**
   * Génère un rapport détaillé des résultats du backtest
   */
  public async generateReport(): Promise<string> {
    if (!this.results) {
      throw new Error("No backtest results available. Run the backtest first.");
    }
    
    const startDateStr = this.config.startDate.toISOString().split('T')[0];
    const endDateStr = this.config.endDate.toISOString().split('T')[0];
    
    // Données générales du backtest
    let report = `=== RAPPORT DE BACKTEST (${startDateStr} - ${endDateStr}) ===\n\n`;
    report += `Solde initial: $${this.config.tradingOptions.initialBalance.toFixed(2)}\n`;
    report += `Solde final: $${this.results.finalBalance.toFixed(2)}\n`;
    report += `Profit: $${this.results.profit.toFixed(2)} (${this.results.profitPercentage.toFixed(2)}%)\n`;
    report += `Nombre total de trades: ${this.results.trades.length}\n`;
    report += `Taux de réussite: ${(this.results.winRate * 100).toFixed(2)}%\n`;
    report += `Facteur de profit: ${this.results.profitFactor.toFixed(2)}\n`;
    report += `Drawdown maximum: ${this.results.maxDrawdown.toFixed(2)}% \n\n`;
    
    // Statistiques par symbole
    const tradesBySymbol = new Map<string, BacktestTrade[]>();
    this.results.trades.forEach(trade => {
      const trades = tradesBySymbol.get(trade.symbol) || [];
      trades.push(trade);
      tradesBySymbol.set(trade.symbol, trades);
    });
    
    report += "=== RÉSULTATS PAR SYMBOLE ===\n\n";
    
    for (const [symbol, trades] of tradesBySymbol.entries()) {
      const winningTrades = trades.filter(t => t.profit > 0);
      const losingTrades = trades.filter(t => t.profit <= 0);
      
      const totalProfit = trades.reduce((sum, t) => sum + t.profit, 0);
      const totalWinning = winningTrades.reduce((sum, t) => sum + t.profit, 0);
      const totalLosing = losingTrades.reduce((sum, t) => sum + t.profit, 0);
      
      const winRate = winningTrades.length / trades.length;
      const profitFactor = Math.abs(totalLosing) > 0 ? Math.abs(totalWinning / totalLosing) : totalWinning > 0 ? Infinity : 0;
      
      report += `${symbol} (${trades.length} trades):\n`;
      report += `  Profit: $${totalProfit.toFixed(2)}\n`;
      report += `  Taux de réussite: ${(winRate * 100).toFixed(2)}%\n`;
      report += `  Trades gagnants: ${winningTrades.length}\n`;
      report += `  Trades perdants: ${losingTrades.length}\n`;
      report += `  Facteur de profit: ${profitFactor.toFixed(2)}\n\n`;
    }
    
    // Statistiques par stratégie
    const tradesByStrategy = new Map<string, BacktestTrade[]>();
    this.results.trades.forEach(trade => {
      const trades = tradesByStrategy.get(trade.strategyId) || [];
      trades.push(trade);
      tradesByStrategy.set(trade.strategyId, trades);
    });
    
    report += "=== RÉSULTATS PAR STRATÉGIE ===\n\n";
    
    for (const [strategyId, trades] of tradesByStrategy.entries()) {
      const winningTrades = trades.filter(t => t.profit > 0);
      const losingTrades = trades.filter(t => t.profit <= 0);
      
      const totalProfit = trades.reduce((sum, t) => sum + t.profit, 0);
      const totalWinning = winningTrades.reduce((sum, t) => sum + t.profit, 0);
      const totalLosing = losingTrades.reduce((sum, t) => sum + t.profit, 0);
      
      const winRate = winningTrades.length / trades.length;
      const profitFactor = Math.abs(totalLosing) > 0 ? Math.abs(totalWinning / totalLosing) : totalWinning > 0 ? Infinity : 0;
      
      report += `${strategyId} (${trades.length} trades):\n`;
      report += `  Profit: $${totalProfit.toFixed(2)}\n`;
      report += `  Taux de réussite: ${(winRate * 100).toFixed(2)}%\n`;
      report += `  Trades gagnants: ${winningTrades.length}\n`;
      report += `  Trades perdants: ${losingTrades.length}\n`;
      report += `  Facteur de profit: ${profitFactor.toFixed(2)}\n\n`;
    }
    
    return report;
  }
  
  /**
   * Formater une durée en ms en format lisible
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}
