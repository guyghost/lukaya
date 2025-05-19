/**
 * Utilitaire pour la gestion des métriques et des statistiques
 */
import { getLogger } from './logger';

export class TradingMetrics {
  private static instance: TradingMetrics;
  private logger = getLogger();
  
  // Statistiques en temps réel
  private stats = {
    ordersPlaced: 0,
    ordersFilled: 0,
    ordersRejected: 0,
    takeProfitsTriggered: 0,
    stopLossesTriggered: 0,
    totalProfitUSD: 0,
    totalLossUSD: 0,
    startTime: Date.now(),
    lastSnapshot: Date.now()
  };
  
  // Statistiques par symbole
  private symbolStats: Record<string, {
    tradesCount: number;
    winCount: number;
    lossCount: number;
    totalProfitUSD: number;
    totalLossUSD: number;
    lastPrice: number;
    priceHigh24h: number;
    priceLow24h: number;
    volume24h: number;
  }> = {};
  
  private constructor() {
    // Initialisation des métriques
    this.schedulePeriodicReport();
  }
  
  public static getInstance(): TradingMetrics {
    if (!TradingMetrics.instance) {
      TradingMetrics.instance = new TradingMetrics();
    }
    return TradingMetrics.instance;
  }
  
  /**
   * Enregistre un ordre placé
   */
  public recordOrderPlaced(symbol: string, side: string, size: number, price: number): void {
    this.stats.ordersPlaced++;
    this.ensureSymbolStats(symbol);
    this.updateLastPrice(symbol, price);
    this.logger.debug(`[METRICS] Order placed: ${symbol} ${side} ${size} @ ${price}`);
  }
  
  /**
   * Enregistre un ordre exécuté
   */
  public recordOrderFilled(symbol: string, side: string, size: number, price: number, profitUSD?: number): void {
    this.stats.ordersFilled++;
    this.ensureSymbolStats(symbol);
    this.updateLastPrice(symbol, price);
    
    // Si c'est une clôture de position avec profit/perte
    if (profitUSD !== undefined) {
      if (profitUSD >= 0) {
        this.stats.totalProfitUSD += profitUSD;
        this.symbolStats[symbol].totalProfitUSD += profitUSD;
        this.symbolStats[symbol].winCount++;
        this.stats.takeProfitsTriggered++;
      } else {
        this.stats.totalLossUSD += Math.abs(profitUSD);
        this.symbolStats[symbol].totalLossUSD += Math.abs(profitUSD);
        this.symbolStats[symbol].lossCount++;
        this.stats.stopLossesTriggered++;
      }
      this.symbolStats[symbol].tradesCount++;
    }
    
    this.logger.debug(`[METRICS] Order filled: ${symbol} ${side} ${size} @ ${price}`);
  }
  
  /**
   * Enregistre un ordre rejeté
   */
  public recordOrderRejected(symbol: string, reason: string): void {
    this.stats.ordersRejected++;
    this.ensureSymbolStats(symbol);
    this.logger.debug(`[METRICS] Order rejected: ${symbol} - ${reason}`);
  }
  
  /**
   * Enregistre une mise à jour de prix
   */
  public recordPriceUpdate(symbol: string, price: number, volume?: number): void {
    this.ensureSymbolStats(symbol);
    this.updateLastPrice(symbol, price);
    
    // Mettre à jour les high/low sur 24h
    if (price > this.symbolStats[symbol].priceHigh24h) {
      this.symbolStats[symbol].priceHigh24h = price;
    }
    if (price < this.symbolStats[symbol].priceLow24h || this.symbolStats[symbol].priceLow24h === 0) {
      this.symbolStats[symbol].priceLow24h = price;
    }
    
    // Mettre à jour le volume si fourni
    if (volume !== undefined) {
      this.symbolStats[symbol].volume24h = volume;
    }
  }
  
