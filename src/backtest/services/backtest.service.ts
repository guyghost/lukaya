import { BacktestConfig, BacktestResult, BacktestMetrics, BacktestTrade } from '../models/backtest.model';
import { Strategy } from '../../domain/models/strategy.model';
import { MarketData } from '../../domain/models/market.model';
import { createContextualLogger } from '../../infrastructure/logging/enhanced-logger';

/**
 * Service principal pour exécuter des backtests sur les stratégies
 */
export class BacktestService {
  private logger = createContextualLogger('BacktestService');
  
  /**
   * Exécute un backtest pour une stratégie donnée avec une configuration spécifique
   */
  async runBacktest(strategy: Strategy, config: BacktestConfig): Promise<BacktestResult> {
    this.logger.info(`Démarrage du backtest pour la stratégie ${strategy.getName()} sur ${config.symbol}`);
    
    // Initialiser le résultat du backtest
    const result: BacktestResult = {
      strategyId: strategy.getId(),
      strategyName: strategy.getName(),
      symbol: config.symbol,
      startDate: config.startDate,
      endDate: config.endDate,
      initialBalance: config.initialBalance,
      finalBalance: config.initialBalance,
      profit: 0,
      profitPercentage: 0,
      trades: [],
      metrics: this.initializeMetrics()
    };
    
    try {
      // Charger les données historiques
      const historicalData = await this.loadHistoricalData(config);
      
      if (!historicalData || historicalData.length === 0) {
        throw new Error('Aucune donnée historique disponible pour ce backtest');
      }
      
      this.logger.info(`${historicalData.length} points de données historiques chargés`);
      
      // Initialiser la stratégie avec les premières données si nécessaire
      if (strategy.initializeWithHistory) {
        const initializationData = historicalData.slice(0, Math.min(100, historicalData.length));
        await strategy.initializeWithHistory(initializationData);
        this.logger.info(`Stratégie initialisée avec ${initializationData.length} points de données`);
      }
      
      // État du backtest
      let balance = config.initialBalance;
      let position: BacktestTrade | null = null;
      let maxBalance = balance;
      let maxDrawdown = 0;
      
      // Traiter chaque point de données
      for (const data of historicalData) {
        // Mettre à jour le drawdown
        if (balance > maxBalance) {
          maxBalance = balance;
        } else if (maxBalance - balance > maxDrawdown) {
          maxDrawdown = maxBalance - balance;
        }
        
        // Appliquer les règles de stop loss et take profit si nécessaire
        if (position && position.status === 'open') {
          const isStopLossTriggered = this.checkStopLoss(position, data, config);
          const isTakeProfitTriggered = this.checkTakeProfit(position, data, config);
          
          if (isStopLossTriggered || isTakeProfitTriggered) {
            const reason = isStopLossTriggered ? 'Stop Loss' : 'Take Profit';
            position = this.closePosition(position, data, config, reason);
            result.trades.push(position);
            balance += position.profit - position.fees;
          }
        }
        
        // Traiter les données avec la stratégie
        const signal = await strategy.processMarketData(data);
        
        if (signal) {
          this.logger.debug(`Signal généré à ${new Date(data.timestamp).toISOString()}: ${signal.type} ${signal.direction}`);
          
          if (signal.type === 'entry' && !position) {
            // Ouvrir une nouvelle position
            position = this.openPosition(signal.direction, data, config);
            balance -= position.fees;
          } else if (signal.type === 'exit' && position && position.status === 'open') {
            // Fermer la position existante
            position = this.closePosition(position, data, config, 'Signal');
            result.trades.push(position);
            balance += position.profit - position.fees;
            position = null;
          }
        }
      }
      
      // Fermer toute position ouverte à la fin du backtest
      if (position && position.status === 'open') {
        const lastData = historicalData[historicalData.length - 1];
        position = this.closePosition(position, lastData, config, 'Fin du backtest');
        result.trades.push(position);
        balance += position.profit - position.fees;
      }
      
      // Mettre à jour les résultats finaux
      result.finalBalance = balance;
      result.profit = balance - config.initialBalance;
      result.profitPercentage = (result.profit / config.initialBalance) * 100;
      
      // Calculer les métriques finales
      result.metrics = this.calculateMetrics(result.trades, config, maxDrawdown);
      
      this.logger.info(`Backtest terminé pour ${strategy.getName()}. Profit: ${result.profit.toFixed(2)} (${result.profitPercentage.toFixed(2)}%)`);
      
      return result;
    } catch (error) {
      this.logger.error(`Erreur lors du backtest de la stratégie ${strategy.getName()}:`, error as Error);
      throw error;
    }
  }
  
