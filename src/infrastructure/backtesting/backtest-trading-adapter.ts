import { TradingPort } from "../../application/ports/trading.port";
import { Order, OrderParams, OrderSide, OrderStatus, OrderType } from "../../domain/models/market.model";
import { getLogger } from "../logger";
import { BacktestResults, BacktestTrade, BacktestTradingOptions } from "./backtest-models";
import * as crypto from 'crypto';

/**
 * Adaptateur pour simuler l'exécution des ordres pendant le backtesting
 */
export class BacktestTradingAdapter {
  private logger = getLogger();
  private config: BacktestTradingOptions;
  private currentTimestamp: number = Date.now();
  private accountBalance: Record<string, number> = { 'USDC': 0 };
  private openOrders: Order[] = [];
  private orderHistory: Order[] = [];
  private openPositions: Map<string, { size: number, entryPrice: number, direction: 'long' | 'short', entryTime: number }> = new Map();
  private trades: BacktestTrade[] = [];
  private idCounter = 1;
  
  constructor(config: BacktestTradingOptions) {
    this.config = config;
    this.accountBalance['USDC'] = config.initialBalance;
    this.logger.info(`[BACKTEST] Initialized trading adapter with balance: $${config.initialBalance.toFixed(2)}`);
  }
  
  /**
   * Helper to normalize and extract base symbol 
   */
  private normalizeSymbol(symbol: string): string {
    // Handle both formats: "BTC-USD" and "BTC_USD" -> "BTC"
    return symbol.split(/[-_]/)[0];
  }
  
  /**
   * Met à jour l'horodatage actuel de la simulation
   */
  public setCurrentTimestamp(timestamp: number): void {
    this.currentTimestamp = timestamp;
  }
  
  /**
   * Crée et retourne un port de trading pour le backtesting
   */
  public getTradingPort(): TradingPort {
    return {
      /**
       * Place un ordre simulé
       */
      placeOrder: async (orderParams: OrderParams): Promise<Order> => {
        const executionDelay = this.config.executionDelay || 0;
        
        // Simuler le rejet d'ordre selon la probabilité configurée
        if (this.config.rejectionProbability && this.config.rejectionProbability > 0) {
          if (Math.random() < this.config.rejectionProbability) {
            throw new Error(`Order rejected (simulated rejection for ${orderParams.symbol})`);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, executionDelay));
        
        // Créer l'ordre
        const order: Order = {
          ...orderParams,
          id: `backtest-${this.idCounter++}`,
          status: OrderStatus.OPEN,
          createdAt: this.currentTimestamp,
          updatedAt: this.currentTimestamp,
          filledSize: 0
        };
        
        this.logger.debug(`[BACKTEST] Order placed: ${order.id} for ${order.symbol} ${order.side} ${order.size}`);
        
        // Pour les ordres au marché, exécuter immédiatement
        if (order.type === OrderType.MARKET) {
          await this.executeOrder(order);
        } else {
          // Pour les ordres limites, ajouter à la liste des ordres ouverts
          this.openOrders.push(order);
        }
        
        return order;
      },
      
      /**
       * Annule un ordre simulé
       */
      cancelOrder: async (orderId: string): Promise<boolean> => {
        const orderIndex = this.openOrders.findIndex(order => order.id === orderId);
        if (orderIndex === -1) {
          return false;
        }
        
        const order = this.openOrders[orderIndex];
        order.status = OrderStatus.CANCELED;
        order.updatedAt = this.currentTimestamp;
        
        // Retirer l'ordre de la liste des ordres ouverts
        this.openOrders.splice(orderIndex, 1);
        this.orderHistory.push(order);
        
        this.logger.debug(`[BACKTEST] Order canceled: ${orderId}`);
        
        return true;
      },
      
      /**
       * Récupère un ordre par son ID
       */
      getOrder: async (orderId: string): Promise<Order | null> => {
        const order = this.openOrders.find(o => o.id === orderId) || 
                     this.orderHistory.find(o => o.id === orderId);
                     
        return order || null;
      },
      
      /**
       * Récupère tous les ordres ouverts
       */
      getOpenOrders: async (symbol?: string): Promise<Order[]> => {
        if (symbol) {
          return this.openOrders.filter(o => o.symbol === symbol);
        }
        return [...this.openOrders];
      },
      
      /**
       * Récupère le solde du compte
       */
      getAccountBalance: async (): Promise<Record<string, number>> => {
        return { ...this.accountBalance };
      }
    };
  }
  
