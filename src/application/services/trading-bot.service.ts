import {
  ActorContext,
  ActorMessage,
  ActorAddress,
} from "../../actor/models/actor.model";
import { createActorSystem } from "../../actor/system";
import { MarketDataPort } from "../ports/market-data.port";
import { TradingPort } from "../ports/trading.port";
import { OrderSide, OrderParams } from "../../domain/models/market.model";
import {
  createStrategyService,
  StrategyService,
} from "../../domain/services/strategy.service";
import { Strategy } from "../../domain/models/strategy.model";
import { MarketData, Order } from "../../domain/models/market.model";
import { getLogger } from "../../infrastructure/logger";
import { createMarketActorDefinition } from "../actors/market.actor";
import { createRiskManagerActorDefinition } from "../actors/risk-manager/risk-manager.actor";
import { createStrategyManagerActorDefinition } from "../actors/strategy-manager/strategy-manager.actor";
import { createPerformanceTrackerActorDefinition } from "../actors/performance-tracker/performance-tracker.actor";
import {
  RiskManagerConfig,
  RiskLevel,
} from "../actors/risk-manager/risk-manager.model";
import { StrategyManagerConfig } from "../actors/strategy-manager/strategy-manager.model";
import { PerformanceTrackerConfig } from "../actors/performance-tracker/performance-tracker.model";

type TradingBotMessage =
  | { type: "START" }
  | { type: "STOP" }
  | { type: "ADD_STRATEGY"; strategy: Strategy }
  | { type: "REMOVE_STRATEGY"; strategyId: string }
  | { type: "MARKET_DATA"; data: MarketData }
  | { type: "ORDER_PLACED"; order: Order }
  | { type: "RISK_ASSESSMENT_RESULT"; orderId: string; result: any }
  | { type: "PERFORMANCE_UPDATE"; metrics: any }
  | { type: "ANALYZE_POSITIONS" }
  | {
      type: "POSITION_VIABILITY_RESULT";
      symbol: string;
      isViable: boolean;
      reason: string;
      shouldClose: boolean;
    };

interface TradingBotState {
  isRunning: boolean;
  strategyService: StrategyService;
  marketActors: Map<string, ActorAddress>;
  orderHistory: Order[];
  riskManagerActor: ActorAddress | null;
  strategyManagerActor: ActorAddress | null;
  performanceTrackerActor: ActorAddress | null;
}

export interface TradingBotService {
  start: () => void;
  stop: () => void;
  addStrategy: (strategy: Strategy) => void;
  removeStrategy: (strategyId: string) => void;
  analyzeOpenPositions: () => void;
}