  /**
   * Obtenir un rapport de performance
   */
  public getPerformanceReport(): any {
    const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    const uptimeSeconds = uptime % 60;
    
    const netProfit = this.stats.totalProfitUSD - this.stats.totalLossUSD;
    const winRate = this.stats.ordersFilled > 0 
      ? (this.stats.takeProfitsTriggered / this.stats.ordersFilled) * 100 
      : 0;
    
    return {
      uptime: `${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s`,
      orders: {
        placed: this.stats.ordersPlaced,
        filled: this.stats.ordersFilled,
        rejected: this.stats.ordersRejected,
      },
      trades: {
        wins: this.stats.takeProfitsTriggered,
        losses: this.stats.stopLossesTriggered,
        winRate: winRate.toFixed(2) + '%'
      },
      profit: {
        total: this.stats.totalProfitUSD.toFixed(2),
        losses: this.stats.totalLossUSD.toFixed(2),
        net: netProfit.toFixed(2)
      },
      symbols: Object.entries(this.symbolStats)
        .filter(([_, stats]) => stats.tradesCount > 0)
        .map(([symbol, stats]) => ({
          symbol,
          trades: stats.tradesCount,
          winRate: stats.tradesCount > 0 
            ? ((stats.winCount / stats.tradesCount) * 100).toFixed(2) + '%' 
            : 'N/A',
          netProfit: (stats.totalProfitUSD - stats.totalLossUSD).toFixed(2),
          lastPrice: stats.lastPrice
        }))
    };
  }
  
  /**
   * Programmez un rapport périodique des métriques
   */
  private schedulePeriodicReport(): void {
    // Générer un rapport toutes les heures
    setInterval(() => {
      const report = this.getPerformanceReport();
      this.logger.info(`[METRICS] Performance Report:`, report);
      
      // Reset certaines métriques sur 24h si nécessaire
      if (Date.now() - this.stats.lastSnapshot > 24 * 60 * 60 * 1000) {
        this.resetDaily();
      }
    }, 60 * 60 * 1000); // Toutes les heures
  }
  
  /**
   * Réinitialiser les statistiques quotidiennes
   */
  private resetDaily(): void {
    this.stats.lastSnapshot = Date.now();
    
    // Réinitialiser les high/low sur 24h
    Object.keys(this.symbolStats).forEach(symbol => {
      this.symbolStats[symbol].priceHigh24h = this.symbolStats[symbol].lastPrice;
      this.symbolStats[symbol].priceLow24h = this.symbolStats[symbol].lastPrice;
      this.symbolStats[symbol].volume24h = 0;
    });
  }
  
  /**
   * S'assurer que les statistiques pour un symbole existent
   */
  private ensureSymbolStats(symbol: string): void {
    if (!this.symbolStats[symbol]) {
      this.symbolStats[symbol] = {
        tradesCount: 0,
        winCount: 0,
        lossCount: 0,
        totalProfitUSD: 0,
        totalLossUSD: 0,
        lastPrice: 0,
        priceHigh24h: 0,
        priceLow24h: 0,
        volume24h: 0
      };
    }
  }
  
  /**
   * Mettre à jour le dernier prix pour un symbole
   */
  private updateLastPrice(symbol: string, price: number): void {
    this.symbolStats[symbol].lastPrice = price;
  }
}

/**
 * Class for tracking risk exposure metrics
 */
export class RiskExposureTracker {
  private static instance: RiskExposureTracker;
  private logger = getLogger();
  
  // Risk metrics
  private metrics = {
    totalExposure: 0,
    maxExposure: 0,
    leverageUtilization: 0,
    maxLeverageUtilization: 0,
    riskLevels: {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      EXTREME: 0
    },
    positionsAboveRisk: 0,
    activeCorrelations: {} as Record<string, string[]>,
    lastSnapshot: Date.now()
  };
  
  // Position risk tracking
  private positionRisks: Record<string, {
    symbol: string,
    size: number,
    risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME',
    leverage: number,
    correlatedWith: string[]
  }> = {};
  
  private constructor() {
    // Schedule periodic risk reports
    this.scheduleRiskReports();
  }
  
  public static getInstance(): RiskExposureTracker {
    if (!RiskExposureTracker.instance) {
      RiskExposureTracker.instance = new RiskExposureTracker();
    }
    return RiskExposureTracker.instance;
  }
  
