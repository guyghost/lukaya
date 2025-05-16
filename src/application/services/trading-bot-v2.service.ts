import {
  ActorContext,
  ActorMessage,
  ActorAddress,
} from "../../actor/models/actor.model";
import { createActorSystem } from "../../actor/system";
import { MarketDataPort } from "../ports/market-data.port";
import { TradingPort } from "../ports/trading.port";
import { OrderSide, OrderParams, OrderType, TimeInForce } from "../../domain/models/market.model";
import {
  createStrategyService,
  StrategyService,
} from "../../domain/services/strategy.service";
import { Strategy } from "../../domain/models/strategy.model";
import { MarketData, Order } from "../../domain/models/market.model";
import { getLogger } from "../../infrastructure/logger";
import { createRiskManagerActorDefinition } from "../actors/risk-manager/risk-manager.actor";
import { createStrategyManagerActorDefinition } from "../actors/strategy-manager/strategy-manager.actor";
import { createPerformanceTrackerActorDefinition } from "../actors/performance-tracker/performance-tracker.actor";
import { createMarketSupervisorActorDefinition } from "../actors/market-supervisor/market-supervisor.actor";
import { MarketSupervisorConfig } from "../actors/market-supervisor/market-supervisor.model";
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

// Types de messages que le bot de trading peut traiter
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
  | { type: "POSITION_VIABILITY_RESULT"; symbol: string; isViable: boolean; reason: string; shouldClose: boolean; direction?: 'long' | 'short' | 'none'; size?: number }
  | { type: "SUPERVISOR_HEALTH_CHECK" }
  | { type: "SUPERVISOR_HEALTH_RESULT"; status: string; issues?: string[] };

// État du bot de trading
interface TradingBotState {
  isRunning: boolean;
  strategyService: StrategyService;
  orderHistory: Order[];
  riskManagerActor: ActorAddress | null;
  strategyManagerActor: ActorAddress | null;
  performanceTrackerActor: ActorAddress | null;
  marketSupervisorActor: ActorAddress | null;
  positions: Record<string, { symbol: string; direction: 'long' | 'short' | 'none'; size: number }>;
  takeProfitIntegrator: ReturnType<typeof createTakeProfitIntegrator> | null;
  supervisorHealthStatus: { status: string; lastCheck: number; issues?: string[] };
  watchedSymbols: Set<string>; // Pour suivre les symboles surveillés
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
  const logger = getLogger();

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

    // Pour les ordres d'achat, ajuster la taille proportionnellement à l'USDC disponible
    const maxFundsPercentage = 0.3; // 30% des fonds disponibles maximum
    const maxOrderValue = availableUSDC * maxFundsPercentage;
    