// Helper function to check buying power and adjust order size proportionally
const checkBuyingPower = async (
  order: OrderParams,
  currentPrice: number,
  tradingPort: TradingPort,
): Promise<{
  approved: boolean;
  adjustedSize?: number;
  reason?: string;
  riskLevel: RiskLevel;
}> => {
  const logger = getLogger();

  try {
    const balances = await tradingPort.getAccountBalance();
    // Get all relevant balances (USDC for buying power, asset balance for selling)
    const availableUSDC = balances["USDC"] || 0;
    const assetBalance = balances[order.symbol.split("-")[0]] || 0;
    const orderPrice = order.price || currentPrice;

    if (!orderPrice || orderPrice <= 0) {
      return {
        approved: false,
        reason: "Invalid price: Order price must be positive",
        riskLevel: "EXTREME",
      };
    }

    const orderValue = order.size * orderPrice;

    // For sell orders, handle proportionally to asset balance
    if (order.side === OrderSide.SELL) {
      if (availableUSDC <= 0) {
        logger.error(
          `Cannot sell ${order.symbol}: No ${order.symbol.split("-")[0]} balance available`,
        );
        return {
          approved: false,
          reason: `Cannot sell ${order.symbol.split("-")[0]}: No balance available`,
          riskLevel: "EXTREME",
        };
      }

      // Make order size proportional to asset balance if it exceeds available amount
      // Use a maximum of 50% of available balance for any single order
      const maxSellSize = assetBalance * 0.5;
      let adjustedSize = order.size;
      
      if (order.size > maxSellSize) {
        adjustedSize = maxSellSize;
        logger.warn(
          `Reducing sell order size from ${order.size} to ${adjustedSize} ${order.symbol.split("-")[0]} (50% of available ${assetBalance.toFixed(4)})`,
        );
        return {
          approved: true,
          adjustedSize,
          reason: `Adjusted sell size to be proportional (50%) to ${order.symbol.split("-")[0]} balance`,
          riskLevel: "MEDIUM",
        };
      }

      // Ensure order doesn't exceed available balance (95% safety margin)
      if (order.size > assetBalance * 0.95) {
        adjustedSize = assetBalance * 0.95;
        adjustedSize = Math.floor(adjustedSize * 10000) / 10000; // Round to 4 decimal places

        logger.warn(
          `Reducing sell order size from ${order.size} to ${adjustedSize} ${order.symbol.split("-")[0]} (available: ${assetBalance.toFixed(4)})`,
        );
        return {
          approved: true,
          adjustedSize,
          reason: `Reduced sell size due to available ${order.symbol.split("-")[0]} balance`,
          riskLevel: "HIGH",
        };
      }

      // We have enough of the asset to sell
      return { approved: true, riskLevel: "LOW" };
    }

    // For buy orders, make size proportional to available USDC
    // Maximum percentage of available funds to use for a single order
    const maxFundsPercentage = 0.3; // 30% of available funds max
    const maxOrderValue = availableUSDC * maxFundsPercentage;

    // If order is too large, adjust to proportional size
    if (orderValue > maxOrderValue) {
      // Calculate proportional size
      const newSize = maxOrderValue / orderPrice;
      const adjustedSize = Math.floor(newSize * 10000) / 10000; // Round to 4 decimal places

      logger.warn(
        `Adjusting order size from ${order.size} to ${adjustedSize} to be proportional to buying power`,
      );
      return {
        approved: true,
        adjustedSize,
        reason: `Order size adjusted to be proportional (${(maxFundsPercentage * 100).toFixed(0)}%) to available funds. Using $${(adjustedSize * orderPrice).toFixed(2)} of $${availableUSDC.toFixed(2)} available`,
        riskLevel: "MEDIUM",
      };
    }

    // If we don't have enough for the adjusted size, further reduce
    if (orderValue > availableUSDC) {
      // If we have less than 10% of required funds, reject the order
      if (availableUSDC < orderValue * 0.1) {
        logger.error(
          `Insufficient funds to place order. Available: $${availableUSDC.toFixed(2)}, Required: $${orderValue.toFixed(2)}`,
        );
        return {
          approved: false,
          reason: `Insufficient funds. Available: $${availableUSDC.toFixed(2)}, Required: $${orderValue.toFixed(2)}`,
          riskLevel: "EXTREME",
        };
      }

      // Adjust size to match available funds (using 90% of available to leave some buffer)
      const newSize = (availableUSDC * 0.9) / orderPrice;
      const adjustedSize = Math.floor(newSize * 10000) / 10000; // Round to 4 decimal places

      logger.warn(
        `Reducing order size from ${order.size} to ${adjustedSize} due to available balance`,
      );
      return {
        approved: true,
        adjustedSize,
        reason: `Reduced size due to available funds. Using $${(adjustedSize * orderPrice).toFixed(2)} of $${availableUSDC.toFixed(2)} available`,
        riskLevel: "HIGH",
      };
    }

    // All checks passed, order is proportional to buying power
    return { approved: true, riskLevel: "LOW" };
  } catch (error) {
    logger.error("Error checking buying power", error as Error);
    return {
      approved: false,
      reason: "Unable to verify account balance",
      riskLevel: "EXTREME",
    };
  }
};

