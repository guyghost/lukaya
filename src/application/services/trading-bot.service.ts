import {
  ActorContext,
  ActorMessage,
  ActorAddress,
  ActorDefinition,
} from "../../actor/models/actor.model";
import { createActorSystem } from "../../actor/system";
import { MarketDataPort } from "../ports/market-data.port";
import { TradingPort } from "../ports/trading.port";
import { 
  OrderSide, 
  OrderParams, 
  OrderType, 
  TimeInForce,
  Strategy,
  MarketData, 
  Result,
  StrategySignal // Added StrategySignal
} from "../../shared";
import { Order } from "../../domain/models/market.model";
import {
  createStrategyService,
  StrategyService,
} from "../../domain/services/strategy.service";
import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";
import { result } from "../../shared/utils";
import { createMarketActorDefinition } from "../actors/market.actor";
import { createRiskManagerActorDefinition } from "../actors/risk-manager/risk-manager.actor";
import { createStrategyManagerActorDefinition } from "../actors/strategy-manager/strategy-manager.actor";
import { createPerformanceTrackerActorDefinition } from "../actors/performance-tracker/performance-tracker.actor";
import { createStrategyActorDefinition } from "../../adapters/primary/strategy-actor.adapter";
import {
  PositionRisk,
  RiskManagerConfig,
  RiskLevel,
  RiskManagerPort
} from "../actors/risk-manager/risk-manager.model";
import { StrategyManagerConfig } from "../actors/strategy-manager/strategy-manager.model";
import { PerformanceTrackerConfig } from "../actors/performance-tracker/performance-tracker.model";
import { createTakeProfitIntegrator } from "../integrators/take-profit-integrator";
import { TakeProfitConfig } from "../actors/take-profit-manager/take-profit-manager.model";
import { TakeProfitIntegratorConfig } from "../integrators/take-profit-integrator";
import { createOrderManagerActorDefinition } from "../actors/order-manager/order-manager.actor";
import { OrderManagerConfig } from "../actors/order-manager/order-manager.model";

type TradingBotMessage = 
  | { type: "START" }
  | { type: "STOP" }
  | { type: "ADD_STRATEGY"; strategy: Strategy }
  | { type: "REMOVE_STRATEGY"; strategyId: string }
  | { type: "MARKET_DATA"; data: MarketData }
  | { type: "ORDER_PLACED"; order: Order }
  | { type: "ORDER_REJECTED"; order: OrderParams; reason: string; error?: any }
  | { type: "ORDER_CANCELLED"; order: Order; reason: string; error?: any }
  | { type: "RISK_ASSESSMENT_RESULT"; orderId: string; result: any }
  | { type: "PERFORMANCE_UPDATE"; metrics: any }
  | { type: "ANALYZE_POSITIONS" }
  | { type: "POSITION_VIABILITY_RESULT"; symbol: string; isViable: boolean; reason: string; shouldClose: boolean; direction?: 'long' | 'short' | 'none'; size?: number }
  | { type: "CONSOLIDATED_SIGNAL"; payload: { strategyId: string; signal: StrategySignal; marketData: MarketData }}
  | { type: "REQUEST_MARKET_DATA"; payload: { symbol: string; strategyId: string; signal: StrategySignal } }
  | { type: "RETRY_SIGNAL"; payload: { pendingSignalId: string } };

// Définition d'un signal en attente pour le mécanisme de réessai
interface PendingSignal {
  id: string;
  strategyId: string;
  signal: StrategySignal;
  symbol: string;
  timestamp: number;
  attempts: number;
  lastAttempt: number;
  reason: string;
}