  /**
   * Update position risk information
   */
  public updatePositionRisk(
    symbol: string, 
    size: number, 
    risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME',
    leverage: number = 1,
    correlatedWith: string[] = []
  ): void {
    this.positionRisks[symbol] = {
      symbol,
      size,
      risk,
      leverage,
      correlatedWith
    };
    
    // Update risk counts
    this.recalculateRiskMetrics();
    
    // Log if risk is high
    if (risk === 'HIGH' || risk === 'EXTREME') {
      this.logger.warn(`[RISK] Position ${symbol} has ${risk} risk level with ${leverage}x leverage`, {
        symbol,
        risk,
        leverage,
        correlations: correlatedWith.join(',')
      });
    }
  }
  
  /**
   * Remove a position from risk tracking
   */
  public removePosition(symbol: string): void {
    delete this.positionRisks[symbol];
    this.recalculateRiskMetrics();
  }
  
  /**
   * Get the current risk report
   */
  public getRiskReport(): any {
    const positionsByRisk = Object.values(this.positionRisks).reduce((acc, pos) => {
      if (!acc[pos.risk]) acc[pos.risk] = [];
      acc[pos.risk].push(pos.symbol);
      return acc;
    }, {} as Record<string, string[]>);
    
    return {
      exposure: {
        total: this.metrics.totalExposure.toFixed(2),
        max: this.metrics.maxExposure.toFixed(2),
        percent: ((this.metrics.totalExposure / this.metrics.maxExposure) * 100).toFixed(2) + '%'
      },
      leverage: {
        current: this.metrics.leverageUtilization.toFixed(2) + 'x',
        max: this.metrics.maxLeverageUtilization.toFixed(2) + 'x',
        percent: ((this.metrics.leverageUtilization / this.metrics.maxLeverageUtilization) * 100).toFixed(2) + '%'
      },
      riskLevels: this.metrics.riskLevels,
      highRiskPositions: this.metrics.positionsAboveRisk,
      positionsByRisk,
      correlationGroups: Object.entries(this.metrics.activeCorrelations)
        .map(([key, symbols]) => ({ key, symbols, count: symbols.length }))
        .filter(group => group.count > 1)
    };
  }
  
  /**
   * Recalculate all risk metrics
   */
  private recalculateRiskMetrics(): void {
    const positions = Object.values(this.positionRisks);
    
    // Reset risk counters
    this.metrics.riskLevels = {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      EXTREME: 0
    };
    
    // Count positions by risk level
    positions.forEach(pos => {
      this.metrics.riskLevels[pos.risk]++;
    });
    
    // Calculate high risk positions
    this.metrics.positionsAboveRisk = 
      this.metrics.riskLevels.HIGH + this.metrics.riskLevels.EXTREME;
    
    // Calculate total exposure
    this.metrics.totalExposure = positions.reduce((sum, pos) => sum + pos.size, 0);
    
    // Update max exposure if current is higher
    if (this.metrics.totalExposure > this.metrics.maxExposure) {
      this.metrics.maxExposure = this.metrics.totalExposure;
    }
    
    // Calculate average leverage
    const totalLeverage = positions.reduce((sum, pos) => sum + pos.leverage, 0);
    this.metrics.leverageUtilization = positions.length > 0 ? 
      totalLeverage / positions.length : 0;
    
    // Update max leverage if current is higher
    if (this.metrics.leverageUtilization > this.metrics.maxLeverageUtilization) {
      this.metrics.maxLeverageUtilization = this.metrics.leverageUtilization;
    }
    
    // Build correlation map
    const correlationMap: Record<string, string[]> = {};
    
    positions.forEach(pos => {
      pos.correlatedWith.forEach(corr => {
        if (!correlationMap[corr]) correlationMap[corr] = [];
        correlationMap[corr].push(pos.symbol);
        correlationMap[corr] = [...new Set(correlationMap[corr])]; // Deduplicate
      });
    });
    
    this.metrics.activeCorrelations = correlationMap;
  }
  
  /**
   * Schedule periodic risk reports
   */
  private scheduleRiskReports(): void {
    // Generate report every 30 minutes
    setInterval(() => {
      const report = this.getRiskReport();
      this.logger.info(`[RISK] Exposure Report:`, report);
    }, 30 * 60 * 1000);
  }
}

// Exporter des instances singleton
export const metrics = TradingMetrics.getInstance();
export const riskTracker = RiskExposureTracker.getInstance();
