import { ActorContext, ActorMessage, ActorDefinition } from "../../../actor/models/actor.model";
import { 
  RiskManagerMessage, 
  RiskManagerState, 
  RiskManagerConfig,
  RiskAssessmentResult,
  PositionRisk,
  AccountRisk,
  RiskLevel,
  PositionViabilityResult
} from "./risk-manager.model";
import { OrderParams, OrderSide, Order } from "../../../domain/models/market.model";
import { createContextualLogger } from "../../../infrastructure/logging/enhanced-logger";
import { TradingPort } from "../../ports/trading.port";

// Create a definition for the risk manager actor
export const createRiskManagerActorDefinition = (
  tradingPort: TradingPort,
  config?: Partial<RiskManagerConfig>
): ActorDefinition<RiskManagerState, RiskManagerMessage> => {
  const logger = createContextualLogger("RiskManager");
  
  // Default configuration
  const defaultConfig: RiskManagerConfig = {
    maxRiskPerTrade: 0.01, // 1% of account per trade
    maxPositionSize: 0.2,  // 20% of account in one position
    maxDrawdownPercent: 0.1, // 10% max drawdown
    maxLeverage: 2.0,      // 2x max leverage
    stopLossPercent: 0.02, // 2% stop loss
    takeProfitPercent: 0.04, // 4% take profit
    accountSize: 10000,    // $10,000 initial account size
    maxDailyLoss: 0.05,    // 5% max daily loss
    maxOpenPositions: 5,   // Max 5 positions at once
    diversificationWeight: 0.5, // Weight for diversification
    volatilityAdjustment: true, // Adjust for volatility
    correlationMatrix: {}  // Empty correlation matrix initially
  };
  
  // Merge provided config with defaults
  const mergedConfig: RiskManagerConfig = {
    ...defaultConfig,
    ...config
  };
  
  // Initial state for the actor
  const initialState: RiskManagerState = {
    config: mergedConfig,
    positions: {},
    accountRisk: {
      totalValue: mergedConfig.accountSize,
      availableBalance: mergedConfig.accountSize,
      positions: [],
      totalRisk: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      maxPositionSize: mergedConfig.accountSize * mergedConfig.maxPositionSize,
      currentRiskLevel: 'LOW',
      leverageUsed: 0
    },
    marketVolatility: {},
    dailyPnL: 0,
    lastRebalance: Date.now(),
    orderManagerAddress: null
  };
  
  // Helper functions
  const calculatePositionRisk = (
    symbol: string, 
    size: number,
    entryPrice: number,
    currentPrice: number,
    entryTime?: number
  ): PositionRisk => {
    const direction = size > 0 ? 'long' : (size < 0 ? 'short' : 'none');
    const unrealizedPnl = direction === 'long' 
      ? (currentPrice - entryPrice) * Math.abs(size)
      : (entryPrice - currentPrice) * Math.abs(size);
    
    const percentChange = entryPrice !== 0 
      ? Math.abs((currentPrice - entryPrice) / entryPrice)
      : 0;
    
    // Determine risk level based on unrealized profit/loss
    let riskLevel: RiskLevel = 'LOW';
    if (unrealizedPnl < 0) {
      const lossPercent = Math.abs(unrealizedPnl) / (entryPrice * Math.abs(size));
      if (lossPercent > 0.05) riskLevel = 'EXTREME';
      else if (lossPercent > 0.035) riskLevel = 'HIGH';
      else if (lossPercent > 0.02) riskLevel = 'MEDIUM';
    }
    
    // Calculate holding time if entry time is provided
    const now = Date.now();
    const holdingTime = entryTime ? now - entryTime : undefined;
    
    return {
      symbol,
      direction,
      size: Math.abs(size),
      entryPrice,
      currentPrice,
      unrealizedPnl,
      riskLevel,
      entryTime,
      holdingTime
    };
  };
  
  const calculateAccountRisk = (state: RiskManagerState): AccountRisk => {
    const positions = Object.values(state.positions);
    
    // Calculate total position value and unrealized P&L
    let totalPositionValue = 0;
    let totalUnrealizedPnl = 0;
    
    for (const position of positions) {
      const positionValue = position.size * position.currentPrice;
      totalPositionValue += positionValue;
      totalUnrealizedPnl += position.unrealizedPnl;
    }
    
    // Calculate max drawdown
    const newTotalValue = state.config.accountSize + totalUnrealizedPnl;
    const drawdownAmount = Math.max(0, state.config.accountSize - newTotalValue);
    const drawdownPercent = state.config.accountSize > 0 
      ? drawdownAmount / state.config.accountSize
      : 0;
    
    // Update max drawdown if new drawdown is higher
    const maxDrawdown = Math.max(state.accountRisk.maxDrawdown, drawdownAmount);
    const maxDrawdownPercent = Math.max(state.accountRisk.maxDrawdownPercent, drawdownPercent);
    
    // Calculate leverage used
    const leverageUsed = state.config.accountSize > 0 
      ? totalPositionValue / state.config.accountSize
      : 0;
    
    // Determine overall risk level
    let currentRiskLevel: RiskLevel = 'LOW';
    
    if (drawdownPercent > state.config.maxDrawdownPercent * 0.8 || 
        leverageUsed > state.config.maxLeverage * 0.8) {
      currentRiskLevel = 'EXTREME';
    } else if (drawdownPercent > state.config.maxDrawdownPercent * 0.6 || 
               leverageUsed > state.config.maxLeverage * 0.6) {
      currentRiskLevel = 'HIGH';
    } else if (drawdownPercent > state.config.maxDrawdownPercent * 0.3 || 
               leverageUsed > state.config.maxLeverage * 0.3) {
      currentRiskLevel = 'MEDIUM';
    }
    
    // Calculate available balance
    const availableBalance = newTotalValue - totalPositionValue;
    
    return {
      totalValue: newTotalValue,
      availableBalance,
      positions: positions,
      totalRisk: totalPositionValue / newTotalValue,
      maxDrawdown,
      maxDrawdownPercent,
      maxPositionSize: newTotalValue * state.config.maxPositionSize,
      currentRiskLevel,
      leverageUsed
    };
  };
  
  // Function to assess order risk
  const assessOrderRisk = (
    order: OrderParams, 
    accountRisk: AccountRisk,
    state: RiskManagerState
  ): RiskAssessmentResult => {
    logger.debug(`Assessing risk for order on ${order.symbol}`, { order });
    
    // Get current price if not specified in order
    let orderPrice = order.price;
    if (!orderPrice && state.positions[order.symbol]) {
      orderPrice = state.positions[order.symbol].currentPrice;
    } else if (!orderPrice) {
      // If no price specified and no position exists, this is a risky situation
      logger.warn(`No price specified for order on ${order.symbol} and no current position exists`);
      orderPrice = 0; // Will be caught by zero-price check below
    }
    
    // Safety check: reject orders with zero or negative price
    if (!orderPrice || orderPrice <= 0) {
      return {
        approved: false,
        reason: 'Invalid price: Order price must be positive',
        riskLevel: 'EXTREME',
        recommendations: ['Specify a valid price for the order']
      };
    }
    
    // Calculate order value
    const orderValue = order.size * orderPrice;
    
    // Check if we are at max positions
    const currentOpenPositions = Object.keys(state.positions).length;
    if (currentOpenPositions >= state.config.maxOpenPositions && 
        !state.positions[order.symbol]) {
      return {
        approved: false,
        reason: `Max number of open positions (${state.config.maxOpenPositions}) reached`,
        riskLevel: 'HIGH',
        recommendations: ['Close an existing position before opening a new one']
      };
    }
    
    // Check if this order would exceed maximum position size
    if (orderValue > accountRisk.maxPositionSize) {
      const adjustedSize = accountRisk.maxPositionSize / (order.price || 1);
      return {
        approved: true,
        adjustedSize,
        reason: 'Order size reduced to comply with maximum position size',
        riskLevel: 'MEDIUM',
        recommendations: ['Consider splitting the position into multiple entries']
      };
    }
    
    // Check if available balance is sufficient
    if (orderValue > accountRisk.availableBalance * 0.9) {
      // If we have less than 10% of required balance, reject the order completely
      if (accountRisk.availableBalance < orderValue * 0.1) {
        return {
          approved: false,
          reason: 'Insufficient funds to place order. The order value exceeds available balance.',
          riskLevel: 'EXTREME',
          recommendations: ['Add more funds to your account', 'Reduce order size significantly']
        };
      }
      
      const adjustedSize = (accountRisk.availableBalance * 0.9) / (order.price || 1);
      return {
        approved: true,
        adjustedSize,
        reason: 'Order size reduced due to insufficient available balance',
        riskLevel: 'MEDIUM',
        recommendations: ['Consider adding funds or reducing position size']
      };
    }
    
    // Check if this would exceed our max leverage
    const potentialLeverage = 
      (accountRisk.totalRisk * accountRisk.totalValue + orderValue) / accountRisk.totalValue;
    
    if (potentialLeverage > state.config.maxLeverage) {
      const adjustedSize = 
        ((state.config.maxLeverage * accountRisk.totalValue) - 
        (accountRisk.totalRisk * accountRisk.totalValue)) / (order.price || 1);
      
      return {
        approved: true,
        adjustedSize: Math.max(0, adjustedSize),
        reason: 'Order size reduced to comply with maximum leverage',
        riskLevel: 'HIGH',
        recommendations: ['Reduce leverage or increase account size']
      };
    }
    
    // Check for concentrated risk in correlated assets
    const correlatedAssets = findCorrelatedAssets(order.symbol, state);
    if (correlatedAssets.length > 0) {
      const totalCorrelatedExposure = correlatedAssets.reduce((total, asset) => {
        const position = state.positions[asset];
        return total + (position ? position.size * position.currentPrice : 0);
      }, 0);
      
      if (totalCorrelatedExposure + orderValue > accountRisk.totalValue * 0.3) {
        return {
          approved: true,
          adjustedSize: order.size * 0.7, // Reduce by 30%
          reason: 'Size reduced due to high correlation with existing positions',
          riskLevel: 'MEDIUM',
          recommendations: ['Diversify into less correlated assets']
        };
      }
    }
    
    // If we have high daily loss already, be more conservative
    if (state.dailyPnL < -state.config.maxDailyLoss * state.config.accountSize * 0.7) {
      return {
        approved: true,
        adjustedSize: order.size * 0.5, // Reduce by 50%
        reason: 'Size reduced due to approaching daily loss limit',
        riskLevel: 'HIGH',
        recommendations: ['Consider pausing trading for the day']
      };
    }
    
    // All checks passed
    return {
      approved: true,
      riskLevel: 'LOW',
    };
  };
  
  const findCorrelatedAssets = (symbol: string, state: RiskManagerState): string[] => {
    const correlatedAssets: string[] = [];
    const correlationMatrix = state.config.correlationMatrix;
    
    if (!correlationMatrix[symbol]) return [];
    
    for (const [asset, correlation] of Object.entries(correlationMatrix[symbol])) {
      if (correlation > 0.7 && state.positions[asset]) {
        correlatedAssets.push(asset);
      }
    }
    
    return correlatedAssets;
  };
  
  // Analyze position viability
  const analyzePositionViability = (
    position: PositionRisk,
    config: RiskManagerConfig,
    marketVolatility: number = 0
  ): PositionViabilityResult => {
    // Default result (viable)
    const defaultResult: PositionViabilityResult = {
      isViable: true,
      reason: "Position is performing normally",
      recommendation: "Continue holding position",
      riskLevel: "LOW",
      shouldClose: false,
      direction: position.direction,
      size: position.size
    };
    
    // 1. Check for stop loss breach
    const priceDelta = position.currentPrice - position.entryPrice;
    const priceChangePercent = Math.abs(priceDelta) / position.entryPrice;
    
    // Stop loss check - differently for long and short positions
    if (position.direction === 'long' && priceDelta < 0) {
      const lossPercent = Math.abs(priceDelta) / position.entryPrice;
      if (lossPercent >= config.stopLossPercent) {
        return {
          isViable: false,
          reason: `Stop loss triggered: Down ${(lossPercent * 100).toFixed(2)}% from entry price`,
          recommendation: "Close position immediately to prevent further losses",
          riskLevel: "EXTREME",
          shouldClose: true,
          direction: position.direction,
          size: position.size
        };
      }
      
      // Close to stop loss
      if (lossPercent >= config.stopLossPercent * 0.8) {
        return {
          isViable: true,
          reason: `Near stop loss: Down ${(lossPercent * 100).toFixed(2)}% from entry price`,
          recommendation: "Monitor closely or reduce position size",
          riskLevel: "HIGH",
          shouldClose: false,
          direction: position.direction,
          size: position.size
        };
      }
    } else if (position.direction === 'short' && priceDelta > 0) {
      const lossPercent = Math.abs(priceDelta) / position.entryPrice;
      if (lossPercent >= config.stopLossPercent) {
        return {
          isViable: false,
          reason: `Stop loss triggered: Up ${(lossPercent * 100).toFixed(2)}% from entry price`,
          recommendation: "Close position immediately to prevent further losses",
          riskLevel: "EXTREME",
          shouldClose: true,
          direction: position.direction,
          size: position.size
        };
      }
      
      // Close to stop loss
      if (lossPercent >= config.stopLossPercent * 0.8) {
        return {
          isViable: true,
          reason: `Near stop loss: Up ${(lossPercent * 100).toFixed(2)}% from entry price`,
          recommendation: "Monitor closely or reduce position size",
          riskLevel: "HIGH",
          shouldClose: false,
          direction: position.direction,
          size: position.size
        };
      }
    }
    
    // 2. Check for take profit (if enabled)
    if (position.unrealizedPnl > 0) {
      const profitPercent = position.unrealizedPnl / (position.entryPrice * position.size);
      if (profitPercent >= config.takeProfitPercent) {
        return {
          isViable: true,
          reason: `Take profit level reached: ${(profitPercent * 100).toFixed(2)}% gain`,
          recommendation: "Consider taking profits or setting trailing stop",
          riskLevel: "LOW",
          shouldClose: false,
          direction: position.direction,
          size: position.size
        };
      }
    }
    
    // 3. Check for excessive holding time
    if (position.holdingTime) {
      const holdingDays = position.holdingTime / (1000 * 60 * 60 * 24);
      
      // If holding more than 7 days without profit
      if (holdingDays > 7 && position.unrealizedPnl <= 0) {
        return {
          isViable: false,
          reason: `Position held for ${holdingDays.toFixed(1)} days without profit`,
          recommendation: "Close position and reassess strategy",
          riskLevel: "HIGH",
          shouldClose: true,
          direction: position.direction,
          size: position.size
        };
      }
      
      // If holding long time with small profit
      if (holdingDays > 14 && position.unrealizedPnl > 0 && 
          (position.unrealizedPnl / (position.entryPrice * position.size)) < 0.01) {
        return {
          isViable: false,
          reason: `Position held for ${holdingDays.toFixed(1)} days with minimal profit`,
          recommendation: "Close position to free up capital for better opportunities",
          riskLevel: "MEDIUM",
          shouldClose: true,
          direction: position.direction,
          size: position.size
        };
      }
    }
    
    // 4. Check for trend reversal (using market volatility as a simplified proxy)
    if (marketVolatility > 0) {
      // In a real system, we would analyze trend using technical indicators
      const trendStrength = marketVolatility > 0.03 ? "weak" : "strong";
      
      if (trendStrength === "weak" && position.unrealizedPnl < 0) {
        return {
          isViable: false,
          reason: "Market showing signs of trend reversal with position in loss",
          recommendation: "Close position to prevent further losses",
          riskLevel: "HIGH",
          shouldClose: true,
          direction: position.direction,
          size: position.size
        };
      }
    }
    
    // Return default result if no issues found
    return defaultResult;
  };
  
  // The behavior that defines how the actor reacts to messages
  const behavior = async (
    state: RiskManagerState,
    message: ActorMessage<RiskManagerMessage>,
    context: ActorContext<RiskManagerState>
  ) => {
    const { payload } = message;
    
    switch (payload.type) {
      case "ASSESS_ORDER": {
        const { order, requestId } = payload;
        
        // Update account risk with latest data
        const updatedAccountRisk = calculateAccountRisk(state);
        
        // Assess the risk of this order
        const result = assessOrderRisk(order, updatedAccountRisk, state);
        
        logger.info(`Risk assessment for ${order.symbol}: ${result.approved ? 'APPROVED' : 'REJECTED'}`, {
          riskLevel: result.riskLevel,
          adjustedSize: result.adjustedSize,
          reason: result.reason
        });
        
        // Si nous avons un OrderManager, lui envoyer le résultat de l'évaluation
        if (state.orderManagerAddress) {
          logger.debug(`Envoi du résultat d'évaluation à l'OrderManager pour la requête ${requestId}`);
          
          // Construire l'évaluation de risque pour l'OrderManager
          const riskAssessment = {
            approved: result.approved,
            adjustedSize: result.adjustedSize,
            adjustedPrice: undefined, // Pas géré pour l'instant
            reason: result.reason,
            riskLevel: result.riskLevel
          };
          
          // Envoyer l'évaluation à l'OrderManager
          context.send(state.orderManagerAddress, {
            type: "RISK_ASSESSMENT_RESULT",
            requestId,
            riskAssessment
          });
        }
        
        // Return the updated state with recent account risk calculation
        return { 
          state: {
            ...state,
            accountRisk: updatedAccountRisk
          } 
        };
      }
      
      case "REGISTER_ORDER_MANAGER": {
        const { orderManagerAddress } = payload;
        
        logger.info("Enregistrement de l'OrderManager");
        
        // Enregistrer l'adresse de l'OrderManager
        return {
          state: {
            ...state,
            orderManagerAddress
          }
        };
      }
      
      case "UPDATE_CONFIG": {
        const { config } = payload;
        
        logger.info("Updating risk manager configuration", { config });
        
        return {
          state: {
            ...state,
            config: {
              ...state.config,
              ...config
            }
          }
        };
      }
      
      case "ORDER_FILLED": {
        const { order, fillPrice } = payload;
        
        logger.debug(`Processing filled order for ${order.symbol}`, {
          orderId: order.id,
          side: order.side,
          size: order.size,
          fillPrice
        });
        
        // Update position tracking
        const existingPosition = state.positions[order.symbol];
        let newPosition: PositionRisk;
        
        if (existingPosition) {
          // Update existing position
          let newSize = existingPosition.size;
          let newEntryPrice = existingPosition.entryPrice;
          let entryTime = existingPosition.entryTime;
          
          if (order.side === OrderSide.BUY) {
            // Buying increases size or reduces a short
            const totalValue = (existingPosition.size * existingPosition.entryPrice) + 
              (order.size * fillPrice);
            newSize = existingPosition.size + order.size;
            newEntryPrice = newSize !== 0 ? totalValue / newSize : fillPrice;
          } else {
            // Selling reduces size or increases a short
            newSize = existingPosition.size - order.size;
            newEntryPrice = newSize !== 0 ? existingPosition.entryPrice : 0;
          }
          
          // If going from zero to non-zero or changing direction, update entry time
          if ((existingPosition.size === 0 && newSize !== 0) || 
              (existingPosition.size > 0 && newSize < 0) || 
              (existingPosition.size < 0 && newSize > 0)) {
            entryTime = Date.now();
          }
          
          // Create updated position risk
          newPosition = calculatePositionRisk(
            order.symbol,
            newSize,
            newEntryPrice !== 0 ? newEntryPrice : fillPrice,
            fillPrice,
            entryTime
          );
          
          // If position size becomes 0, remove it
          if (Math.abs(newSize) < 0.0001) {
            const { [order.symbol]: _, ...remainingPositions } = state.positions;
            
            return {
              state: {
                ...state,
                positions: remainingPositions,
                accountRisk: calculateAccountRisk({
                  ...state,
                  positions: remainingPositions
                })
              }
            };
          }
        } else {
          // Create new position
          newPosition = calculatePositionRisk(
            order.symbol,
            order.side === OrderSide.BUY ? order.size : -order.size,
            fillPrice,
            fillPrice,
            Date.now()  // Set entry time for new positions
          );
        }
        
        // Update positions dictionary
        const updatedPositions = {
          ...state.positions,
          [order.symbol]: newPosition
        };
        
        // Recalculate account risk
        const updatedAccountRisk = calculateAccountRisk({
          ...state,
          positions: updatedPositions
        });
        
        return {
          state: {
            ...state,
            positions: updatedPositions,
            accountRisk: updatedAccountRisk
          }
        };
      }
      
      case "MARKET_UPDATE": {
        const { symbol, price } = payload;
        
        // If we don't have a position in this symbol, nothing to do
        if (!state.positions[symbol]) return { state };
        
        // Update the current price in our position
        const position = state.positions[symbol];
        const updatedPosition = {
          ...position,
          currentPrice: price,
          unrealizedPnl: position.direction === 'long' 
            ? (price - position.entryPrice) * position.size
            : (position.entryPrice - price) * position.size
        };
        
        const updatedPositions = {
          ...state.positions,
          [symbol]: updatedPosition
        };
        
        // Recalculate account risk with updated price
        const updatedAccountRisk = calculateAccountRisk({
          ...state,
          positions: updatedPositions
        });
        
        return {
          state: {
            ...state,
            positions: updatedPositions,
            accountRisk: updatedAccountRisk
          }
        };
      }
      
      case "GET_POSITION_RISK": {
        const { symbol } = payload;
        const position = state.positions[symbol];
        
        logger.debug(`Retrieved position risk for ${symbol}`, position || { exists: false });
        
        // State doesn't change, just return current state
        return { state };
      }
      
      case "GET_ACCOUNT_RISK": {
        // Recalculate latest account risk
        const updatedAccountRisk = calculateAccountRisk(state);
        
        logger.debug("Retrieved account risk metrics", {
          totalValue: updatedAccountRisk.totalValue,
          leverageUsed: updatedAccountRisk.leverageUsed,
          riskLevel: updatedAccountRisk.currentRiskLevel
        });
        
        return {
          state: {
            ...state,
            accountRisk: updatedAccountRisk
          }
        };
      }
      
      case "REBALANCE_PORTFOLIO": {
        // Logic to rebalance the portfolio based on risk parameters
        logger.info("Rebalancing portfolio based on risk parameters");
        
        // This would contain complex logic to determine if positions need adjusting
        // For now, just update the lastRebalance timestamp
        return {
          state: {
            ...state,
            lastRebalance: Date.now()
          }
        };
      }
      
      case "ANALYZE_OPEN_POSITIONS": {
        logger.info("Analyzing viability of all open positions");
        
        const positionAnalyses: Record<string, PositionViabilityResult> = {};
        const updatedPositions: Record<string, PositionRisk> = {...state.positions};
        
        // Analyze each position and update its viability status
        for (const [symbol, position] of Object.entries(state.positions)) {
          const marketVolatility = state.marketVolatility[symbol] || 0;
          const analysis = analyzePositionViability(position, state.config, marketVolatility);
          
          // Add position details to the analysis result
          const enhancedAnalysis = {
            ...analysis,
            direction: position.direction,
            size: position.size
          };
          
          // Store analysis result
          positionAnalyses[symbol] = enhancedAnalysis;
          
          // Update position with viability information
          updatedPositions[symbol] = {
            ...position,
            isViable: analysis.isViable,
            viabilityReason: analysis.reason
          };
          
          // Log non-viable positions that should be closed
          if (!analysis.isViable && analysis.shouldClose) {
            logger.warn(`Position ${symbol} is no longer viable: ${analysis.reason}`, {
              recommendation: analysis.recommendation,
              riskLevel: analysis.riskLevel,
              direction: position.direction,
              size: position.size
            });
            
            // Send position viability result to trading bot for action
            context.send(message.sender, {
              type: "POSITION_VIABILITY_RESULT",
              symbol,
              isViable: analysis.isViable,
              reason: analysis.reason,
              shouldClose: analysis.shouldClose,
              direction: position.direction
            });
          }
        }
        
        return {
          state: {
            ...state,
            positions: updatedPositions
          }
        };
      }
      
      case "CHECK_POSITION_VIABILITY": {
        const { symbol, currentPrice } = payload;
        
        logger.debug(`Checking viability of position: ${symbol}`);
        
        const position = state.positions[symbol];
        if (!position) {
          logger.warn(`No position found for symbol: ${symbol}`);
          return { state };
        }
        
        // Update position with current price
        const updatedPosition = {
          ...position,
          currentPrice
        };
        
        // Analyze viability
        const marketVolatility = state.marketVolatility[symbol] || 0;
        const analysis = analyzePositionViability(updatedPosition, state.config, marketVolatility);
        
        // Add position details to the analysis result
        const enhancedAnalysis = {
          ...analysis,
          direction: position.direction,
          size: position.size
        };
        
        // Update position with viability information
        const positionsWithViability = {
          ...state.positions,
          [symbol]: {
            ...updatedPosition,
            isViable: analysis.isViable,
            viabilityReason: analysis.reason
          }
        };
        
        // Log viability status
        if (!analysis.isViable) {
          logger.warn(`Position ${symbol} viability check: ${analysis.reason}`, {
            recommendation: analysis.recommendation,
            riskLevel: analysis.riskLevel,
            shouldClose: analysis.shouldClose,
            direction: position.direction,
            size: position.size
          });
          
          // Send position viability result to message sender for action
          context.send(message.sender, {
            type: "POSITION_VIABILITY_RESULT",
            symbol,
            isViable: analysis.isViable,
            reason: analysis.reason,
            shouldClose: analysis.shouldClose,
            direction: position.direction
          });
        } else {
          logger.debug(`Position ${symbol} is viable: ${analysis.reason}`);
        }
        
        return {
          state: {
            ...state,
            positions: positionsWithViability
          }
        };
      }
      
      default:
        return { state };
    }
  };
  
  return {
    initialState,
    behavior,
    supervisorStrategy: { type: "restart" }
  };
};

export const createRiskManagerService = (
  tradingPort: TradingPort,
  config?: Partial<RiskManagerConfig>
) => {
  const actorDefinition = createRiskManagerActorDefinition(tradingPort, config);
  
  // The service would be responsible for creating the actor and exposing a typed API
  return {
    getActorDefinition: () => actorDefinition
  };
};