export const createTradingBotService = (
  marketDataPort: MarketDataPort,
  tradingPort: TradingPort,
  options = {
    pollInterval: 5000,
    positionAnalysisInterval: 300000, // 5 minutes
    maxFundsPerOrder: 0.3, // Maximum 30% of available funds per order by default
    riskConfig: {} as Partial<RiskManagerConfig>,
    strategyConfig: {} as Partial<StrategyManagerConfig>,
    performanceConfig: {} as Partial<PerformanceTrackerConfig>,
  },
): TradingBotService => {
  const logger = getLogger();
  const actorSystem = createActorSystem();

  const initialState: TradingBotState = {
    isRunning: false,
    strategyService: createStrategyService(),
    marketActors: new Map(),
    orderHistory: [],
    riskManagerActor: null,
    strategyManagerActor: null,
    performanceTrackerActor: null,
  };

  // Handler for actor messages
  const tradingBotBehavior = async (
    state: TradingBotState,
    message: ActorMessage<TradingBotMessage>,
    context: ActorContext<TradingBotState>,
  ) => {
    const payload = message.payload;

    switch (payload.type) {
      case "START": {
        logger.info("Starting trading bot...");

        // Create risk manager if not exists
        let riskManagerActor = state.riskManagerActor;
        if (!riskManagerActor) {
          const riskManagerDefinition = createRiskManagerActorDefinition(
            tradingPort,
            options.riskConfig,
          );
          riskManagerActor = actorSystem.createActor(riskManagerDefinition);
          logger.info("Created risk manager actor");
        }

        // Create strategy manager if not exists
        let strategyManagerActor = state.strategyManagerActor;
        if (!strategyManagerActor) {
          const strategyManagerDefinition =
            createStrategyManagerActorDefinition(options.strategyConfig);
          strategyManagerActor = actorSystem.createActor(
            strategyManagerDefinition,
          );
          logger.info("Created strategy manager actor");
        }

        // Create performance tracker if not exists
        let performanceTrackerActor = state.performanceTrackerActor;
        if (!performanceTrackerActor) {
          const performanceTrackerDefinition =
            createPerformanceTrackerActorDefinition(options.performanceConfig);
          performanceTrackerActor = actorSystem.createActor(
            performanceTrackerDefinition,
          );
          logger.info("Created performance tracker actor");
        }

        // Start all existing market actors if they exist
        for (const [symbol, actorAddress] of state.marketActors.entries()) {
          actorSystem.send(actorAddress, { type: "SUBSCRIBE", symbol });
        }

        return {
          state: {
            ...state,
            isRunning: true,
            riskManagerActor,
            strategyManagerActor,
            performanceTrackerActor,
          },
        };
      }

      case "STOP": {
        logger.info("Stopping trading bot...");

        // Stop all market actors
        for (const [symbol, actorAddress] of state.marketActors.entries()) {
          actorSystem.send(actorAddress, { type: "UNSUBSCRIBE" });
        }

        return { state: { ...state, isRunning: false } };
      }

      case "ADD_STRATEGY": {
        const { strategy } = payload;
        logger.info(`Adding strategy: ${strategy.getName()}`);

        // Register the strategy
        state.strategyService.registerStrategy(strategy);

        // Extract symbol from strategy and create/start market actor if needed
        // Each symbol has its own market actor that publishes market data
        const symbol = (
          strategy.getConfig().parameters as Record<string, string>
        ).symbol;
        if (symbol) {
          if (!state.marketActors.has(symbol)) {
            // Create a market actor for this symbol if it doesn't exist
            // This allows multiple strategies to use the same market data for a symbol
            const onMarketData = (data: MarketData) => {
              actorSystem.send(context.self, { type: "MARKET_DATA", data });
            };

            const marketActorDef = createMarketActorDefinition(
              symbol,
              marketDataPort,
              onMarketData,
              options.pollInterval,
            );

            const marketActorAddress = actorSystem.createActor(marketActorDef);
            state.marketActors.set(symbol, marketActorAddress);

            // If the bot is running, subscribe to the market immediately
            if (state.isRunning) {
              actorSystem.send(marketActorAddress, {
                type: "SUBSCRIBE",
                symbol,
              });
            }

            logger.debug(`Created market actor for symbol: ${symbol}`);
          } else {
            logger.debug(`Using existing market actor for symbol: ${symbol}`);
          }
        }

        return { state };
      }

      case "REMOVE_STRATEGY": {
        const { strategyId } = payload;
        logger.info(`Removing strategy: ${strategyId}`);

        // Get the strategy before removing it to check its symbol
        const strategy = state.strategyService.getStrategy(strategyId);
        const strategySymbol = strategy
          ? (strategy.getConfig().parameters as Record<string, string>).symbol
          : undefined;

        // Unregister the strategy
        state.strategyService.unregisterStrategy(strategyId);

        // Check if any other strategies are using this symbol
        if (strategySymbol) {
          const stillInUse = state.strategyService
            .getAllStrategies()
            .some(
              (s) =>
                (s.getConfig().parameters as Record<string, string>).symbol ===
                strategySymbol,
            );

          if (!stillInUse && state.marketActors.has(strategySymbol)) {
            // If no other strategies are using this symbol, unsubscribe and remove the market actor
            const actorAddress = state.marketActors.get(strategySymbol)!;

            // Unsubscribe from the market
            actorSystem.send(actorAddress, { type: "UNSUBSCRIBE" });

            // Stop the actor
            actorSystem.stop(actorAddress);

            // Remove from our map
            state.marketActors.delete(strategySymbol);

            logger.debug(`Removed market actor for symbol: ${strategySymbol}`);
          }
        }

        return { state };
      }

      case "MARKET_DATA": {
        if (!state.isRunning) return { state };

        const { data } = payload;
        logger.debug(
          `Processing market data for ${data.symbol}: ${data.price}`,
        );

        // Send market data to strategy manager if available
        if (state.strategyManagerActor) {
          actorSystem.send(state.strategyManagerActor, {
            type: "PROCESS_MARKET_DATA",
            data,
          });
        }

        // Send market update to risk manager to update positions
        if (state.riskManagerActor) {
          actorSystem.send(state.riskManagerActor, {
            type: "MARKET_UPDATE",
            symbol: data.symbol,
            price: data.price,
          });
        }

        // Send price update to performance tracker
        if (state.performanceTrackerActor) {
          actorSystem.send(state.performanceTrackerActor, {
            type: "UPDATE_PRICE",
            symbol: data.symbol,
            price: data.price,
            timestamp: Date.now(),
          });
        }

        // Process market data through all strategies
        // This will automatically filter and apply only to strategies configured for this symbol
        const signals = await state.strategyService.processMarketData(data);

        // Handle strategy signals for this particular symbol
        for (const [strategyId, signal] of Array.from(signals.entries())) {
          if (!signal) continue;

          logger.info(
            `Signal from ${strategyId}: ${signal.type} ${signal.direction} @ ${signal.price || data.price}`,
          );

          // Generate order for the specific strategy that produced the signal
          const order = state.strategyService.generateOrder(
            strategyId,
            signal,
            data,
          );
          if (order) {
            try {
              // Assess order risk before placing
              let adjustedOrder = { ...order };
              let canPlaceOrder = true;

              // Check buying power and make order size proportional
              const buyingPowerResult = await checkBuyingPower(
                order,
                data.price,
                tradingPort,
              );

              if (!buyingPowerResult.approved) {
                logger.error(`Order rejected: ${buyingPowerResult.reason}`);
                return { state };
              }

              if (buyingPowerResult.adjustedSize) {
                adjustedOrder = {
                  ...adjustedOrder,
                  size: buyingPowerResult.adjustedSize,
                };
                logger.warn(
                  `Order size adjusted to ${adjustedOrder.size} ${order.symbol.split("-")[0]}: ${buyingPowerResult.reason}`,
                );
              } else {
                // Always log the proportion of buying power being used
                const balances = await tradingPort.getAccountBalance();
                const availableUSDC = balances["USDC"] || 0;
                const orderValue =
                  adjustedOrder.size * (adjustedOrder.price || data.price);
                const percentageUsed = (orderValue / availableUSDC) * 100;

                logger.info(
                  `Order using ${percentageUsed.toFixed(2)}% of available buying power ($${orderValue.toFixed(2)} / $${availableUSDC.toFixed(2)})`,
                );
              }

              // Assess additional risk factors if risk manager is available
              if (state.riskManagerActor) {
                logger.info(
                  `Assessing additional risk factors for order on ${order.symbol}`,
                );

                // Get current account risk data
                actorSystem.send(state.riskManagerActor, {
                  type: "GET_ACCOUNT_RISK",
                });

                // In a real actor system, we would use ask pattern or response messages
                // For now, we trust the buying power check already performed
              }

              // Only place order if approved
              if (!canPlaceOrder) {
                logger.error(
                  `Order for ${order.symbol} not placed due to risk assessment`,
                );
                return { state };
              }

              const placedOrder = await tradingPort.placeOrder(adjustedOrder);
              logger.info(
                `Order placed: ${placedOrder.id} for ${order.symbol}, ${order.side} ${adjustedOrder.size} @ ${order.price || data.price} USD`,
              );
              if (adjustedOrder.side === OrderSide.BUY) {
                logger.info(
                  `Total order value: $${(adjustedOrder.size * (order.price || data.price)).toFixed(2)} USD`,
                );
              }

              // Send order placed message to self to update state
              context.send(context.self, {
                type: "ORDER_PLACED",
                order: placedOrder,
              });

              // Notify risk manager about filled order
              if (state.riskManagerActor) {
                actorSystem.send(state.riskManagerActor, {
                  type: "ORDER_FILLED",
                  order: placedOrder,
                  fillPrice: data.price,
                });
              }

              // Record trade in performance tracker
              if (state.performanceTrackerActor) {
                // For simplicity, we're creating a basic trade entry here
                const tradeEntry = {
                  id: placedOrder.id,
                  strategyId,
                  symbol: order.symbol,
                  entryTime: Date.now(),
                  entryPrice: data.price,
                  entryOrder: placedOrder,
                  quantity: order.size,
                  fees: 0,
                  status: "open",
                  tags: [signal.type, signal.direction],
                };

                actorSystem.send(state.performanceTrackerActor, {
                  type: "TRADE_OPENED",
                  trade: tradeEntry,
                });
              }
            } catch (error) {
              logger.error(
                `Error placing order for ${order.symbol}`,
                error as Error,
                {
                  order: JSON.stringify(order),
                },
              );
            }
          }
        }

        return { state };
      }

      case "ORDER_PLACED": {
        // Add the order to history
        const { order } = payload;
        state.orderHistory.push(order);

        // Keep only the last 100 orders (optional)
        if (state.orderHistory.length > 100) {
          state.orderHistory = state.orderHistory.slice(-100);
        }

        return { state };
      }

      case "RISK_ASSESSMENT_RESULT": {
        const { orderId, result } = payload;

        logger.info(`Received risk assessment for order ${orderId}`, {
          approved: result.approved,
          riskLevel: result.riskLevel,
          adjustedSize: result.adjustedSize,
        });

        // In a complete implementation, we would process the risk assessment result
        // and adjust orders accordingly

        return { state };
      }

      case "PERFORMANCE_UPDATE": {
        const { metrics } = payload;

        logger.info("Received performance update", {
          winRate: metrics.winRate,
          profitFactor: metrics.profitFactor,
          netProfit: metrics.netProfit,
        });

        // In a complete implementation, we would update strategy weights
        // based on performance metrics

        return { state };
      }

      case "ANALYZE_POSITIONS": {
        logger.info("Analyzing viability of all open positions");

        if (state.riskManagerActor) {
          // Send analyze positions message to risk manager
          actorSystem.send(state.riskManagerActor, {
            type: "ANALYZE_OPEN_POSITIONS",
          });

          // Schedule next analysis
          if (state.isRunning && options.positionAnalysisInterval) {
            setTimeout(() => {
              if (state.isRunning) {
                context.send(context.self, { type: "ANALYZE_POSITIONS" });
              }
            }, options.positionAnalysisInterval);
          }
        }

        return { state };
      }

      case "POSITION_VIABILITY_RESULT": {
        const { symbol, isViable, reason, shouldClose } = payload;

        if (!isViable) {
          logger.warn(`Position ${symbol} is no longer viable: ${reason}`);

          // Automatically close non-viable positions if indicated
          if (shouldClose) {
            logger.info(`Automatically closing non-viable position: ${symbol}`);

            // Determine the position's details by querying risk manager
            // In a real implementation, we would get the position details and close it
            // For now, we'll log the intention
            logger.info(
              `[Action required] Close position ${symbol}: ${reason}`,
            );
          }
        }

        return { state };
      }

      default:
        return { state };
    }
  };

  // Create the main bot actor that will manage all strategies and market actors
  // The trading bot actor coordinates all the market data and strategy signals,
  // and manages the risk, strategy, and performance actors
  const botAddress = actorSystem.createActor({
    initialState,
    behavior: tradingBotBehavior,
    supervisorStrategy: { type: "restart" },
  });

  // Public API methods
  const start = (): void => {
    actorSystem.send(botAddress, { type: "START" });
  };

  const stop = (): void => {
    actorSystem.send(botAddress, { type: "STOP" });

    // In a real implementation, we might want to explicitly stop
    // all the child actors and save their state
    // For now this is handled by the actor system's hierarchy
  };

  const addStrategy = (strategy: Strategy): void => {
    actorSystem.send(botAddress, {
      type: "ADD_STRATEGY",
      strategy,
    });
  };

  const removeStrategy = (strategyId: string): void => {
    actorSystem.send(botAddress, {
      type: "REMOVE_STRATEGY",
      strategyId,
    });
  };

  // Return the public API
  const analyzeOpenPositions = (): void => {
    actorSystem.send(botAddress, { type: "ANALYZE_POSITIONS" });
  };

  return {
    start,
    stop,
    addStrategy,
    removeStrategy,
    analyzeOpenPositions,
  };
};
