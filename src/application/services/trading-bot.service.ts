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
  | { type: "CONSOLIDATED_SIGNAL"; payload: { strategyId: string; signal: StrategySignal; marketData: MarketData }}; // Added CONSOLIDATED_SIGNAL

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
  positions: Record<string, { symbol: string; direction: 'long' | 'short' | 'none'; size: number }>;
  takeProfitIntegrator: ReturnType<typeof createTakeProfitIntegrator> | null;
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
    pollInterval: 5000,
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
    positions: {},
    takeProfitIntegrator: null,
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
          for (const [strategyId, strategy] of Object.entries(state.strategyService.getAllStrategies())) {
            try {
              if (!state.strategyActors.has(strategyId)) {
                logger.info(`Creating previously pending strategy actor for: ${strategyId}`);
                const strategyActorDef = createStrategyActorDefinition(
                  strategy,
                  strategyManagerActor
                );
                
                const strategyActorAddress = actorSystem.createActor(strategyActorDef);
                state.strategyActors.set(strategyId, strategyActorAddress);
                logger.debug(`Created strategy actor for previously pending strategy: ${strategyId}`);
              }
            } catch (error) {
              logger.error(`Error creating strategy actor for: ${strategyId}`, error as Error);
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
            logger.warn(`La somme des pourcentages de fermeture (${totalClosePercentage}%) est inférieure à 100%. La position ne sera pas entièrement fermée.`);
          } else if (totalClosePercentage > 100) {
            logger.warn(`La somme des pourcentages de fermeture (${totalClosePercentage}%) est supérieure à 100%. Les pourcentages seront ajustés proportionnellement.`);
            // Ajuster les pourcentages
            const ratio = 100 / totalClosePercentage;
            takeProfitConfig.profitTiers.forEach(tier => {
              tier.closePercentage = Math.round(tier.closePercentage * ratio);
            });
            logger.info(`Pourcentages de fermeture ajustés: ${takeProfitConfig.profitTiers.map(t => t.closePercentage).join('%, ')}%`);
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

        // REMOVED: Direct signal processing and order generation
        // const signals = await state.strategyService.processMarketData(data);
        // for (const [strategyId, signal] of Array.from(signals.entries())) {
        //   ...
        // }

        return { state };
      }

      case "CONSOLIDATED_SIGNAL": { // New case to handle consolidated signals
        if (!state.isRunning) return { state };

        const { strategyId, signal, marketData } = payload.payload;

        logger.info(
          `Received consolidated signal from ${strategyId}: ${signal.type} ${signal.direction} @ ${signal.price || marketData.price}`,
        );

        const order = state.strategyService.generateOrder(
          strategyId,
          signal,
          marketData,
        );

        if (order) {
          try {
            let adjustedOrder = { ...order };
            const buyingPowerResult = await checkBuyingPower(
              order,
              marketData.price,
              tradingPort,
            );

            if (!buyingPowerResult.approved) {
              logger.error(`Order rejected for ${order.symbol}: ${buyingPowerResult.reason}`); // Corrected: Use order.symbol
              context.send(context.self, {
                type: "ORDER_REJECTED",
                order,
                reason: buyingPowerResult.reason || 'Buying power check failed',
              });
              return { state };
            }

            if (buyingPowerResult.adjustedSize || buyingPowerResult.adjustedPrice) {
              adjustedOrder = {
                ...adjustedOrder,
                ...(buyingPowerResult.adjustedSize && { size: buyingPowerResult.adjustedSize }),
                ...(buyingPowerResult.adjustedPrice && { price: buyingPowerResult.adjustedPrice })
              };
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
              // Removed: if (analysis.shouldClose) { ... }
              // Closing logic is likely handled by POSITION_VIABILITY_RESULT or internal mechanisms.
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
        // actorSystem.stop(tradingBotActorAddress); // This would be a hard stop. Prefer graceful shutdown via message.
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