  /**
   * Exécute un ordre simulé
   */
  private async executeOrder(order: Order): Promise<void> {
    // Appliquer le slippage sur le prix d'exécution
    const marketPrice = order.price || 0;
    let executionPrice = marketPrice;
    
    if (this.config.slippage > 0) {
      const slippageFactor = this.config.slippage / 100;
      // Pour les achats, le slippage augmente le prix
      // Pour les ventes, le slippage réduit le prix
      executionPrice = order.side === OrderSide.BUY 
        ? marketPrice * (1 + slippageFactor)
        : marketPrice * (1 - slippageFactor);
    }
    
    // Mettre à jour l'ordre
    order.status = OrderStatus.FILLED;
    order.filledSize = order.size;
    order.avgFillPrice = executionPrice;
    order.updatedAt = this.currentTimestamp;
    
    // Calculer les frais
    const value = order.size * executionPrice;
    const fees = value * (this.config.tradingFees / 100);
    
    // Mettre à jour le solde du compte
    // Pour un achat: réduire le solde USDC
    // Pour une vente: augmenter le solde USDC
    const symbol = this.normalizeSymbol(order.symbol); // Normalize to handle both "BTC-USD" and "BTC_USD" formats
    
    if (order.side === OrderSide.BUY) {
      const totalCost = value + fees;
      
      // Vérifier si nous avons assez de fonds
      if (this.accountBalance['USDC'] < totalCost) {
        this.logger.warn(`[BACKTEST] Insufficient funds for ${order.symbol} order: $${totalCost.toFixed(2)} required, $${this.accountBalance['USDC'].toFixed(2)} available`);
        order.status = OrderStatus.REJECTED;
        return;
      }
      
      // Débiter USDC
      this.accountBalance['USDC'] -= totalCost;
      
      // Créditer l'actif acheté
      if (!this.accountBalance[symbol]) {
        this.accountBalance[symbol] = 0;
      }
      this.accountBalance[symbol] += order.size;
      
      // Mettre à jour ou créer une position
      this.updatePosition(order, executionPrice, 'long');
      
    } else if (order.side === OrderSide.SELL) {
      // Vérifier si nous avons assez de l'actif pour vendre
      if (!this.accountBalance[symbol] || this.accountBalance[symbol] < order.size) {
        this.logger.warn(`[BACKTEST] Insufficient ${symbol} for sell order: ${order.size} required, ${this.accountBalance[symbol] || 0} available`);
        order.status = OrderStatus.REJECTED;
        return;
      }
      
      // Débiter l'actif vendu
      this.accountBalance[symbol] -= order.size;
      
      // Créditer USDC (moins les frais)
      const netValue = value - fees;
      this.accountBalance['USDC'] += netValue;
      
      // Mettre à jour ou créer une position
      this.updatePosition(order, executionPrice, 'short');
    }
    
    // Ajouter à l'historique des ordres
    this.orderHistory.push(order);
    
    this.logger.debug(`[BACKTEST] Order executed: ${order.id} for ${order.symbol} ${order.side} ${order.size} @ ${executionPrice.toFixed(6)} with fees: $${fees.toFixed(2)}`);
  }
  