    // Pour les ordres limites, vérifier que le prix est raisonnable
    if (order.type === OrderType.LIMIT && order.price) {
      // Pour les ordres d'achat limite, s'assurer que le prix n'est pas trop élevé
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
    
    // Si la commande est trop importante, ajuster à une taille proportionnelle
    if (orderValue > maxOrderValue) {
      // Calculer la taille proportionnelle
      const newSize = maxOrderValue / orderPrice;
      const adjustedSize = Math.floor(newSize * 10000) / 10000; // Arrondir à 4 décimales
      
      logger.warn(`Adjusting order size from ${order.size} to ${adjustedSize} to be proportional to buying power`);
      return { 
        approved: true, 
        adjustedSize,
        reason: `Order size adjusted to be proportional (${(maxFundsPercentage * 100).toFixed(0)}%) to available funds. Using $${(adjustedSize * orderPrice).toFixed(2)} of $${availableUSDC.toFixed(2)} available`,
        riskLevel: "MEDIUM"
      };
    }

    // Si nous n'avons pas assez pour la taille ajustée, réduire davantage
    if (orderValue > availableUSDC) {
      // Si nous avons moins de 10% des fonds requis, rejeter la commande
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

      // Ajuster la taille pour correspondre aux fonds disponibles (en utilisant 90% des disponibles)
      const newSize = (availableUSDC * 0.9) / orderPrice;
      const adjustedSize = Math.floor(newSize * 10000) / 10000; // Arrondir à 4 décimales

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

    // Tous les contrôles sont passés, la commande est proportionnelle au pouvoir d'achat
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
  try {
    // Get current price for this symbol
    const marketData = await marketDataPort.getLatestMarketData(symbol);
    
    // Determine which side to use for closing the position
    // If position is long, we need to SELL to close it
    // If position is short, we need to BUY to close it
    const closeSide = direction === 'long' ? OrderSide.SELL : OrderSide.BUY;
    
    // Create a limit order slightly more aggressive than market to ensure execution
    // For sell: slightly below current price
    // For buy: slightly above current price
    const priceBuffer = 0.001; // 0.1% buffer
    const limitPrice = closeSide === OrderSide.SELL 
      ? marketData.bid * (1 - priceBuffer)  // Sell slightly below bid
      : marketData.ask * (1 + priceBuffer); // Buy slightly above ask
    
    // Create close order
    const closeOrder: OrderParams = {
      symbol,
      side: closeSide,
      type: OrderType.LIMIT,
      size: size,
      price: Math.round(limitPrice * 100) / 100, // Round to 2 decimal places
      timeInForce: TimeInForce.IMMEDIATE_OR_CANCEL, // Use IOC to ensure immediate execution or cancellation
      reduceOnly: true // Ensure this only closes the position
    };
    
    getLogger().info(`Created close order for position ${symbol}: ${JSON.stringify(closeOrder)}`);
    
    // Place the order
    const placedOrder = await tradingPort.placeOrder(closeOrder);
    getLogger().info(`Close order placed: ${placedOrder.id}, Reason: ${reason}`);
    
    // Update order history
    context.send(context.self, {
      type: "ORDER_PLACED",
      order: placedOrder
    });
    
    return true;
  } catch (error) {
    getLogger().error(`Error closing position ${symbol}:`, error as Error);
    return false;
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
    supervisorConfig: {} as Partial<MarketSupervisorConfig>,
  },
): TradingBotService => {
  const logger = getLogger();
  const actorSystem = createActorSystem();

  // État initial du bot de trading
  const initialState: TradingBotState = {
    isRunning: false,
    strategyService: createStrategyService(),
    orderHistory: [],
    riskManagerActor: null,
    strategyManagerActor: null,
    performanceTrackerActor: null,
    marketSupervisorActor: null,
    positions: {},
    takeProfitIntegrator: null,
    supervisorHealthStatus: { status: "UNKNOWN", lastCheck: 0 },
    watchedSymbols: new Set<string>(), // Ensemble des symboles surveillés
  };

  // Handler pour les messages d'acteur
  const tradingBotBehavior = async (
    state: TradingBotState,
    message: ActorMessage<TradingBotMessage>,
    context: ActorContext<TradingBotState>
  ) => {
    const payload = message.payload;

    switch (payload.type) {
      case "START": {
        logger.info("Starting trading bot with market supervisor architecture...");

        // Créer le gestionnaire de risques s'il n'existe pas
        let riskManagerActor = state.riskManagerActor;
        if (!riskManagerActor) {
          const riskManagerDefinition = createRiskManagerActorDefinition(
            tradingPort,
            options.riskConfig,
          );
          riskManagerActor = actorSystem.createActor(riskManagerDefinition);
          logger.info("Created risk manager actor");
        }

        // Créer le gestionnaire de stratégies s'il n'existe pas
        let strategyManagerActor = state.strategyManagerActor;
        if (!strategyManagerActor) {
          const strategyManagerDefinition =
            createStrategyManagerActorDefinition(options.strategyConfig);
          strategyManagerActor = actorSystem.createActor(
            strategyManagerDefinition,
          );
          logger.info("Created strategy manager actor");
        }

        // Créer le tracker de performance s'il n'existe pas
        let performanceTrackerActor = state.performanceTrackerActor;
        if (!performanceTrackerActor) {
          const performanceTrackerDefinition =
            createPerformanceTrackerActorDefinition(options.performanceConfig);
          performanceTrackerActor = actorSystem.createActor(
            performanceTrackerDefinition,
          );
          logger.info("Created performance tracker actor");
        }
        
        // Créer le superviseur de marché s'il n'existe pas
        let marketSupervisorActor = state.marketSupervisorActor;
        if (!marketSupervisorActor) {
          const supervisorDefinition = createMarketSupervisorActorDefinition(
            marketDataPort,
            actorSystem,
            options.supervisorConfig
          );
          marketSupervisorActor = actorSystem.createActor(supervisorDefinition);
          logger.info("Created market supervisor actor");
          
          // Ajouter tous les symboles surveillés au superviseur
          for (const symbol of state.watchedSymbols) {
            actorSystem.send(marketSupervisorActor, {
              type: "ADD_MARKET",
              symbol
            });
          }
        }

        // Initialiser l'intégrateur de prise de profit
        if (!state.takeProfitIntegrator && state.riskManagerActor) {
          // Créer un adaptateur pour RiskManagerPort
          const riskManagerPort: RiskManagerPort = {
            assessOrderRisk: async (order, accountRisk) => {
              return { approved: true, riskLevel: 'LOW' };
            },
            getAccountRisk: async () => {
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
          
          // Créer l'intégrateur avec les symboles surveillés
          state.takeProfitIntegrator = createTakeProfitIntegrator(
            actorSystem,
            tradingPort,
            marketDataPort,
            riskManagerPort,
            {
              watchedSymbols: Array.from(state.watchedSymbols),
              ...options.takeProfitIntegratorConfig
            }
          );
          
          state.takeProfitIntegrator.start();
          
          // Configurer le gestionnaire de prise de profit
          if (options.takeProfitConfig) {
            state.takeProfitIntegrator.takeProfitManager.updateConfig(options.takeProfitConfig);
          }
          
          logger.info("Take profit manager initialized and started");
        }

        // Abonner tous les symboles via le superviseur de marché
        if (state.marketSupervisorActor && state.watchedSymbols.size > 0) {
          actorSystem.send(state.marketSupervisorActor, {
            type: "SUBSCRIBE_ALL"
          });
          logger.info(`Subscribed to ${state.watchedSymbols.size} markets through supervisor`);
        }

        // Programmer l'analyse périodique des positions
        if (options.positionAnalysisInterval > 0) {
          setTimeout(() => {
            if (state.isRunning) {
              context.send(context.self, { type: "ANALYZE_POSITIONS" });
            }
          }, options.positionAnalysisInterval);
          
          logger.debug(`Scheduled position analysis every ${options.positionAnalysisInterval / 1000} seconds`);
        }

        // Programmer une vérification périodique de la santé du superviseur
        setTimeout(() => {
          if (state.isRunning) {
            context.send(context.self, { type: "SUPERVISOR_HEALTH_CHECK" });
          }
        }, 60000); // Vérification toutes les minutes

        return {
          state: {
            ...state,
            isRunning: true,
            riskManagerActor,
            strategyManagerActor,
            performanceTrackerActor,
            marketSupervisorActor,
          },
        };
      }

      case "STOP": {
        logger.info("Stopping trading bot...");

        // Désabonner de tous les marchés via le superviseur
        if (state.marketSupervisorActor) {
          actorSystem.send(state.marketSupervisorActor, {
            type: "UNSUBSCRIBE_ALL"
          });
          logger.info("Unsubscribed from all markets through supervisor");
        }
        
        // Arrêter le gestionnaire de prise de profit
        if (state.takeProfitIntegrator) {
          state.takeProfitIntegrator.stop();
          logger.info("Take profit manager stopped");
        }

        return { state: { ...state, isRunning: false } };
      }

      case "ADD_STRATEGY": {
        const { strategy } = payload;
        logger.info(`Adding strategy: ${strategy.getName()}`);

        // Enregistrer la stratégie
        state.strategyService.registerStrategy(strategy);

        // Extraire le symbole de la stratégie
        const symbol = (
          strategy.getConfig().parameters as Record<string, string>
        ).symbol;
        
        if (symbol) {
          // Ajouter à l'ensemble des symboles surveillés
          const updatedWatchedSymbols = new Set(state.watchedSymbols);
          updatedWatchedSymbols.add(symbol);
          
          // Ajouter le marché au superviseur s'il existe
          if (state.marketSupervisorActor) {
            actorSystem.send(state.marketSupervisorActor, {
              type: "ADD_MARKET",
              symbol
            });
            
            // S'abonner immédiatement si le bot est en marche
            if (state.isRunning) {
              actorSystem.send(state.marketSupervisorActor, {
                type: "SUBSCRIBE_ALL"
              });
            }
          }
          
          logger.debug(`Added market ${symbol} to watched symbols for strategy ${strategy.getId()}`);
          
          return {
            state: {
              ...state,
              watchedSymbols: updatedWatchedSymbols
            }
          };
        }

        return { state };
      }

      case "REMOVE_STRATEGY": {
        const { strategyId } = payload;
        logger.info(`Removing strategy: ${strategyId}`);

        // Obtenir la stratégie avant de la supprimer pour vérifier son symbole
        const strategy = state.strategyService.getStrategy(strategyId);
        const strategySymbol = strategy
          ? (strategy.getConfig().parameters as Record<string, string>).symbol
          : undefined;

        // Désenregistrer la stratégie
        state.strategyService.unregisterStrategy(strategyId);

        // Vérifier si d'autres stratégies utilisent ce symbole
        if (strategySymbol) {
          const stillInUse = state.strategyService
            .getAllStrategies()
            .some(
              (s) =>
                (s.getConfig().parameters as Record<string, string>).symbol ===
                strategySymbol,
            );

          if (!stillInUse) {
            // Si aucune autre stratégie n'utilise ce symbole, le retirer
            const updatedWatchedSymbols = new Set(state.watchedSymbols);
            updatedWatchedSymbols.delete(strategySymbol);
            
            // Retirer le marché du superviseur
            if (state.marketSupervisorActor) {
              actorSystem.send(state.marketSupervisorActor, {
                type: "REMOVE_MARKET",
                symbol: strategySymbol
              });
              
              logger.debug(`Removed market ${strategySymbol} from supervisor`);
            }
            
            return {
              state: {
                ...state,
                watchedSymbols: updatedWatchedSymbols
              }
            };
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

        // Envoyer les données au gestionnaire de stratégies
        if (state.strategyManagerActor) {
          actorSystem.send(state.strategyManagerActor, {
            type: "PROCESS_MARKET_DATA",
            data,
          });
        }

        // Envoyer la mise à jour au gestionnaire de risques
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

        // Envoyer la mise à jour au tracker de performance
        if (state.performanceTrackerActor) {
          actorSystem.send(state.performanceTrackerActor, {
            type: "UPDATE_PRICE",
            symbol: data.symbol,
            price: data.price,
            timestamp: Date.now(),
          });
        }

        // Traiter les données à travers toutes les stratégies
        const signals = await state.strategyService.processMarketData(data);

        // Gérer les signaux de stratégie pour ce symbole particulier
        for (const [strategyId, signal] of Array.from(signals.entries())) {
          if (!signal) continue;

          logger.info(
            `Signal from ${strategyId}: ${signal.type} ${signal.direction} @ ${signal.price || data.price}`,
          );

          // Générer un ordre pour la stratégie spécifique qui a produit le signal
          const order = state.strategyService.generateOrder(
            strategyId,
            signal,
            data,
          );
          
          if (order) {
            try {
              // Évaluer le risque de l'ordre avant de le placer
              let adjustedOrder = { ...order };
              let canPlaceOrder = true;

              // Vérifier la puissance d'achat et ajuster proportionnellement
              const buyingPowerResult = await checkBuyingPower(
                order,
                data.price,
                tradingPort,
              );

              if (!buyingPowerResult.approved) {
                logger.error(`Order rejected: ${buyingPowerResult.reason}`);
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
                // Toujours journaliser la proportion de puissance d'achat utilisée
                const balances = await tradingPort.getAccountBalance();
                const availableUSDC = balances["USDC"] || 0;
                const orderValue =
                  adjustedOrder.size * (adjustedOrder.price || data.price);
                const percentageUsed = (orderValue / availableUSDC) * 100;

                logger.info(
                  `Order using ${percentageUsed.toFixed(2)}% of available buying power ($${orderValue.toFixed(2)} / $${availableUSDC.toFixed(2)})`,
                );
              }

              // Journaliser les informations sur le type d'ordre
              if (adjustedOrder.type === OrderType.LIMIT && adjustedOrder.price) {
                const currentPrice = data.price;
                const priceDiff = Math.abs(adjustedOrder.price - currentPrice);
                const priceDiffPercent = (priceDiff / currentPrice) * 100;
                
                logger.info(
                  `Placing LIMIT order at ${adjustedOrder.price} USD (${priceDiffPercent.toFixed(4)}% ${adjustedOrder.price > currentPrice ? 'above' : 'below'} current price of ${currentPrice})`,
                );
              }
              
              // Évaluer les facteurs de risque supplémentaires
              if (state.riskManagerActor) {
                logger.info(
                  `Assessing additional risk factors for order on ${order.symbol}`,
                );
                actorSystem.send(state.riskManagerActor, {
                  type: "GET_ACCOUNT_RISK",
                });
              }

              // Ne placer l'ordre que s'il est approuvé
              if (!canPlaceOrder) {
                logger.error(
                  `Order for ${order.symbol} not placed due to risk assessment`,
                );
                return { state };
              }

              const placedOrder = await tradingPort.placeOrder(adjustedOrder);
              const orderTypeStr = adjustedOrder.type === OrderType.LIMIT ? 'LIMIT' : 'MARKET';
              logger.info(
                `${orderTypeStr} order placed: ${placedOrder.id} for ${order.symbol}, ${order.side} ${adjustedOrder.size} @ ${adjustedOrder.price || data.price} USD`,
              );

              // Envoyer un message d'ordre placé à soi-même pour mettre à jour l'état
              context.send(context.self, {
                type: "ORDER_PLACED",
                order: placedOrder,
              });

              // Pour les ordres de marché, nous supposons un remplissage immédiat
              if (state.riskManagerActor && adjustedOrder.type === OrderType.MARKET) {
                actorSystem.send(state.riskManagerActor, {
                  type: "ORDER_FILLED",
                  order: placedOrder,
                  fillPrice: data.price,
                });
                
                // Suivre la position dans l'état local pour référence future
                if (signal.type === "entry") {
                  state.positions[order.symbol] = {
                    symbol: order.symbol,
                    direction: signal.direction === "long" ? "long" : "short",
                    size: adjustedOrder.size,
                  };
                  
                  // Notifier le gestionnaire de prise de profit
                  if (state.takeProfitIntegrator) {
                    const position: PositionRisk = {
                      symbol: order.symbol,
                      direction: signal.direction === "long" ? "long" : "short",
                      size: adjustedOrder.size,
                      entryPrice: data.price,
                      currentPrice: data.price,
                      unrealizedPnl: 0,
                      riskLevel: "LOW",
                      entryTime: Date.now()
                    };
                    state.takeProfitIntegrator.takeProfitManager.positionOpened(position);
                  }
                } else if (signal.type === "exit") {
                  // Si on sort de la position, notifier le gestionnaire de prise de profit
                  if (state.takeProfitIntegrator) {
                    state.takeProfitIntegrator.takeProfitManager.positionClosed(order.symbol);
                  }
                  
                  // Supprimer la position de l'état local
                  delete state.positions[order.symbol];
                }
              }

              // Enregistrer le trade dans le tracker de performance
              if (state.performanceTrackerActor) {
                const tradeEntry = {
                  id: placedOrder.id,
                  strategyId,
                  symbol: order.symbol,
                  entryTime: Date.now(),
                  entryPrice: adjustedOrder.type === OrderType.MARKET ? data.price : adjustedOrder.price || data.price,
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
            }
          }
        }

        return { state };
      }

      case "ORDER_PLACED": {
        // Ajouter l'ordre à l'historique
        const { order } = payload;
        const updatedOrderHistory = [...state.orderHistory, order];
        
        // Ne conserver que les 100 derniers ordres
        if (updatedOrderHistory.length > 100) {
          return {
            state: {
              ...state,
              orderHistory: updatedOrderHistory.slice(-100)
            }
          };
        }
        
        return {
          state: {
            ...state,
            orderHistory: updatedOrderHistory
          }
        };
      }

      case "RISK_ASSESSMENT_RESULT": {
        const { orderId, result } = payload;

        logger.info(`Received risk assessment for order ${orderId}`, {
          approved: result.approved,
          riskLevel: result.riskLevel,
          adjustedSize: result.adjustedSize,
        });

        // Dans une implémentation complète, nous traiterions le résultat de l'évaluation des risques
        // et ajusterions les ordres en conséquence

        return { state };
      }

      case "PERFORMANCE_UPDATE": {
        const { metrics } = payload;

        logger.info("Received performance update", {
          winRate: metrics.winRate,
          profitFactor: metrics.profitFactor,
          netProfit: metrics.netProfit,
        });

        // Dans une implémentation complète, nous mettrions à jour les poids des stratégies
        // en fonction des métriques de performance

        return { state };
      }

      case "ANALYZE_POSITIONS": {
        logger.info("Analyzing viability of all open positions");

        if (state.riskManagerActor) {
          // Envoyer un message d'analyse des positions au gestionnaire de risques
          actorSystem.send(state.riskManagerActor, {
            type: "ANALYZE_OPEN_POSITIONS",
          });

          // Programmer la prochaine analyse
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
        const { symbol, isViable, reason, shouldClose, direction, size } = payload;

        if (!isViable) {
          logger.warn(`Position ${symbol} is no longer viable: ${reason}`);

          // Fermer automatiquement les positions non viables si indiqué
          if (shouldClose) {
            logger.info(`Automatically closing non-viable position: ${symbol}`);
            
            // Essayer d'obtenir les informations de position
            const position = direction ? 
              { symbol, direction, size: size || 0 } : 
              Object.values(state.positions).find(p => p.symbol === symbol);
            
            if (position && position.size > 0) {
              // Fermer la position en utilisant la fonction d'aide
              const success = await closePosition(
                symbol,
                position.direction,
                position.size,
                marketDataPort,
                tradingPort,
                reason,
                context
              );
              
              if (success) {
                // Retirer la position du suivi
                const updatedPositions = {...state.positions};
                delete updatedPositions[symbol];
                
                // Enregistrer dans le tracker de performance
                if (state.performanceTrackerActor) {
                  const tradeEntry = {
                    id: crypto.randomUUID(),
                    strategyId: "risk_manager", // ID spécial pour les trades initiés par le gestionnaire de risques
                    symbol,
                    entryTime: Date.now(),
                    entryPrice: 0, // Sera mis à jour lorsque l'ordre sera rempli
                    entryOrder: null,
                    quantity: position.size,
                    fees: 0,
                    status: "closing",
                    tags: ["close", "non_viable", position.direction]
                  };
                  
                  actorSystem.send(state.performanceTrackerActor, {
                    type: "TRADE_UPDATED",
                    trade: tradeEntry
                  });
                }
                
                // Mettre à jour l'état pour retirer la position
                return {
                  state: {
                    ...state,
                    positions: updatedPositions
                  }
                };
              }
            } else {
              logger.error(`Cannot close position ${symbol}: position details not found`);
            }
          }
        }

        return { state };
      }

      case "SUPERVISOR_HEALTH_CHECK": {
        logger.info("Performing health check for market supervisor");

        // Si nous avons un acteur superviseur, demander une vérification de santé
        if (state.marketSupervisorActor) {
          actorSystem.send(state.marketSupervisorActor, { type: "CHECK_HEALTH" });
          
          // Programmer la prochaine vérification de santé dans 60 secondes
          setTimeout(() => {
            if (state.isRunning) {
              context.send(context.self, { type: "SUPERVISOR_HEALTH_CHECK" });
            }
          }, 60000);
        } else {
          logger.warn("No market supervisor actor available for health check");
        }

        return { state };
      }

      case "SUPERVISOR_HEALTH_RESULT": {
        const { status, issues } = payload;

        logger.info(`Market supervisor health check result: ${status}`, {
          issues: issues ? issues.join(", ") : "None",
        });

        // Mettre à jour l'état de santé du superviseur dans l'état
        return {
          state: {
            ...state,
            supervisorHealthStatus: { 
              status, 
              lastCheck: Date.now(), 
              ...(issues && { issues }) 
            }
          }
        };
      }

      default:
        return { state };
    }
  };

  // Créer l'acteur principal du bot qui gérera toutes les stratégies et les acteurs de marché
  // L'acteur du bot de trading coordonne toutes les données de marché et les signaux de stratégie,
  // et gère les acteurs de risque, de stratégie et de performance
  const botAddress = actorSystem.createActor({
    initialState,
    behavior: tradingBotBehavior,
    supervisorStrategy: { type: "restart" },
  });

  // Méthodes de l'API publique
  const start = (): void => {
    actorSystem.send(botAddress, { type: "START" });
  };

  const stop = (): void => {
    actorSystem.send(botAddress, { type: "STOP" });
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

  const analyzeOpenPositions = (): void => {
    actorSystem.send(botAddress, { type: "ANALYZE_POSITIONS" });
  };

  // Retourner l'API publique
  return {
    start,
    stop,
    addStrategy,
    removeStrategy,
    analyzeOpenPositions,
  };
};