  /**
   * Charge les données historiques pour le backtest
   */
  private async loadHistoricalData(config: BacktestConfig): Promise<MarketData[]> {
    this.logger.info(`Chargement des données historiques pour ${config.symbol} du ${config.startDate.toISOString()} au ${config.endDate.toISOString()}`);
    
    try {
      // Vérifier d'abord si les données existent en cache local
      const cachedData = await this.tryLoadFromCache(config);
      if (cachedData && cachedData.length > 0) {
        this.logger.info(`Données chargées depuis le cache: ${cachedData.length} points`);
        return this.preprocessHistoricalData(cachedData, config);
      }
      
      // Essayer de charger depuis l'API
      const apiData = await this.loadFromApi(config);
      if (apiData && apiData.length > 0) {
        // Sauvegarder dans le cache pour une utilisation future
        await this.saveToCache(config, apiData);
        this.logger.info(`Données chargées depuis l'API: ${apiData.length} points`);
        return this.preprocessHistoricalData(apiData, config);
      }
      
      // Si aucune donnée n'est disponible, essayer le générateur synthétique
      this.logger.warn(`Aucune donnée réelle disponible pour ${config.symbol}, génération de données synthétiques`);
      const syntheticData = this.generateSyntheticData(config);
      return this.preprocessHistoricalData(syntheticData, config);
    } catch (error) {
      this.logger.error(`Erreur lors du chargement des données historiques:`, error as Error);
      throw new Error(`Impossible de charger les données historiques: ${(error as Error).message}`);
    }
  }

  /**
   * Essaie de charger les données depuis le cache local
   */
  private async tryLoadFromCache(config: BacktestConfig): Promise<MarketData[] | null> {
    // Format du nom de fichier de cache: symbol_resolution_startDate_endDate.json
    const cacheFileName = `${config.symbol.replace('/', '_')}_${config.dataResolution}_${config.startDate.toISOString().split('T')[0]}_${config.endDate.toISOString().split('T')[0]}.json`;
    const cachePath = `./cache/historical_data/${cacheFileName}`;
    
    try {
      // Vérifier si le fichier existe
      const fs = require('fs');
      if (!fs.existsSync(cachePath)) {
        return null;
      }
      
      // Lire et parser les données
      const rawData = fs.readFileSync(cachePath, 'utf8');
      const parsedData = JSON.parse(rawData) as MarketData[];
      
      return parsedData;
    } catch (error) {
      this.logger.warn(`Erreur lors de la lecture du cache:`, error as Error);
      return null;
    }
  }

  /**
   * Sauvegarde les données dans le cache local
   */
  private async saveToCache(config: BacktestConfig, data: MarketData[]): Promise<void> {
    const cacheFileName = `${config.symbol.replace('/', '_')}_${config.dataResolution}_${config.startDate.toISOString().split('T')[0]}_${config.endDate.toISOString().split('T')[0]}.json`;
    const cachePath = `./cache/historical_data/${cacheFileName}`;
    
    try {
      const fs = require('fs');
      const path = require('path');
      
      // Créer le répertoire s'il n'existe pas
      const cacheDir = path.dirname(cachePath);
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      
      // Écrire les données dans le fichier
      fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
      this.logger.debug(`Données historiques sauvegardées dans ${cachePath}`);
    } catch (error) {
      this.logger.warn(`Erreur lors de la sauvegarde des données dans le cache:`, error as Error);
    }
  }