  /**
   * Met à jour une position après l'exécution d'un ordre
   */
  private updatePosition(order: Order, executionPrice: number, direction: 'long' | 'short'): void {
    const existingPosition = this.openPositions.get(order.symbol);
    
    if (direction === 'long') {
      // Ouvrir une nouvelle position longue ou augmenter une existante
      if (!existingPosition) {
        this.openPositions.set(order.symbol, {
          size: order.size,
          entryPrice: executionPrice,
          direction,
          entryTime: this.currentTimestamp
        });
        
        // Enregistrer un nouveau trade
        this.recordTrade({
          id: crypto.randomUUID(),
          symbol: order.symbol,
          strategyId: order.clientId ? `strategy-${order.clientId}` : 'default',
          direction,
          size: order.size,
          entryPrice: executionPrice,
          entryTime: this.currentTimestamp,
          profit: 0,
          profitPercentage: 0,
          fees: executionPrice * order.size * (this.config.tradingFees / 100)
        });
      } else if (existingPosition.direction === 'long') {
        // Augmenter la position longue existante (moyenne du prix d'entrée)
        const totalValue = (existingPosition.size * existingPosition.entryPrice) + (order.size * executionPrice);
        const newSize = existingPosition.size + order.size;
        const averagePrice = totalValue / newSize;
        
        existingPosition.size = newSize;
        existingPosition.entryPrice = averagePrice;
        
        // Mise à jour du dernier trade pour cette position
        const lastTrade = this.trades.findLast(t => t.symbol === order.symbol && !t.exitPrice);
        if (lastTrade) {
          lastTrade.size = newSize;
          lastTrade.entryPrice = averagePrice;
          lastTrade.fees += executionPrice * order.size * (this.config.tradingFees / 100);
        }
      } else {
        // Réduire ou fermer une position courte existante
        this.closePosition(order, executionPrice, 'signal');
      }
    } else {
      // Ouvrir une nouvelle position courte ou augmenter une existante
      if (!existingPosition) {
        this.openPositions.set(order.symbol, {
          size: order.size,
          entryPrice: executionPrice,
          direction,
          entryTime: this.currentTimestamp
        });
        
        // Enregistrer un nouveau trade
        this.recordTrade({
          id: crypto.randomUUID(),
          symbol: order.symbol,
          strategyId: order.clientId ? `strategy-${order.clientId}` : 'default',
          direction,
          size: order.size,
          entryPrice: executionPrice,
          entryTime: this.currentTimestamp,
          profit: 0,
          profitPercentage: 0,
          fees: executionPrice * order.size * (this.config.tradingFees / 100)
        });
      } else if (existingPosition.direction === 'short') {
        // Augmenter la position courte existante (moyenne du prix d'entrée)
        const totalValue = (existingPosition.size * existingPosition.entryPrice) + (order.size * executionPrice);
        const newSize = existingPosition.size + order.size;
        const averagePrice = totalValue / newSize;
        
        existingPosition.size = newSize;
        existingPosition.entryPrice = averagePrice;
        
        // Mise à jour du dernier trade pour cette position
        const lastTrade = this.trades.findLast(t => t.symbol === order.symbol && !t.exitPrice);
        if (lastTrade) {
          lastTrade.size = newSize;
          lastTrade.entryPrice = averagePrice;
          lastTrade.fees += executionPrice * order.size * (this.config.tradingFees / 100);
        }
      } else {
        // Réduire ou fermer une position longue existante
        this.closePosition(order, executionPrice, 'signal');
      }
    }
  }
  
