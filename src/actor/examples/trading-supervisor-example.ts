import { createActorSystem } from "../system";
import { createTradingSupervisor } from "../supervisor/supervisor";
import type {
  ActorAddress,
  ActorBehavior,
  ActorDefinition,
  ActorMessage,
} from "../models/actor.model";
import { SupervisorStrategies } from "../supervisor/strategies";

// Types pour les messages des acteurs de trading
interface PriceMonitorMessage {
  type: "checkPrice" | "priceUpdate" | "subscribe" | "unsubscribe";
  symbol?: string;
  price?: number;
  subscriber?: ActorAddress;
}

interface OrderExecutorMessage {
  type: "placeOrder" | "cancelOrder" | "orderStatus";
  orderId?: string;
  symbol?: string;
  side?: "buy" | "sell";
  quantity?: number;
  price?: number;
}

interface RiskManagerMessage {
  type: "checkRisk" | "updateLimits" | "positionUpdate";
  position?: number;
  exposure?: number;
  maxExposure?: number;
}

// États des acteurs
interface PriceMonitorState {
  prices: Map<string, number>;
  subscribers: Set<ActorAddress>;
  lastUpdate: number;
}

interface OrderExecutorState {
  orders: Map<string, { status: string; details: any }>;
  activeOrdersCount: number;
}

interface RiskManagerState {
  currentExposure: number;
  maxExposure: number;
  positions: Map<string, number>;
}

// Comportement du moniteur de prix
const priceMonitorBehavior: ActorBehavior<PriceMonitorState, PriceMonitorMessage> = async (
  state,
  message,
  context,
) => {
  switch (message.payload.type) {
    case "checkPrice":
      // Simuler une vérification de prix qui peut échouer
      if (Math.random() < 0.1) {
        throw new Error("API rate limit exceeded");
      }

      // Simuler la récupération de prix
      const newPrices = new Map(state.prices);
      ["BTC", "ETH", "SOL"].forEach((symbol) => {
        const currentPrice = newPrices.get(symbol) || 100;
        const change = (Math.random() - 0.5) * 10;
        newPrices.set(symbol, currentPrice + change);
      });

      // Notifier les abonnés
      state.subscribers.forEach((subscriber) => {
        context.send(subscriber, {
          type: "priceUpdate",
          prices: Array.from(newPrices.entries()),
        });
      });

      return {
        state: {
          ...state,
          prices: newPrices,
          lastUpdate: Date.now(),
        },
      };

    case "subscribe":
      if (message.payload.subscriber) {
        state.subscribers.add(message.payload.subscriber);
      }
      return { state };

    case "unsubscribe":
      if (message.payload.subscriber) {
        state.subscribers.delete(message.payload.subscriber);
      }
      return { state };

    default:
      return { state };
  }
};

// Comportement de l'exécuteur d'ordres
const orderExecutorBehavior: ActorBehavior<OrderExecutorState, OrderExecutorMessage> = async (
  state,
  message,
  context,
) => {
  switch (message.payload.type) {
    case "placeOrder":
      // Simuler une erreur de connexion
      if (Math.random() < 0.05) {
        throw new Error("ECONNREFUSED: Exchange connection failed");
      }

      // Simuler une erreur de validation
      if (!message.payload.symbol || !message.payload.quantity) {
        throw new Error("Invalid order parameters");
      }

      const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      state.orders.set(orderId, {
        status: "pending",
        details: {
          symbol: message.payload.symbol,
          side: message.payload.side,
          quantity: message.payload.quantity,
          price: message.payload.price,
          timestamp: Date.now(),
        },
      });

      // Notifier le risk manager
      const parent = context.parent();
      if (parent) {
        context.send(parent, {
          type: "createChild",
          definition: {
            behavior: async (state, message) => ({ state }),
            initialState: {},
          },
          name: `order-monitor-${orderId}`,
        });
      }

      return {
        state: {
          ...state,
          activeOrdersCount: state.activeOrdersCount + 1,
        },
      };

    case "cancelOrder":
      if (message.payload.orderId && state.orders.has(message.payload.orderId)) {
        const order = state.orders.get(message.payload.orderId)!;
        order.status = "cancelled";
        return {
          state: {
            ...state,
            activeOrdersCount: Math.max(0, state.activeOrdersCount - 1),
          },
        };
      }
      return { state };

    default:
      return { state };
  }
};

// Comportement du gestionnaire de risque
const riskManagerBehavior: ActorBehavior<RiskManagerState, RiskManagerMessage> = async (
  state,
  message,
  context,
) => {
  switch (message.payload.type) {
    case "checkRisk":
      if (state.currentExposure > state.maxExposure) {
        throw new Error("Risk limit exceeded - position limit breached");
      }
      return { state };

    case "updateLimits":
      if (message.payload.maxExposure) {
        return {
          state: {
            ...state,
            maxExposure: message.payload.maxExposure,
          },
        };
      }
      return { state };

    case "positionUpdate":
      if (message.payload.position !== undefined && message.payload.symbol) {
        state.positions.set(message.payload.symbol, message.payload.position);
        const totalExposure = Array.from(state.positions.values()).reduce(
          (sum, pos) => sum + Math.abs(pos),
          0,
        );
        return {
          state: {
            ...state,
            currentExposure: totalExposure,
          },
        };
      }
      return { state };

    default:
      return { state };
  }
};