  /**
   * Charge les données historiques depuis une API externe
   */
  private async loadFromApi(config: BacktestConfig): Promise<MarketData[] | null> {
    // Déterminer l'API à utiliser en fonction de la paire de trading
    const apiEndpoint = this.determineApiEndpoint(config.symbol);
    
    if (!apiEndpoint) {
      this.logger.warn(`Pas d'API disponible pour ${config.symbol}`);
      return null;
    }
    
    try {
      // Préparer les paramètres de la requête
      const params = new URLSearchParams({
        symbol: config.symbol,
        interval: this.mapResolutionToApiInterval(config.dataResolution),
        startTime: config.startDate.getTime().toString(),
        endTime: config.endDate.getTime().toString(),
        limit: '1000' // Certaines APIs ont une limite de points par requête
      });
      
      const url = `${apiEndpoint}?${params.toString()}`;
      this.logger.debug(`Requête API: ${url}`);
      
      // Effectuer la requête HTTP
      const axios = require('axios');
      const response = await axios.get(url);
      
      if (response.status !== 200) {
        throw new Error(`Erreur HTTP: ${response.status} ${response.statusText}`);
      }
      
      // Transformer les données au format MarketData
      const marketData = this.transformApiResponseToMarketData(response.data, config.symbol);
      return marketData;
    } catch (error) {
      this.logger.error(`Erreur lors de la requête API:`, error as Error);
      return null;
    }
  }
  
  /**
   * Détermine l'endpoint API approprié pour une paire de trading
   */
  private determineApiEndpoint(symbol: string): string | null {
    // Mapping des symboles vers les APIs
    const apiMapping: Record<string, string> = {
      'BTC/USDT': 'https://api.binance.com/api/v3/klines',
      'ETH/USDT': 'https://api.binance.com/api/v3/klines',
      'default': 'https://api.binance.com/api/v3/klines'
    };
    
    return apiMapping[symbol] || apiMapping['default'];
  }
  
  /**
   * Transforme les intervalles internes en format d'API
   */
  private mapResolutionToApiInterval(resolution: string): string {
    const mapping: Record<string, string> = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1h',
      '4h': '4h',
      '1d': '1d',
      'default': '1h'
    };
    