  /**
   * Ferme une position existante
   */
  private closePosition(order: Order, executionPrice: number, reason: BacktestTrade['exitReason']): void {
    const position = this.openPositions.get(order.symbol);
    if (!position) return;
    
    // Calculer le profit/perte
    let profit = 0;
    if (position.direction === 'long') {
      // Pour une position longue: profit = (prix de sortie - prix d'entrée) * taille
      profit = (executionPrice - position.entryPrice) * Math.min(position.size, order.size);
    } else {
      // Pour une position courte: profit = (prix d'entrée - prix de sortie) * taille
      profit = (position.entryPrice - executionPrice) * Math.min(position.size, order.size);
    }
    
    // Calculer le pourcentage de profit
    const profitPercentage = (profit / (position.entryPrice * Math.min(position.size, order.size))) * 100;
    
    // Mettre à jour le trade correspondant
    const openTrade = this.trades.find(t => 
      t.symbol === order.symbol && 
      t.direction === position.direction &&
      !t.exitPrice);
    
    if (openTrade) {
      openTrade.exitPrice = executionPrice;
      openTrade.exitTime = this.currentTimestamp;
      openTrade.profit = profit;
      openTrade.profitPercentage = profitPercentage;
      openTrade.exitReason = reason;
      
      // Ajouter les frais de sortie
      openTrade.fees += executionPrice * Math.min(position.size, order.size) * (this.config.tradingFees / 100);
    }
    
    // Si l'ordre ferme complètement la position
    if (order.size >= position.size) {
      this.openPositions.delete(order.symbol);
    } else {
      // Sinon, réduire la taille de la position
      position.size -= order.size;
    }
  }
  
  /**
   * Enregistre un nouveau trade
   */
  private recordTrade(trade: BacktestTrade): void {
    this.trades.push(trade);
  }
  
  /**
   * Ferme toutes les positions ouvertes à la fin du backtest
   */
  public closeAllPositions(): void {
    if (this.openPositions.size === 0) {
      this.logger.info(`[BACKTEST] No open positions to close at end of backtest`);
      return;
    }
    
    this.logger.info(`[BACKTEST] Closing ${this.openPositions.size} positions at end of backtest`);
    
    for (const [symbol, position] of this.openPositions.entries()) {
      // Obtenir le dernier prix connu pour ce symbole (ou utiliser le prix d'entrée si pas de prix récent)
      let exitPrice = position.entryPrice; // Prix par défaut
      
      // Utiliser le dernier prix connu si disponible
      const latestOrders = this.orderHistory
        .filter(o => o.symbol === symbol && o.status === OrderStatus.FILLED)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      
      if (latestOrders.length > 0 && latestOrders[0].avgFillPrice) {
        exitPrice = latestOrders[0].avgFillPrice;
      }
      
      // Créer un ordre simulé pour fermer la position
      const simulatedOrder: Order = {
        id: `backtest-close-${this.idCounter++}`,
        symbol,
        side: position.direction === 'long' ? OrderSide.SELL : OrderSide.BUY,
        type: OrderType.MARKET,
        size: position.size,
        status: OrderStatus.FILLED,
        createdAt: this.currentTimestamp,
        updatedAt: this.currentTimestamp,
        filledSize: position.size,
        avgFillPrice: exitPrice,
      };
      
      this.logger.debug(`[BACKTEST] Closing position for ${symbol}: ${position.direction} ${position.size} @ ${exitPrice}`);
      
      // Fermer la position avec une raison "end-of-backtest"
      this.closePosition(simulatedOrder, exitPrice, 'end-of-backtest');
    }
    
    this.openPositions.clear();
    this.logger.info(`[BACKTEST] All positions closed at end of backtest`);
  }
  
  /**
   * Traite les ordres limites en fonction du prix actuel
   */
  public processLimitOrders(currentPrice: number, symbol: string): void {
    const ordersToProcess = this.openOrders.filter(o => o.symbol === symbol && o.type === OrderType.LIMIT);
    
    for (const order of ordersToProcess) {
      if (!order.price) continue;
      
      // Vérifier si l'ordre limite doit être exécuté
      let shouldExecute = false;
      
      if (order.side === OrderSide.BUY && currentPrice <= order.price) {
        // Pour un ordre d'achat, exécuter si le prix courant est inférieur ou égal au prix limite
        shouldExecute = true;
      } else if (order.side === OrderSide.SELL && currentPrice >= order.price) {
        // Pour un ordre de vente, exécuter si le prix courant est supérieur ou égal au prix limite
        shouldExecute = true;
      }
      
      if (shouldExecute) {
        // Définir le prix d'exécution avec le prix limite
        order.price = currentPrice;
        
        // Retirer de la liste des ordres ouverts
        const index = this.openOrders.indexOf(order);
        if (index !== -1) {
          this.openOrders.splice(index, 1);
        }
        
        // Exécuter l'ordre
        this.executeOrder(order);
      }
    }
  }
  