interface TradingBotState {
  isRunning: boolean;
  strategyService: StrategyService;
  marketActors: Map<string, ActorAddress>;
  strategyActors: Map<string, ActorAddress>; // Acteurs individuels pour chaque stratégie
  orderHistory: Order[];
  rejectedOrders: { order: OrderParams; reason: string; error?: any }[];
  cancelledOrders: { order: Order; reason: string; error?: any }[];
  riskManagerActor: ActorAddress | null;
  strategyManagerActor: ActorAddress | null;
  performanceTrackerActor: ActorAddress | null;
  orderManagerActor: ActorAddress | null;
  positions: Record<string, { symbol: string; direction: 'long' | 'short' | 'none'; size: number }>;
  takeProfitIntegrator: ReturnType<typeof createTakeProfitIntegrator> | null;
  pendingSignals: Record<string, PendingSignal>; // Signaux en attente de traitement/réessai
  subscribedSymbols: Set<string>; // Symboles pour lesquels on est abonné aux données de marché
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
  adjustedPrice?: number;
  reason?: string;
  riskLevel: RiskLevel;
}> => {
  const logger = createContextualLogger('TradingBotService.checkBuyingPower');

  try {
    const balances = await tradingPort.getAccountBalance();
    // Get all relevant balances (USDC for buying power, asset balance for selling)
    const availableUSDC = balances["USDC"] || 0;
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
      const maxSellSize = availableUSDC * 0.5;
      let adjustedSize = order.size;

      if (order.size > maxSellSize) {
        adjustedSize = maxSellSize;
        logger.warn(
          `Reducing sell order size from ${order.size} to ${adjustedSize} ${order.symbol.split("-")[0]} (50% of available ${availableUSDC.toFixed(4)})`,
        );
        return {
          approved: true,
          adjustedSize,
          reason: `Adjusted sell size to be proportional (50%) to ${order.symbol.split("-")[0]} balance`,
          riskLevel: "MEDIUM",
        };
      }

      // Ensure order doesn't exceed available balance (95% safety margin)
      if (order.size > availableUSDC * 0.95) {
        adjustedSize = availableUSDC * 0.95;
        adjustedSize = Math.floor(adjustedSize * 10000) / 10000; // Round to 4 decimal places

        logger.warn(
          `Reducing sell order size from ${order.size} to ${adjustedSize} ${order.symbol.split("-")[0]} (available: ${availableUSDC.toFixed(4)})`,
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
    
    // If this is a limit order, verify the price is reasonable
    if (order.type === OrderType.LIMIT && order.price) {
      // For buy limit orders, ensure price is not too high (more than 1% above market)
      if (order.price > currentPrice * 1.01) {
        logger.warn(`Limit buy price ${order.price} is more than 1% above current price ${currentPrice}. Adjusting.`);
        const adjustedPrice = Math.round(currentPrice * 1.005 * 100) / 100; // Buy 0.5% above market
        return {
          approved: true,
          adjustedPrice,
          reason: `Adjusted limit buy price from ${order.price} to ${adjustedPrice} (0.5% above market)`,
          riskLevel: "MEDIUM"
        };
      }
    }
    
    // If order is too large, adjust to proportional size
    if (orderValue > maxOrderValue) {
      // Calculate proportional size
      const newSize = maxOrderValue / orderPrice;
      const adjustedSize = Math.floor(newSize * 10000) / 10000; // Round to 4 decimal places
      
      logger.warn(`Adjusting order size from ${order.size} to ${adjustedSize} to be proportional to buying power`);
      return { 
        approved: true, 
        adjustedSize,
        reason: `Order size adjusted to be proportional (${(maxFundsPercentage * 100).toFixed(0)}%) to available funds. Using $${(adjustedSize * orderPrice).toFixed(2)} of $${availableUSDC.toFixed(2)} available`,
        riskLevel: "MEDIUM"
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
    pollInterval: 1000, // Réduit de 5000ms à 1000ms pour une meilleure réactivité aux micro-variations
    positionAnalysisInterval: 300000, // 5 minutes
    maxFundsPerOrder: 0.3, // Maximum 30% of available funds per order by default
    riskConfig: {} as Partial<RiskManagerConfig>,
    strategyConfig: {} as Partial<StrategyManagerConfig>,
    performanceConfig: {} as Partial<PerformanceTrackerConfig>,
    takeProfitConfig: {} as Partial<TakeProfitConfig>,
    takeProfitIntegratorConfig: {} as Partial<TakeProfitIntegratorConfig>,
  },
): TradingBotService => {
  const logger = createContextualLogger('TradingBotService');
  const actorSystem = createActorSystem();
  let tradingBotActorAddress: ActorAddress | null = null;

  const initialState: TradingBotState = {
    isRunning: false,
    strategyService: createStrategyService(),
    marketActors: new Map(),
    strategyActors: new Map(),
    orderHistory: [],
    rejectedOrders: [],
    cancelledOrders: [],
    riskManagerActor: null,
    strategyManagerActor: null,
    performanceTrackerActor: null,
    orderManagerActor: null,
    positions: {},
    takeProfitIntegrator: null,
    pendingSignals: {},
    subscribedSymbols: new Set<string>()
  };

  // Helper function to close a position
  const closePosition = async (
    symbol: string,
    direction: 'long' | 'short' | 'none',
    size: number,
    marketDataPort: MarketDataPort,
    tradingPort: TradingPort,
    reason: string,
    context: ActorContext<TradingBotState>
  ): Promise<boolean> => {
    const logger = createContextualLogger('TradingBotService.closePosition');
    try {
      // Get current price for this symbol
      const marketData = await marketDataPort.getLatestMarketData(symbol);
      
      // Determine which side to use for closing the position
      // If position is long, we need to SELL to close it
      // If position is short, we need to BUY to close it
      const closeSide = direction === 'long' ? OrderSide.SELL : OrderSide.BUY;
      
      // Create a market order for immediate execution
      // No need to calculate prices, as market orders execute at the best available price
      
      // Create close order as market order
      const closeOrder: OrderParams = {
        symbol,
        side: closeSide,
        type: OrderType.MARKET,
        size: size,
        reduceOnly: true // Ensure this only closes the position
      };
      
      logger.info(`Created close order for position ${symbol}: ${JSON.stringify(closeOrder)}`);
      
      // Place the order
      const placedOrder = await tradingPort.placeOrder(closeOrder);
      logger.info(`Close order placed: ${placedOrder.id}, Reason: ${reason}`);
      
      // Update order history
      context.send(context.self, {
        type: "ORDER_PLACED",
        order: placedOrder
      });
      
      return true;
    } catch (error) {
      logger.error(`Error closing position ${symbol}:`, error as Error);
      return false;
    }
  };

  // Handler for actor messages
  const tradingBotBehavior = async (
    state: TradingBotState,
    message: ActorMessage<TradingBotMessage>,
    context: ActorContext<TradingBotState>
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
          state.riskManagerActor = riskManagerActor;
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
          state.strategyManagerActor = strategyManagerActor;
          
          // Créer les acteurs de stratégie pour les stratégies qui ont été ajoutées avant
          // l'initialisation du gestionnaire de stratégies
          for (const strategy of state.strategyService.getAllStrategies()) {
            try {
              const strategyId = strategy.getId();
              if (!state.strategyActors.has(strategyId)) {
                logger.info(`Creating previously pending strategy actor for: ${strategyId}`);
                
                // D'abord, enregistrer explicitement la stratégie auprès du gestionnaire de stratégies
                actorSystem.send(strategyManagerActor, {
                  type: "REGISTER_STRATEGY",
                  strategy: strategy,
                  markets: [(strategy.getConfig().parameters as Record<string, string>).symbol]
                });
                logger.info(`Strategy ${strategyId} registered with StrategyManager (delayed registration)`);
                
                const strategyActorDef = createStrategyActorDefinition(
                  strategy,
                  strategyManagerActor
                );
                
                const strategyActorAddress = actorSystem.createActor(strategyActorDef);
                state.strategyActors.set(strategyId, strategyActorAddress);
                logger.debug(`Created strategy actor for previously pending strategy: ${strategyId}`);
              }
            } catch (error) {
              logger.error(`Error creating strategy actor:`, error as Error);
            }
          }
        }

        // Create performance tracker if not exists
        let performanceTrackerActor = state.performanceTrackerActor;
        // Tracker configuration
        if (!performanceTrackerActor) {
          const performanceTrackerDefinition =
            createPerformanceTrackerActorDefinition(options.performanceConfig);
          performanceTrackerActor = actorSystem.createActor(
            performanceTrackerDefinition,
          );
          logger.info("Created performance tracker actor");
        }
        
        // Create order manager if not exists
        let orderManagerActor = state.orderManagerActor;
        if (!orderManagerActor) {
          const orderManagerConfig: Partial<OrderManagerConfig> = {
            orderTimeout: 30000,           // 30 secondes
            maxRetryAttempts: 3,
            retryDelay: 1000,              // 1 seconde
            maxOrderHistorySize: 1000,
            orderRateLimit: 60             // 60 ordres par minute
          };
          
          const orderManagerDefinition = createOrderManagerActorDefinition(
            tradingPort,
            orderManagerConfig
          );
          orderManagerActor = actorSystem.createActor(orderManagerDefinition);
          logger.info("Created order manager actor");
          state.orderManagerActor = orderManagerActor;
          
          // Enregistrer l'OrderManager auprès du RiskManager
          if (riskManagerActor) {
            actorSystem.send(riskManagerActor, {
              type: "REGISTER_ORDER_MANAGER",
              orderManagerAddress: orderManagerActor
            });
            logger.info("OrderManager enregistré auprès du RiskManager");
          }
          
          // Enregistrer le RiskManager auprès de l'OrderManager
          if (riskManagerActor) {
            actorSystem.send(orderManagerActor, {
              type: "REGISTER_RISK_MANAGER",
              riskManagerAddress: riskManagerActor
            });
            logger.info("RiskManager enregistré auprès de l'OrderManager");
          }
          
          // Enregistrer le TradingBot auprès de l'OrderManager
          actorSystem.send(orderManagerActor, {
            type: "REGISTER_TRADING_BOT",
            tradingBotAddress: context.self
          });
          logger.info("TradingBot enregistré auprès de l'OrderManager");
        }
        
        // Initialize take profit integrator
        if (!state.takeProfitIntegrator && state.riskManagerActor) {
          // Créer un adaptateur pour RiskManagerPort à partir de l'acteur
          const riskManagerPort: RiskManagerPort = {
            assessOrderRisk: async (order, accountRisk) => {
              // Simple implementation for now
              return { approved: true, riskLevel: 'LOW' };
            },
            getAccountRisk: async () => {
              // Default implementation
              return { 
                totalValue: 10000, 
                availableBalance: 10000, 
                positions: [], 
                totalRisk: 0, 
                maxDrawdown: 0, 
                maxDrawdownPercent: 0, 
                maxPositionSize: 2000, 
                currentRiskLevel: 'LOW' as const, 
                leverageUsed: 0 
              };
            },
            getPositionRisk: async (symbol) => null,
            updatePosition: () => {},
            suggestOrderAdjustments: async (order) => order,
            rebalancePortfolio: async () => [],
            analyzePositionViability: async (symbol, currentPrice) => ({
              isViable: true,
              reason: "Default",
              recommendation: "Default",
              riskLevel: 'LOW' as const,
              shouldClose: false
            }),
            analyzeAllOpenPositions: async () => ({})
          };
          
          // Préparer la configuration pour la règle 3-5-7 depuis les variables d'environnement
          const takeProfitConfig = {
            enabled: process.env.TAKE_PROFIT_RULE_ENABLED === 'true',
            profitTiers: [
              { 
                profitPercentage: Number(process.env.TAKE_PROFIT_LEVEL_1 || 3), 
                closePercentage: Number(process.env.TAKE_PROFIT_SIZE_1 || 30) 
              },
              { 
                profitPercentage: Number(process.env.TAKE_PROFIT_LEVEL_2 || 5), 
                closePercentage: Number(process.env.TAKE_PROFIT_SIZE_2 || 30) 
              },
              { 
                profitPercentage: Number(process.env.TAKE_PROFIT_LEVEL_3 || 7), 
                closePercentage: Number(process.env.TAKE_PROFIT_SIZE_3 || 100) 
              },
            ],
            trailingMode: process.env.TAKE_PROFIT_TRAILING === 'true',
            cooldownPeriod: Number(process.env.TAKE_PROFIT_COOLDOWN || 300000), // 5 minutes par défaut
          };

          // Validation des niveaux de profit
          const validationErrors = [];
          if (takeProfitConfig.profitTiers[0].profitPercentage >= takeProfitConfig.profitTiers[1].profitPercentage) {
            validationErrors.push('TAKE_PROFIT_LEVEL_1 doit être inférieur à TAKE_PROFIT_LEVEL_2');
          }
          if (takeProfitConfig.profitTiers[1].profitPercentage >= takeProfitConfig.profitTiers[2].profitPercentage) {
            validationErrors.push('TAKE_PROFIT_LEVEL_2 doit être inférieur à TAKE_PROFIT_LEVEL_3');
          }
          
          // Validation des tailles de fermeture
          const totalClosePercentage = takeProfitConfig.profitTiers.reduce(
            (total, tier) => total + tier.closePercentage, 0
          );
          
          if (totalClosePercentage < 100) {
            logger.warn(`Sum of closure percentages (${totalClosePercentage}%) is less than 100%. The position will not be fully closed.`);
          } else if (totalClosePercentage > 100) {
            logger.warn(`Sum of closure percentages (${totalClosePercentage}%) exceeds 100%. Adjusting proportionally.`);
            // Adjust percentages proportionally
            const ratio = 100 / totalClosePercentage;
            takeProfitConfig.profitTiers.forEach(tier => {
              tier.closePercentage = Math.round(tier.closePercentage * ratio);
            });
            logger.info(`Adjusted closure percentages: ${takeProfitConfig.profitTiers.map(t => t.closePercentage).join('%, ')}%`);
          }
          
          if (validationErrors.length > 0) {
            logger.error(`Erreurs de configuration de la règle 3-5-7: ${validationErrors.join(', ')}`);
          } else {
            logger.info(`Configuration de la règle 3-5-7: niveaux [${takeProfitConfig.profitTiers.map(t => t.profitPercentage).join('%, ')}%], fermetures [${takeProfitConfig.profitTiers.map(t => t.closePercentage).join('%, ')}%]`);
          }

          state.takeProfitIntegrator = createTakeProfitIntegrator(
            actorSystem,
            tradingPort,
            marketDataPort,
            riskManagerPort,
            { 
              watchedSymbols: Array.from(state.marketActors.keys()),
              ...options.takeProfitIntegratorConfig
            }
          );
          state.takeProfitIntegrator.start();
          
          // Configurer le gestionnaire de prise de profit avec la règle 3-5-7
          state.takeProfitIntegrator.takeProfitManager.updateConfig(takeProfitConfig);
          
          // Configurer le gestionnaire de prise de profit si nécessaire
          if (options.takeProfitConfig) {
            state.takeProfitIntegrator.takeProfitManager.updateConfig(options.takeProfitConfig);
          }
          
          logger.info("Take profit manager initialized and started");
        }

        // Start all existing market actors if they exist
        state.marketActors.forEach((actorAddress, symbol) => {
          actorSystem.send(actorAddress, { type: "SUBSCRIBE", symbol });
        });

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
        
        // Arrêter tous les acteurs de stratégie
        for (const [strategyId, actorAddress] of state.strategyActors.entries()) {
          logger.debug(`Stopping strategy actor for: ${strategyId}`);
          try {
            actorSystem.stop(actorAddress);
          } catch (error) {
            logger.error(`Error stopping strategy actor: ${strategyId}`, error as Error);
          }
        }
        
        // Arrêter le gestionnaire de prise de profits
        if (state.takeProfitIntegrator) {
          state.takeProfitIntegrator.stop();
          logger.info("Take profit manager stopped");
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
          // Initialize strategy with historical data before setting up market data
          try {
            if (strategy.initializeWithHistory) {
              logger.info(`Fetching historical data for strategy: ${strategy.getName()}`);
              
              // Calculate required historical data points based on strategy type
              let historicalLimit = 100; // Default for most strategies
              
              // For coordinated multi-strategy, we need more data
              if (strategy.getName().includes('Coordinated Multi-Strategy')) {
                historicalLimit = 250; // Extra buffer for coordinated strategy analysis
                logger.debug(`Using extended historical data limit (${historicalLimit}) for coordinated multi-strategy`);
              }
              
              const historicalData = await marketDataPort.getHistoricalMarketData(symbol, historicalLimit);
              
              if (historicalData && historicalData.length > 0) {
                logger.info(`Initializing strategy ${strategy.getName()} with ${historicalData.length} historical data points`);
                await strategy.initializeWithHistory(historicalData);
                logger.info(`Strategy ${strategy.getName()} successfully initialized with historical data`);
              } else {
                logger.warn(`No historical data available for ${symbol}, strategy will start with real-time data only`);
              }
            } else {
              logger.debug(`Strategy ${strategy.getName()} does not support historical initialization`);
            }
          } catch (error) {
            logger.error(`Failed to initialize strategy ${strategy.getName()} with historical data:`, error as Error);
            logger.warn(`Strategy will continue with real-time data only`);
          }

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
        
        // Créer un acteur de stratégie pour cette stratégie
        try {
          const strategyId = strategy.getId();
          logger.info(`Creating dedicated actor for strategy: ${strategyId}`);
          
          if (state.strategyManagerActor) {
            // D'abord, enregistrer explicitement la stratégie auprès du gestionnaire de stratégies
            actorSystem.send(state.strategyManagerActor, {
              type: "REGISTER_STRATEGY",
              strategy: strategy,
              markets: [(strategy.getConfig().parameters as Record<string, string>).symbol]
            });
            logger.info(`Strategy ${strategyId} registered with StrategyManager`);
            
            // Créer l'acteur de stratégie qui va communiquer avec le Strategy Manager
            const strategyActorDef = createStrategyActorDefinition(
              strategy,
              state.strategyManagerActor
            );
            
            const strategyActorAddress = actorSystem.createActor(strategyActorDef);
            
            // Stocker la référence de l'acteur de stratégie
            state.strategyActors.set(strategyId, strategyActorAddress);
            
            logger.debug(`Created strategy actor for strategy: ${strategyId}`);
          } else {
            logger.warn(`Strategy manager not initialized yet, will create strategy actor later for: ${strategyId}`);
          }
        } catch (error) {
          logger.error(`Error creating strategy actor: ${error instanceof Error ? error.message : String(error)}`);
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

        // Supprimer l'acteur de stratégie s'il existe
        if (state.strategyActors.has(strategyId)) {
          const strategyActorAddress = state.strategyActors.get(strategyId)!;
          logger.debug(`Stopping strategy actor for: ${strategyId}`);
          
          try {
            // Arrêter l'acteur de stratégie
            actorSystem.stop(strategyActorAddress);
            
            // Supprimer de notre map
            state.strategyActors.delete(strategyId);
            
            logger.debug(`Removed strategy actor for: ${strategyId}`);
          } catch (error) {
            logger.error(`Error stopping strategy actor: ${strategyId}`, error as Error);
          }
        }

        // Désenregistrer la stratégie du StrategyManager si celui-ci existe
        if (state.strategyManagerActor) {
          try {
            actorSystem.send(state.strategyManagerActor, {
              type: "UNREGISTER_STRATEGY",
              strategyId
            });
            logger.info(`Strategy ${strategyId} unregistered from StrategyManager`);
          } catch (error) {
            logger.error(`Error unregistering strategy from StrategyManager: ${strategyId}`, error as Error);
          }
        }

        // Unregister the strategy from the service
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

        // Envoyer les données de marché à tous les acteurs de stratégie concernés
        for (const [strategyId, actorAddress] of state.strategyActors.entries()) {
          const strategy = state.strategyService.getStrategy(strategyId);
          if (!strategy) continue;
          
          const strategySymbol = (strategy.getConfig().parameters as Record<string, string>).symbol;
          
          if (strategySymbol === data.symbol) {
            actorSystem.send(actorAddress, {
              type: "PROCESS_MARKET_DATA",
              data,
              tradingBotActorAddress: context.self // Pass TradingBotActor's address
            });
          }
        }

        // Send market update to risk manager to update positions
        if (state.riskManagerActor) {
          actorSystem.send(state.riskManagerActor, {
            type: "MARKET_UPDATE",
            symbol: data.symbol,
            price: data.price,
          });
        }
        
        // Mettre à jour le gestionnaire de prise de profit
        if (state.takeProfitIntegrator && state.positions[data.symbol]) {
          state.takeProfitIntegrator.takeProfitManager.analyzePosition(
            data.symbol,
            data.price
          );
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



        return { state };
      }

      case "CONSOLIDATED_SIGNAL": { // New case to handle consolidated signals
        if (!state.isRunning) {
          logger.debug(`Consolidated signal received but bot is not running`, { strategyId: payload.payload.strategyId });
          return { state };
        }

        const { strategyId, signal, marketData } = payload.payload;

        logger.info(
          `Received consolidated signal from ${strategyId}: ${signal.type} ${signal.direction} @ ${signal.price || marketData.price}`,
        );
        
        // DEBUG: Add comprehensive logging for signal analysis
        logger.info(`🔍 [DEBUG SIGNAL] Signal received from strategy ${strategyId}:`, {
          signalType: signal.type,
          signalDirection: signal.direction,
          signalPrice: signal.price,
          signalReason: signal.reason,
          marketPrice: marketData.price,
          symbol: marketData.symbol
        });
        
        logger.debug(`Consolidated signal details`, {
          strategyId,
          signal: JSON.stringify(signal),
          marketData: JSON.stringify(marketData),
          source: "TradingBotService"
        });

        const order = state.strategyService.generateOrder(
          strategyId,
          signal,
          marketData,
        );

        // DEBUG: Add comprehensive logging for order generation
        logger.info(`🔍 [DEBUG ORDER] Order generation result for strategy ${strategyId}:`, {
          orderGenerated: !!order,
          signal: {
            type: signal.type,
            direction: signal.direction,
            price: signal.price
          },
          order: order ? {
            symbol: order.symbol,
            side: order.side,
            size: order.size,
            price: order.price,
            type: order.type
          } : null
        });

        logger.debug(`Order generation result`, {
          strategyId,
          orderGenerated: !!order,
          order: order ? JSON.stringify(order) : null,
          source: "TradingBotService"
        });

        if (order) {
          try {
            logger.debug(`Starting order processing`, {
              symbol: order.symbol,
              side: order.side,
              size: order.size,
              price: order.price,
              type: order.type,
              source: "TradingBotService"
            });

            let adjustedOrder = { ...order };
            const buyingPowerResult = await checkBuyingPower(
              order,
              marketData.price,
              tradingPort,
            );

            logger.debug(`Buying power check result`, {
              symbol: order.symbol,
              approved: buyingPowerResult.approved,
              reason: buyingPowerResult.reason,
              adjustedSize: buyingPowerResult.adjustedSize,
              adjustedPrice: buyingPowerResult.adjustedPrice,
              riskLevel: buyingPowerResult.riskLevel,
              source: "TradingBotService"
            });

            if (!buyingPowerResult.approved) {
              logger.warn(`Order rejected for ${order.symbol}: ${buyingPowerResult.reason}`);
              
              // Sauvegarder le signal pour un réessai ultérieur
              const pendingSignalId = `${strategyId}_${signal.type}_${signal.direction}_${Date.now()}`;
              const pendingSignal: PendingSignal = {
                id: pendingSignalId,
                strategyId,
                signal,
                symbol: order.symbol,
                timestamp: Date.now(),
                attempts: 1,
                lastAttempt: Date.now(),
                reason: buyingPowerResult.reason || "Rejected by buying power check"
              };
              
              // Ajouter aux signaux en attente
              const updatedPendingSignals = {
                ...state.pendingSignals,
                [pendingSignalId]: pendingSignal
              };
              
              // Planifier un réessai dans 5 minutes
              setTimeout(() => {
                context.send(context.self, {
                  type: "RETRY_SIGNAL",
                  payload: { pendingSignalId }
                });
              }, 5 * 60 * 1000); // 5 minutes
              
              context.send(context.self, {
                type: "ORDER_REJECTED",
                order,
                reason: buyingPowerResult.reason || "Insufficient buying power",
              });
              
              return {
                state: {
                  ...state,
                  pendingSignals: updatedPendingSignals
                }
              };
            }

            if (buyingPowerResult.adjustedSize || buyingPowerResult.adjustedPrice) {
              adjustedOrder = {
                ...adjustedOrder,
                ...(buyingPowerResult.adjustedSize && { size: buyingPowerResult.adjustedSize }),
                ...(buyingPowerResult.adjustedPrice && { price: buyingPowerResult.adjustedPrice })
              };
              
              logger.debug(`Order adjusted`, {
                originalSize: order.size,
                adjustedSize: adjustedOrder.size,
                originalPrice: order.price,
                adjustedPrice: adjustedOrder.price,
                reason: buyingPowerResult.reason,
                source: "TradingBotService"
              });
              
              if (buyingPowerResult.adjustedSize) {
                logger.warn(
                  `Order size adjusted to ${adjustedOrder.size} ${order.symbol.split("-")[0]}: ${buyingPowerResult.reason}`,
                );
              }
              if (buyingPowerResult.adjustedPrice) {
                logger.warn(
                  `Order price adjusted to ${adjustedOrder.price} USD: ${buyingPowerResult.reason}`,
                );
              }
            } else {
              const balances = await tradingPort.getAccountBalance();
              const availableUSDC = balances["USDC"] || 0;
              const orderValue =
                adjustedOrder.size * (adjustedOrder.price || marketData.price);
              const percentageUsed = (orderValue / availableUSDC) * 100;
              logger.info(
                `Order using ${percentageUsed.toFixed(2)}% of available buying power ($${orderValue.toFixed(2)} / $${availableUSDC.toFixed(2)})`,
              );
            }

            logger.debug(`Preparing to place order`, {
              symbol: adjustedOrder.symbol,
              side: adjustedOrder.side,
              size: adjustedOrder.size,
              price: adjustedOrder.price,
              type: adjustedOrder.type,
              timeInForce: adjustedOrder.timeInForce,
              source: "TradingBotService"
            });

            if (adjustedOrder.type === OrderType.LIMIT && adjustedOrder.price) {
              const currentPrice = marketData.price;
              const priceDiff = Math.abs(adjustedOrder.price - currentPrice);
              const priceDiffPercent = (priceDiff / currentPrice) * 100;
              logger.info(
                `Placing LIMIT order at ${adjustedOrder.price} USD (${priceDiffPercent.toFixed(4)}% ${adjustedOrder.price > currentPrice ? 'above' : 'below'} current price of ${currentPrice})`,
              );
            }

            if (state.riskManagerActor) {
              logger.info(
                `Assessing additional risk factors for order on ${order.symbol}`,
              );
              actorSystem.send(state.riskManagerActor, {
                type: "GET_ACCOUNT_RISK",
              });
            }

            // Utiliser l'OrderManager pour placer l'ordre
            if (state.orderManagerActor) {
              logger.debug(`Envoi de l'ordre à l'OrderManager`, {
                symbol: adjustedOrder.symbol,
                side: adjustedOrder.side,
                size: adjustedOrder.size,
                price: adjustedOrder.price,
                type: adjustedOrder.type,
                source: "TradingBotService"
              });
              
              const strategyId = payload.payload.strategyId;
              
              // Préparer la requête d'ordre
              actorSystem.send(state.orderManagerActor, {
                type: "PLACE_ORDER",
                orderRequest: {
                  orderParams: adjustedOrder,
                  strategyId,
                  requestTimestamp: Date.now(),
                  replyToAddress: context.self,
                  attempts: 0,
                  requestId: `req_${Date.now()}_${strategyId}`
                }
              });
              
              // L'ordre sera traité de manière asynchrone, et nous recevrons une notification via ORDER_PLACED ou ORDER_REJECTED
              return { state };
            } else {
              // Fallback: placer l'ordre directement si l'OrderManager n'est pas disponible
              logger.warn("OrderManager n'est pas disponible, placement direct de l'ordre");
              
              const placedOrder = await tradingPort.placeOrder(adjustedOrder);
              const orderTypeStr = adjustedOrder.type === OrderType.LIMIT ? 'LIMIT' : 'MARKET';
              logger.info(
                `${orderTypeStr} order placed: ${placedOrder.id} for ${order.symbol}, ${order.side} ${adjustedOrder.size} @ ${adjustedOrder.price || marketData.price} USD`,
              );
              
              if (adjustedOrder.side === OrderSide.BUY) {
                logger.info(
                  `Total order value: $${(adjustedOrder.size * (adjustedOrder.price || marketData.price)).toFixed(2)} USD`,
                );
                if (adjustedOrder.type === OrderType.LIMIT) {
                  logger.info(
                    `Order will be filled when price reaches ${adjustedOrder.price} USD (timeInForce: ${adjustedOrder.timeInForce || 'GOOD_TIL_CANCEL'})`,
                  );
                }
              }

              context.send(context.self, {
                type: "ORDER_PLACED",
                order: placedOrder,
              });

              if (state.riskManagerActor && adjustedOrder.type === OrderType.MARKET) {
                actorSystem.send(state.riskManagerActor, {
                  type: "ORDER_FILLED",
                  order: placedOrder,
                  fillPrice: marketData.price,
                });
                
                if (signal.type === "entry") {
                  state.positions[order.symbol] = {
                    symbol: order.symbol,
                    direction: signal.direction === "long" ? "long" : "short",
                    size: adjustedOrder.size,
                  };
                  if (state.takeProfitIntegrator) {
                    const position: PositionRisk = {
                      symbol: order.symbol,
                      direction: signal.direction === "long" ? "long" : "short",
                      size: adjustedOrder.size,
                      entryPrice: marketData.price,
                      currentPrice: marketData.price,
                      unrealizedPnl: 0,
                      riskLevel: "LOW",
                      entryTime: Date.now()
                    };
                    state.takeProfitIntegrator.takeProfitManager.positionOpened(position);
                  }
                } else if (signal.type === "exit") {
                  if (state.takeProfitIntegrator) {
                    state.takeProfitIntegrator.takeProfitManager.positionClosed(order.symbol);
                  }
                  delete state.positions[order.symbol];
                }
              } else if (state.riskManagerActor) {
                logger.debug(`Risk manager will be notified when LIMIT order ${placedOrder.id} is filled`);
              }

              if (state.performanceTrackerActor) {
                const tradeEntry = {
                  id: placedOrder.id,
                  strategyId,
                  symbol: order.symbol,
                  entryTime: Date.now(),
                  entryPrice: adjustedOrder.type === OrderType.MARKET ? marketData.price : adjustedOrder.price || marketData.price,
                  entryOrder: placedOrder,
                  quantity: adjustedOrder.size,
                  fees: 0,
                  status: adjustedOrder.type === OrderType.MARKET ? "open" : "pending",
                  tags: [signal.type, signal.direction, adjustedOrder.type.toLowerCase()],
                };
                actorSystem.send(state.performanceTrackerActor, {
                  type: "TRADE_OPENED",
                  trade: tradeEntry,
                });
                logger.debug(`Trade recorded in performance tracker with status: ${tradeEntry.status}`);
              }
            }
          } catch (error) {
            logger.error(
              `Error placing order for ${order.symbol}`,
              error as Error,
              {
                order: JSON.stringify(order),
              },
            );
            context.send(context.self, {
              type: "ORDER_REJECTED",
              order,
              reason: (error as Error)?.message || 'Unknown error placing order',
              error,
            });
          }
        }
        return { state };
      }

      case "ORDER_PLACED": {
        // Handle order placed confirmation
        const { order } = payload;
        logger.info(`Order placed: ${order.id} for ${order.symbol}, ${order.side} ${order.size} @ ${order.price} USD`);

        // Update performance tracker if available
        if (state.performanceTrackerActor) {
          actorSystem.send(state.performanceTrackerActor, {
            type: "TRADE_OPENED",
            trade: {
              id: order.id,
              strategyId: "", // To be filled if needed
              symbol: order.symbol,
              entryTime: Date.now(),
              entryPrice: order.price,
              entryOrder: order,
              quantity: order.size,
              fees: 0,
              status: "open",
              tags: [],
            },
          });
        }

        return { state };
      }

      case "ORDER_REJECTED": {
        const { order, reason } = payload;
        logger.warn(`Order rejected for symbol ${order.symbol} (parameters: ${JSON.stringify(order)}), Reason: ${reason}`);

        // Update order history with rejection reason
        state.rejectedOrders.push({ order, reason });

        return { state };
      }

      case "ORDER_CANCELLED": {
        const { order, reason } = payload;
        logger.info(`Order cancelled: ${order.id} for ${order.symbol}, Reason: ${reason}`);

        // Update order history
        state.cancelledOrders.push({ order, reason });

        return { state };
      }

      case "RISK_ASSESSMENT_RESULT": {
        const { orderId, result } = payload;
        logger.info(`Received risk assessment result for order ${orderId}: ${JSON.stringify(result)}`);

        // Handle risk assessment result (e.g., adjust order, notify user, etc.)
        // For now, we just log it

        return { state };
      }

      case "PERFORMANCE_UPDATE": {
        const { metrics } = payload;
        logger.info(`Received performance update: ${JSON.stringify(metrics)}`);

        // Handle performance metrics update
        // This could involve logging, adjusting strategies, etc.

        return { state };
      }

      case "ANALYZE_POSITIONS": {
        logger.info("Analyzing open positions...");

        for (const [symbol, position] of Object.entries(state.positions)) {
          try {
            const marketData = await marketDataPort.getLatestMarketData(symbol);
            if (state.takeProfitIntegrator) {
              const analysis = await state.takeProfitIntegrator.takeProfitManager.analyzePosition(
                symbol,
                marketData.price
              );
              logger.info(`Position analysis for ${symbol}: ${JSON.stringify(analysis)}`);
            } else {
              logger.warn(`TakeProfitIntegrator not available for position analysis of ${symbol}`);
            }
          } catch (error) {
            logger.error(`Error analyzing position ${symbol}:`, error as Error);
          }
        }

        return { state };
      }

      case "POSITION_VIABILITY_RESULT": {
        const { symbol, isViable, reason, shouldClose, direction, size } = payload;
        logger.info(`Position viability result for ${symbol}: Viable=${isViable}, Reason=${reason}`);

        if (shouldClose) {
          if (typeof size === 'number' && (direction === 'long' || direction === 'short')) {
            logger.info(`Closing position ${symbol} as it's no longer viable (Direction: ${direction}, Size: ${size})`);
            await closePosition(
              symbol,
              direction,
              size,
              marketDataPort,
              tradingPort,
              `Position closed due to viability analysis: ${reason}`,
              context,
            );
          } else {
            logger.error(`Cannot close position ${symbol}: size is undefined or invalid, or direction is not 'long' or 'short'. (Size: ${size}, Direction: ${direction})`);
          }
        }

        return { state };
      }
      
      case "REQUEST_MARKET_DATA": {
        const { symbol, strategyId, signal } = payload.payload;
        logger.info(`Received request for market data for symbol ${symbol} from strategy ${strategyId}`);
        
        try {
          // Get latest market data
          const marketData = await marketDataPort.getLatestMarketData(symbol);
          
          if (marketData) {
            // Send data directly to the StrategyManager
            if (state.strategyManagerActor) {
              // Generate a unique ID for this signal
              const signalId = `${strategyId}_${Date.now()}`;
              
              // Create a pending signal entry for tracking
              const updatedPendingSignals = {
                ...state.pendingSignals,
                [signalId]: {
                  id: signalId,
                  strategyId,
                  signal,
                  symbol,
                  timestamp: Date.now(),
                  attempts: 1,
                  lastAttempt: Date.now(),
                  reason: "Market data requested directly"
                }
              };
              
              // Process signal immediately with the retrieved data
              context.send(context.self, {
                type: "CONSOLIDATED_SIGNAL",
                payload: {
                  strategyId,
                  signal,
                  marketData
                }
              });
              
              return {
                state: {
                  ...state,
                  pendingSignals: updatedPendingSignals
                }
              };
            }
          } else {
            logger.warn(`Failed to fetch market data for symbol ${symbol}`);
          }
        } catch (error) {
          logger.error(`Error fetching market data for symbol ${symbol}:`, error instanceof Error ? error : new Error(String(error)));
        }
        
        return { state };
      }
      
      case "RETRY_SIGNAL": {
        const { pendingSignalId } = payload.payload;
        const pendingSignal = state.pendingSignals[pendingSignalId];
        
        if (!pendingSignal) {
          logger.warn(`Cannot retry signal ${pendingSignalId}: not found in pending signals`);
          return { state };
        }
        
        // Vérifier le nombre de tentatives (max 3)
        if (pendingSignal.attempts >= 3) {
          logger.warn(`Signal ${pendingSignalId} has reached maximum retry attempts (${pendingSignal.attempts}). Abandoning.`);
          
          // Supprimer le signal des signaux en attente
          const { [pendingSignalId]: _, ...remainingSignals } = state.pendingSignals;
          
          return {
            state: {
              ...state,
              pendingSignals: remainingSignals
            }
          };
        }
        
        logger.info(`Retrying signal ${pendingSignalId} (attempt ${pendingSignal.attempts + 1})`);
        
        try {
          // Récupérer les dernières données de marché
          const marketData = await marketDataPort.getLatestMarketData(pendingSignal.symbol);
          
          if (marketData) {
            // Mettre à jour le signal en attente
            const updatedPendingSignal = {
              ...pendingSignal,
              attempts: pendingSignal.attempts + 1,
              lastAttempt: Date.now()
            };
            
            const updatedPendingSignals = {
              ...state.pendingSignals,
              [pendingSignalId]: updatedPendingSignal
            };
            
            // Traiter le signal avec les nouvelles données de marché
            context.send(context.self, {
              type: "CONSOLIDATED_SIGNAL",
              payload: {
                strategyId: pendingSignal.strategyId,
                signal: pendingSignal.signal,
                marketData
              }
            });
            
            return {
              state: {
                ...state,
                pendingSignals: updatedPendingSignals
              }
            };
          } else {
            logger.warn(`Failed to fetch market data for retrying signal ${pendingSignalId}`);
            
            // Planifier un autre réessai avec délai exponentiel
            const delayMs = Math.min(30 * 60 * 1000, 5 * 60 * 1000 * Math.pow(2, pendingSignal.attempts)); // 5min, 10min, 20min, max 30min
            
            setTimeout(() => {
              context.send(context.self, {
                type: "RETRY_SIGNAL",
                payload: { pendingSignalId }
              });
            }, delayMs);
          }
        } catch (error) {
          logger.error(`Error retrying signal ${pendingSignalId}:`, error instanceof Error ? error : new Error(String(error)));
        }
        
        return { state };
      }

      default:
        logger.warn(`Unknown message type: ${(payload as any).type}`);
        return { state };
    }
  };

  return {
    start: () => {
      logger.info("Starting Trading Bot Service");

      const definition: ActorDefinition<TradingBotState, TradingBotMessage> = {
        initialState,
        behavior: tradingBotBehavior,
      };
      // Create actor without a name/ID parameter, the system will assign an address.
      tradingBotActorAddress = actorSystem.createActor(definition);
      
      if (tradingBotActorAddress) {
        logger.info(`Trading Bot Actor created with address: ${JSON.stringify(tradingBotActorAddress)}`);
        actorSystem.send(tradingBotActorAddress, { type: "START" });
      } else {
        logger.error("Failed to create and obtain address for Trading Bot Actor.");
      }
    },
    stop: () => {
      logger.info("Stopping Trading Bot Service");
      if (tradingBotActorAddress) {
        actorSystem.send(tradingBotActorAddress, { type: "STOP" });
      } else {
        logger.warn("Trading Bot Actor address not available to send STOP command.");
      }
    },
    addStrategy: (strategy) => {
      logger.info(`Adding strategy to Trading Bot Service: ${strategy.getName()}`);
      if (tradingBotActorAddress) {
        actorSystem.send(tradingBotActorAddress, { type: "ADD_STRATEGY", strategy });
      } else {
        logger.warn("Trading Bot Actor address not available to add strategy.");
      }
    },
    removeStrategy: (strategyId) => {
      logger.info(`Removing strategy from Trading Bot Service: ${strategyId}`);
      if (tradingBotActorAddress) {
        actorSystem.send(tradingBotActorAddress, { type: "REMOVE_STRATEGY", strategyId });
      } else {
        logger.warn("Trading Bot Actor address not available to remove strategy.");
      }
    },
    analyzeOpenPositions: () => {
      logger.info("Requesting analysis of open positions");
      if (tradingBotActorAddress) {
        actorSystem.send(tradingBotActorAddress, { type: "ANALYZE_POSITIONS" });
      } else {
        logger.warn("Trading Bot Actor address not available to analyze positions.");
      }
    },
  };
};