    return mapping[resolution] || mapping['default'];
  }
  
  /**
   * Transforme les données de l'API en MarketData
   */
  private transformApiResponseToMarketData(apiData: any, symbol: string): MarketData[] {
    // Format des données de Binance:
    // [
    //   [
    //     1499040000000,      // Open time
    //     "0.01634790",       // Open
    //     "0.80000000",       // High
    //     "0.01575800",       // Low
    //     "0.01577100",       // Close
    //     "148976.11427815",  // Volume
    //     ...
    //   ]
    // ]
    
    return apiData.map((item: any[]) => ({
      symbol,
      timestamp: item[0], // timestamp
      price: parseFloat(item[4]), // close price
      volume: parseFloat(item[5]), // volume
      bid: parseFloat(item[4]) * 0.9999, // approximation
      ask: parseFloat(item[4]) * 1.0001, // approximation
      indicators: {} // Pas d'indicateurs pour l'instant
    }));
  }
  
  /**
   * Génère des données de marché synthétiques pour le backtest
   */
  private generateSyntheticData(config: BacktestConfig): MarketData[] {
    this.logger.info(`Génération de données synthétiques pour ${config.symbol}`);
    
    const result: MarketData[] = [];
    const startTime = config.startDate.getTime();
    const endTime = config.endDate.getTime();
    
    // Déterminer l'intervalle de temps entre chaque point
    const intervalMap: Record<string, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };
    const timeInterval = intervalMap[config.dataResolution] || intervalMap['1h'];
    
    // Paramètres pour le générateur de prix
    const initialPrice = 100; // Prix initial
    const volatility = 0.02; // Volatilité journalière (2%)
    const trend = 0.0001; // Tendance haussière légère
    
    let currentPrice = initialPrice;
    let currentTime = startTime;
    
    // Générer des données pour chaque intervalle de temps
    while (currentTime <= endTime) {
      // Sauter les weekends si configuré ainsi
      const date = new Date(currentTime);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6; // 0 = dimanche, 6 = samedi
      
      if (!config.includeWeekends && isWeekend) {
        currentTime += timeInterval;
        continue;
      }
      
      // Générer le prochain prix avec mouvement aléatoire + tendance
      const randomChange = (Math.random() - 0.5) * 2 * volatility * currentPrice;
      const trendChange = currentPrice * trend;
      currentPrice = Math.max(0.01, currentPrice + randomChange + trendChange);
      
      // Générer le volume avec variation aléatoire
      const volume = 1000 + Math.random() * 9000;
      
      // Créer le point de données
      result.push({
        symbol: config.symbol,
        timestamp: currentTime,
        price: currentPrice,
        volume,
        bid: currentPrice * 0.9995,
        ask: currentPrice * 1.0005,
        indicators: {}
      });
      
      currentTime += timeInterval;
    }
    
    this.logger.info(`${result.length} points de données synthétiques générés`);
    return result;
  }
  
  /**
   * Prétraite les données historiques (filtrage, normalisation, etc.)
   */
  private preprocessHistoricalData(data: MarketData[], config: BacktestConfig): MarketData[] {
    // Trier par timestamp croissant
    const sortedData = [...data].sort((a, b) => a.timestamp - b.timestamp);
    
    // Filtrer les données en dehors de la plage temporelle
    const startTime = config.startDate.getTime();
    const endTime = config.endDate.getTime();
    
    const filteredData = sortedData.filter(
      item => item.timestamp >= startTime && item.timestamp <= endTime
    );
    
    // Filtrer les weekends si nécessaire
    const weekendFilteredData = config.includeWeekends
      ? filteredData
      : filteredData.filter(item => {
          const date = new Date(item.timestamp);
          return date.getDay() !== 0 && date.getDay() !== 6; // 0 = dimanche, 6 = samedi
        });
    
    this.logger.info(`Prétraitement terminé: ${weekendFilteredData.length} points de données utilisables`);
    return weekendFilteredData;
  }
  
  /**
   * Initialise les métriques par défaut
   */
  private initializeMetrics(): BacktestMetrics {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      breakEvenTrades: 0,
      winRate: 0,
      averageWin: 0,
      averageLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      maxDrawdownPercentage: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      averageHoldingTime: 0
    };
  }
  
  /**
   * Vérifie si le stop loss est déclenché
   */
  private checkStopLoss(position: BacktestTrade, data: MarketData, config: BacktestConfig): boolean {
    if (!config.enableStopLoss || !config.stopLossPercentage) {
      return false;
    }
    
    const stopLossThreshold = config.stopLossPercentage / 100;
    
    if (position.direction === 'long') {
      const lossPercentage = (position.entryPrice - data.price) / position.entryPrice;
      return lossPercentage >= stopLossThreshold;
    } else { // short
      const lossPercentage = (data.price - position.entryPrice) / position.entryPrice;
      return lossPercentage >= stopLossThreshold;
    }
  }
  
  /**
   * Vérifie si le take profit est déclenché
   */
  private checkTakeProfit(position: BacktestTrade, data: MarketData, config: BacktestConfig): boolean {
    if (!config.enableTakeProfit || !config.takeProfitPercentage) {
      return false;
    }
    
    const takeProfitThreshold = config.takeProfitPercentage / 100;
    
    if (position.direction === 'long') {
      const profitPercentage = (data.price - position.entryPrice) / position.entryPrice;
      return profitPercentage >= takeProfitThreshold;
    } else { // short
      const profitPercentage = (position.entryPrice - data.price) / position.entryPrice;
      return profitPercentage >= takeProfitThreshold;
    }
  }
  
  /**
   * Ouvre une nouvelle position
   */
  private openPosition(direction: 'long' | 'short', data: MarketData, config: BacktestConfig): BacktestTrade {
    const price = data.price;
    const quantity = this.calculatePositionSize(config.initialBalance, price);
    const fees = this.calculateFees(price, quantity, config.tradingFees);
    
    return {
      id: `trade_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      entryDate: new Date(data.timestamp),
      entryPrice: price,
      exitDate: null,
      exitPrice: null,
      quantity,
      direction,
      profit: 0,
      profitPercentage: 0,
      status: 'open',
      fees
    };
  }
  
  /**
   * Ferme une position existante
   */
  private closePosition(
    position: BacktestTrade, 
    data: MarketData, 
    config: BacktestConfig,
    reason: string
  ): BacktestTrade {
    const exitPrice = data.price;
    const exitFees = this.calculateFees(exitPrice, position.quantity, config.tradingFees);
    
    let profit = 0;
    if (position.direction === 'long') {
      profit = (exitPrice - position.entryPrice) * position.quantity;
    } else { // short
      profit = (position.entryPrice - exitPrice) * position.quantity;
    }
    
    const profitPercentage = (profit / (position.entryPrice * position.quantity)) * 100;
    
    return {
      ...position,
      exitDate: new Date(data.timestamp),
      exitPrice,
      profit,
      profitPercentage,
      status: 'closed',
      fees: position.fees + exitFees
    };
  }
  
  /**
   * Calcule la taille de la position en fonction du capital disponible
   */
  private calculatePositionSize(balance: number, price: number): number {
    // Utiliser 90% du capital pour laisser une marge pour les frais
    const allocatedCapital = balance * 0.9;
    return allocatedCapital / price;
  }
  
  /**
   * Calcule les frais de trading
   */
  private calculateFees(price: number, quantity: number, feeRate: number): number {
    const tradeValue = price * quantity;
    return tradeValue * (feeRate / 100);
  }
  
  /**
   * Calcule les métriques finales du backtest
   */
  private calculateMetrics(trades: BacktestTrade[], config: BacktestConfig, maxDrawdown: number): BacktestMetrics {
    const closedTrades = trades.filter(t => t.status === 'closed');
    const totalTrades = closedTrades.length;
    
    if (totalTrades === 0) {
      return this.initializeMetrics();
    }
    
    const winningTrades = closedTrades.filter(t => t.profit > 0);
    const losingTrades = closedTrades.filter(t => t.profit < 0);
    const breakEvenTrades = closedTrades.filter(t => t.profit === 0);
    
    const totalWins = winningTrades.reduce((sum, t) => sum + t.profit, 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.profit, 0));
    
    const holdingTimes = closedTrades.map(t => 
      t.exitDate && t.entryDate ? t.exitDate.getTime() - t.entryDate.getTime() : 0
    );
    
    const metrics: BacktestMetrics = {
      totalTrades,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      breakEvenTrades: breakEvenTrades.length,
      winRate: winningTrades.length / totalTrades,
      averageWin: winningTrades.length > 0 ? totalWins / winningTrades.length : 0,
      averageLoss: losingTrades.length > 0 ? totalLosses / losingTrades.length : 0,
      largestWin: winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.profit)) : 0,
      largestLoss: losingTrades.length > 0 ? Math.min(...losingTrades.map(t => t.profit)) : 0,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
      maxDrawdown,
      maxDrawdownPercentage: (maxDrawdown / config.initialBalance) * 100,
      sharpeRatio: this.calculateSharpeRatio(closedTrades),
      sortinoRatio: this.calculateSortinoRatio(closedTrades),
      averageHoldingTime: holdingTimes.length > 0 ? holdingTimes.reduce((a, b) => a + b, 0) / holdingTimes.length : 0
    };
    
    return metrics;
  }
  
  /**
   * Calcule le ratio de Sharpe (mesure de performance ajustée au risque)
   */
  private calculateSharpeRatio(trades: BacktestTrade[]): number {
    if (trades.length < 2) return 0;
    
    const returns = trades.map(t => t.profitPercentage / 100);
    const averageReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    
    const squaredDeviations = returns.map(r => Math.pow(r - averageReturn, 2));
    const variance = squaredDeviations.reduce((a, b) => a + b, 0) / (returns.length - 1);
    const stdDev = Math.sqrt(variance);
    
    // Taux sans risque (hypothétique)
    const riskFreeRate = 0.02 / 252; // 2% annuel divisé par jours de trading
    
    return stdDev > 0 ? (averageReturn - riskFreeRate) / stdDev : 0;
  }
  
  /**
   * Calcule le ratio de Sortino (similaire à Sharpe mais ne pénalise que la volatilité négative)
   */
  private calculateSortinoRatio(trades: BacktestTrade[]): number {
    if (trades.length < 2) return 0;
    
    const returns = trades.map(t => t.profitPercentage / 100);
    const averageReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    
    // Taux sans risque (hypothétique)
    const riskFreeRate = 0.02 / 252; // 2% annuel divisé par jours de trading
    
    // Calculer la volatilité négative uniquement
    const negativeReturns = returns.filter(r => r < 0);
    
    if (negativeReturns.length === 0) return averageReturn > 0 ? Infinity : 0;
    
    const squaredNegativeDeviations = negativeReturns.map(r => Math.pow(r, 2));
    const downVariance = squaredNegativeDeviations.reduce((a, b) => a + b, 0) / negativeReturns.length;
    const downDev = Math.sqrt(downVariance);
    
    return downDev > 0 ? (averageReturn - riskFreeRate) / downDev : 0;
  }
}