  /**
   * Vérifie si des ordres limites peuvent être exécutés avec le nouveau prix du marché
   */
  public async checkLimitOrders(marketData: { symbol: string, price: number }): Promise<void> {
    if (this.openOrders.length === 0) return;
    
    // Filtrer les ordres pour ce symbole
    const ordersForSymbol = this.openOrders.filter(order => order.symbol === marketData.symbol);
    if (ordersForSymbol.length === 0) return;

    this.logger.debug(`[BACKTEST] Checking ${ordersForSymbol.length} limit orders for ${marketData.symbol} @ ${marketData.price}`);
    
    // Vérifier chaque ordre
    for (let i = ordersForSymbol.length - 1; i >= 0; i--) {
      const order = ordersForSymbol[i];
      
      let shouldExecute = false;
      
      // Pour un ordre d'achat, exécuter si le prix est <= prix limite
      if (order.side === OrderSide.BUY && marketData.price <= order.price!) {
        shouldExecute = true;
      }
      // Pour un ordre de vente, exécuter si le prix est >= prix limite
      else if (order.side === OrderSide.SELL && marketData.price >= order.price!) {
        shouldExecute = true;
      }
      
      if (shouldExecute) {
        // Retirer de la liste des ordres ouverts
        const orderIndex = this.openOrders.findIndex(o => o.id === order.id);
        if (orderIndex !== -1) {
          this.openOrders.splice(orderIndex, 1);
        }
        
        // Modifier l'ordre pour utiliser le prix du marché
        order.avgFillPrice = marketData.price;
        // Exécuter l'ordre
        await this.executeOrder(order);
      }
    }
  }