// Définitions des acteurs avec stratégies de supervision
const priceMonitorDefinition: ActorDefinition<PriceMonitorState, PriceMonitorMessage> = {
  behavior: priceMonitorBehavior,
  initialState: {
    prices: new Map(),
    subscribers: new Set(),
    lastUpdate: Date.now(),
  },
  supervisorStrategy: SupervisorStrategies.restart(10, 60000), // 10 redémarrages max en 1 minute
  preStart: async (context) => {
    console.log(`Price Monitor ${context.self} starting...`);
    // Programmer des vérifications périodiques
    context.schedule(5000, context.self, { type: "checkPrice" });
  },
  postStop: async (context) => {
    console.log(`Price Monitor ${context.self} stopped`);
  },
};

const orderExecutorDefinition: ActorDefinition<OrderExecutorState, OrderExecutorMessage> = {
  behavior: orderExecutorBehavior,
  initialState: {
    orders: new Map(),
    activeOrdersCount: 0,
  },
  supervisorStrategy: {
    type: "restart",
    maxRetries: 5,
    withinTimeMs: 300000, // 5 minutes
  },
  preRestart: async (context, error) => {
    console.log(`Order Executor ${context.self} restarting due to:`, error.message);
  },
  postRestart: async (context) => {
    console.log(`Order Executor ${context.self} restarted successfully`);
  },
};

const riskManagerDefinition: ActorDefinition<RiskManagerState, RiskManagerMessage> = {
  behavior: riskManagerBehavior,
  initialState: {
    currentExposure: 0,
    maxExposure: 100000, // $100k max exposure
    positions: new Map(),
  },
  supervisorStrategy: SupervisorStrategies.escalate(), // Les erreurs de risque sont critiques
};

// Exemple d'utilisation
export async function runTradingSystemExample() {
  console.log("Starting Trading System with Supervisor Pattern...\n");

  // Créer le système d'acteurs
  const system = createActorSystem();

  // Créer le superviseur principal pour le trading
  const tradingSupervisor = system.createRootSupervisor(createTradingSupervisor());

  // Créer les acteurs enfants via le superviseur
  system.send(tradingSupervisor, {
    type: "createChild",
    definition: priceMonitorDefinition,
    name: "price-monitor",
  });

  system.send(tradingSupervisor, {
    type: "createChild",
    definition: orderExecutorDefinition,
    name: "order-executor",
  });

  system.send(tradingSupervisor, {
    type: "createChild",
    definition: riskManagerDefinition,
    name: "risk-manager",
  });

  // Attendre que les acteurs soient créés
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Obtenir la liste des enfants
  system.send(tradingSupervisor, { type: "getChildren" });

  // Simuler des opérations de trading
  console.log("\nSimulating trading operations...\n");

  // Simuler des mises à jour de prix périodiques
  const priceUpdateInterval = setInterval(() => {
    system.send(tradingSupervisor, {
      type: "createChild",
      definition: {
        behavior: async (state, message, context) => {
          // Envoyer un message au price monitor
          context.send("price-monitor" as ActorAddress, { type: "checkPrice" });
          context.stop();
          return { state };
        },
        initialState: {},
      },
    });
  }, 10000);

  // Simuler des ordres
  setTimeout(() => {
    console.log("\nPlacing test orders...\n");

    system.send(tradingSupervisor, {
      type: "createChild",
      definition: {
        behavior: async (state, message, context) => {
          // Placer quelques ordres
          const orderExecutor = "order-executor" as ActorAddress;

          context.send(orderExecutor, {
            type: "placeOrder",
            symbol: "BTC",
            side: "buy",
            quantity: 0.1,
            price: 45000,
          });

          context.send(orderExecutor, {
            type: "placeOrder",
            symbol: "ETH",
            side: "sell",
            quantity: 2,
            price: 3000,
          });

          // Ordre invalide pour tester la gestion d'erreur
          context.send(orderExecutor, {
            type: "placeOrder",
            symbol: "INVALID",
            // Manque les paramètres requis
          });

          context.stop();
          return { state };
        },
        initialState: {},
      },
    });
  }, 5000);

  // Arrêter le système après 30 secondes
  setTimeout(() => {
    console.log("\nStopping Trading System...\n");
    clearInterval(priceUpdateInterval);
    system.send(tradingSupervisor, { type: "stopAllChildren" });
    setTimeout(() => {
      system.stop(tradingSupervisor);
      console.log("Trading System stopped.");
    }, 1000);
  }, 30000);
}

// Pour exécuter l'exemple
if (require.main === module) {
  runTradingSystemExample().catch(console.error);
}