  /**
   * Génère les résultats finaux du backtest
   */
  public getResults(): BacktestResults {
    // Calculer les statistiques
    const closedTrades = this.trades.filter(t => t.exitPrice !== undefined);
    const winningTrades = closedTrades.filter(t => t.profit > 0);
    const losingTrades = closedTrades.filter(t => t.profit < 0);
    
    const initialBalance = this.config.initialBalance;
    const finalBalance = this.accountBalance['USDC'];
    const profit = finalBalance - initialBalance;
    const profitPercentage = (profit / initialBalance) * 100;
    
    this.logger.info(`[BACKTEST] Final results: ${closedTrades.length} trades, profit: ${profit.toFixed(2)} (${profitPercentage.toFixed(2)}%), winning trades: ${winningTrades.length}, losing trades: ${losingTrades.length}`);
    
    const largestWin = winningTrades.length > 0 
      ? Math.max(...winningTrades.map(t => t.profit))
      : 0;
    
    const largestLoss = losingTrades.length > 0
      ? Math.min(...losingTrades.map(t => t.profit))
      : 0;
    
    const averageWin = winningTrades.length > 0 
      ? winningTrades.reduce((sum, t) => sum + t.profit, 0) / winningTrades.length 
      : 0;
    
    const averageLoss = losingTrades.length > 0
      ? losingTrades.reduce((sum, t) => sum + t.profit, 0) / losingTrades.length
      : 0;
    
    const totalGain = winningTrades.reduce((sum, t) => sum + t.profit, 0);
    const totalLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.profit, 0));
    const profitFactor = totalLoss > 0 ? totalGain / totalLoss : totalGain > 0 ? Infinity : 0;
    
    // Calculer le drawdown maximum
    let maxBalance = initialBalance;
    let currentDrawdown = 0;
    let maxDrawdown = 0;
    let maxDrawdownPercentage = 0;
    
    // Trier les trades par date d'exécution
    const sortedTrades = [...closedTrades].sort((a, b) => a.entryTime - b.entryTime);
    let runningBalance = initialBalance;
    
    if (sortedTrades.length > 0) {
      this.logger.debug(`[BACKTEST] Calculating drawdown for ${sortedTrades.length} trades`);
      
      for (const trade of sortedTrades) {
        if (trade.exitTime) {
          runningBalance += trade.profit;
          
          if (runningBalance > maxBalance) {
            maxBalance = runningBalance;
            currentDrawdown = 0;
          } else {
            currentDrawdown = maxBalance - runningBalance;
            const currentDrawdownPercentage = (currentDrawdown / maxBalance) * 100;
            
            if (currentDrawdown > maxDrawdown) {
              maxDrawdown = currentDrawdown;
              maxDrawdownPercentage = currentDrawdownPercentage;
            }
          }
        }
      }
    }
    
    // Calculer l'exposition moyenne au marché
    let totalExposureDuration = 0;
    const totalDuration = closedTrades.length > 1 && closedTrades[closedTrades.length - 1]?.exitTime && closedTrades[0]?.entryTime
      ? closedTrades[closedTrades.length - 1].exitTime - closedTrades[0].entryTime
      : 0;
      
    for (const trade of closedTrades) {
      if (trade.exitTime) {
        totalExposureDuration += (trade.exitTime - trade.entryTime);
      }
    }
    
    const averageExposure = totalDuration > 0 
      ? (totalExposureDuration / totalDuration) * 100
      : 0;
    
    // Calculer les performances par stratégie
    const strategyPerformance: Record<string, any> = {};
    
    if (closedTrades.length > 0) {
      this.logger.debug(`[BACKTEST] Calculating strategy performance for ${closedTrades.length} trades`);
      
      for (const trade of closedTrades) {
        if (!strategyPerformance[trade.strategyId]) {
          strategyPerformance[trade.strategyId] = {
            trades: 0,
            winningTrades: 0,
            losingTrades: 0,
            profit: 0,
            profitFactor: 0
          };
        }
        
        strategyPerformance[trade.strategyId].trades++;
        
        if (trade.profit > 0) {
          strategyPerformance[trade.strategyId].winningTrades++;
        } else if (trade.profit < 0) {
          strategyPerformance[trade.strategyId].losingTrades++;
        }
        
        strategyPerformance[trade.strategyId].profit += trade.profit;
      }
      
      // Calculer le taux de réussite et le facteur de profit par stratégie
      for (const strategyId in strategyPerformance) {
        const stats = strategyPerformance[strategyId];
        stats.winRate = stats.trades > 0 ? (stats.winningTrades / stats.trades) * 100 : 0;
        
        const strategyTrades = closedTrades.filter(t => t.strategyId === strategyId);
        const strategyWinning = strategyTrades.filter(t => t.profit > 0);
        const strategyLosing = strategyTrades.filter(t => t.profit < 0);
        
        const strategyTotalGain = strategyWinning.reduce((sum, t) => sum + t.profit, 0);
        const strategyTotalLoss = Math.abs(strategyLosing.reduce((sum, t) => sum + t.profit, 0));
        
        stats.profitFactor = strategyTotalLoss > 0
          ? strategyTotalGain / strategyTotalLoss
          : strategyTotalGain > 0 ? Infinity : 0;
        
        this.logger.debug(`[BACKTEST] Strategy ${strategyId}: ${stats.trades} trades, profit: ${stats.profit.toFixed(2)}, win rate: ${stats.winRate.toFixed(2)}%, profit factor: ${stats.profitFactor.toFixed(2)}`);
      }
    } else {
      this.logger.warn(`[BACKTEST] No closed trades to calculate strategy performance`);
    }
    
    // Retourner les résultats complets
    return {
      initialBalance,
      finalBalance,
      profit,
      profitPercentage,
      trades: this.trades,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0,
      largestWin,
      largestLoss,
      averageWin,
      averageLoss,
      profitFactor,
      maxDrawdown,
      maxDrawdownPercentage,
      averageExposure,
      strategyPerformance
    };
  }
}
