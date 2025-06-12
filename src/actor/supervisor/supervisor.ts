import type {
  ActorAddress,
  ActorBehavior,
  ActorContext,
  ActorDefinition,
  ActorMessage,
  SupervisionContext,
  SupervisionDecision,
  SystemMessage,
} from "../models/actor.model";
import {
  OneForOneStrategy,
  AllForOneStrategy,
  RestForOneStrategy,
  ExponentialBackoffStrategy,
  tradingErrorDecider,
} from "./strategies";

export interface SupervisorState {
  children: Map<ActorAddress, ChildInfo>;
  strategy: SupervisionStrategy;
  backoffStrategy: ExponentialBackoffStrategy;
  stopped: boolean;
}

export interface ChildInfo {
  address: ActorAddress;
  definition: ActorDefinition<unknown, unknown>;
  restartCount: number;
  lastRestartTime?: number;
  createdAt: number;
  name?: string;
}

export type SupervisionStrategy =
  | OneForOneStrategy
  | AllForOneStrategy
  | RestForOneStrategy;

export type SupervisorMessage =
  | { type: "supervise"; child: ActorAddress; error: Error; message?: unknown }
  | { type: "childTerminated"; child: ActorAddress; reason?: string }
  | { type: "createChild"; definition: ActorDefinition<unknown, unknown>; name?: string }
  | { type: "stopChild"; child: ActorAddress }
  | { type: "stopAllChildren" }
  | { type: "getChildren" }
  | { type: "getChildStats"; child: ActorAddress };

/**
 * Comportement du superviseur
 */
export const supervisorBehavior: ActorBehavior<SupervisorState, SupervisorMessage> = async (
  state,
  message,
  context,
) => {
  switch (message.payload.type) {
    case "supervise":
      return handleSupervision(state, message.payload, context);

    case "childTerminated":
      return handleChildTerminated(state, message.payload, context);

    case "createChild":
      return handleCreateChild(state, message.payload, context);

    case "stopChild":
      return handleStopChild(state, message.payload, context);

    case "stopAllChildren":
      return handleStopAllChildren(state, context);

    case "getChildren":
      return handleGetChildren(state, message.sender, context);

    case "getChildStats":
      return handleGetChildStats(state, message.payload, message.sender, context);

    default:
      return { state };
  }
};

/**
 * Gère la supervision d'un enfant en erreur
 */
async function handleSupervision(
  state: SupervisorState,
  payload: { child: ActorAddress; error: Error; message?: unknown },
  context: ActorContext<SupervisorState>,
): Promise<{ state: SupervisorState }> {
  const childInfo = state.children.get(payload.child);
  if (!childInfo) {
    return { state };
  }

  const supervisionContext: SupervisionContext = {
    child: payload.child,
    error: payload.error,
    message: payload.message,
    restartCount: childInfo.restartCount,
    lastRestartTime: childInfo.lastRestartTime,
  };

  const decision = state.strategy.decide(supervisionContext);

  switch (decision.action) {
    case "resume":
      // Ne rien faire, l'enfant continue
      break;

    case "restart":
      await restartChild(state, childInfo, context, decision.delay);
      break;

    case "stop":
      context.stop();
      state.children.delete(payload.child);
      break;

    case "escalate":
      // Escalader au parent du superviseur
      const parent = context.parent();
      if (parent) {
        context.send(parent, {
          type: "supervise",
          child: context.self,
          error: payload.error,
        });
      }
      break;
  }

  // Gérer les stratégies All-For-One et Rest-For-One
  if (decision.action === "restart") {
    if (state.strategy instanceof AllForOneStrategy) {
      await restartAllChildren(state, context);
    } else if (state.strategy instanceof RestForOneStrategy) {
      await restartRestChildren(state, childInfo, context);
    }
  }

  return { state };
}

/**
 * Gère la terminaison d'un enfant
 */
function handleChildTerminated(
  state: SupervisorState,
  payload: { child: ActorAddress; reason?: string },
  context: ActorContext<SupervisorState>,
): { state: SupervisorState } {
  state.children.delete(payload.child);
  context.unwatch(payload.child);
  return { state };
}

/**
 * Crée un nouvel enfant
 */
function handleCreateChild(
  state: SupervisorState,
  payload: { definition: ActorDefinition<unknown, unknown>; name?: string },
  context: ActorContext<SupervisorState>,
): { state: SupervisorState } {
  const childAddress = context.createActor(payload.definition, payload.name);
  context.watch(childAddress);

  const childInfo: ChildInfo = {
    address: childAddress,
    definition: payload.definition,
    restartCount: 0,
    createdAt: Date.now(),
    name: payload.name,
  };

  state.children.set(childAddress, childInfo);
  return { state };
}

/**
 * Arrête un enfant spécifique
 */
function handleStopChild(
  state: SupervisorState,
  payload: { child: ActorAddress },
  context: ActorContext<SupervisorState>,
): { state: SupervisorState } {
  if (state.children.has(payload.child)) {
    context.send(payload.child, { type: "stop" });
    state.children.delete(payload.child);
    context.unwatch(payload.child);
  }
  return { state };
}

/**
 * Arrête tous les enfants
 */
function handleStopAllChildren(
  state: SupervisorState,
  context: ActorContext<SupervisorState>,
): { state: SupervisorState } {
  state.children.forEach((childInfo) => {
    context.send(childInfo.address, { type: "stop" });
    context.unwatch(childInfo.address);
  });
  state.children.clear();
  return { state };
}

/**
 * Renvoie la liste des enfants
 */
function handleGetChildren(
  state: SupervisorState,
  sender: ActorAddress,
  context: ActorContext<SupervisorState>,
): { state: SupervisorState } {
  const children = Array.from(state.children.values()).map((info) => ({
    address: info.address,
    name: info.name,
    restartCount: info.restartCount,
    createdAt: info.createdAt,
  }));
  context.send(sender, { type: "childrenList", children });
  return { state };
}

/**
 * Renvoie les statistiques d'un enfant
 */
function handleGetChildStats(
  state: SupervisorState,
  payload: { child: ActorAddress },
  sender: ActorAddress,
  context: ActorContext<SupervisorState>,
): { state: SupervisorState } {
  const childInfo = state.children.get(payload.child);
  if (childInfo) {
    context.send(sender, {
      type: "childStats",
      stats: {
        address: childInfo.address,
        name: childInfo.name,
        restartCount: childInfo.restartCount,
        lastRestartTime: childInfo.lastRestartTime,
        createdAt: childInfo.createdAt,
      },
    });
  }
  return { state };
}

/**
 * Redémarre un enfant avec backoff exponentiel
 */
async function restartChild(
  state: SupervisorState,
  childInfo: ChildInfo,
  context: ActorContext<SupervisorState>,
  delay?: number,
): Promise<void> {
  const restartDelay = delay || state.backoffStrategy.calculateDelay(childInfo.restartCount);

  // Arrêter l'ancien acteur
  context.send(childInfo.address, { type: "stop" });
  context.unwatch(childInfo.address);

  // Attendre le délai de backoff
  await new Promise((resolve) => setTimeout(resolve, restartDelay));

  // Créer un nouvel acteur
  const newAddress = context.createActor(childInfo.definition, childInfo.name);
  context.watch(newAddress);

  // Mettre à jour les informations
  childInfo.address = newAddress;
  childInfo.restartCount++;
  childInfo.lastRestartTime = Date.now();
  state.children.set(newAddress, childInfo);
}

/**
 * Redémarre tous les enfants (All-For-One)
 */
async function restartAllChildren(
  state: SupervisorState,
  context: ActorContext<SupervisorState>,
): Promise<void> {
  const children = Array.from(state.children.values());
  for (const childInfo of children) {
    await restartChild(state, childInfo, context);
  }
}

/**
 * Redémarre les enfants créés après l'enfant en erreur (Rest-For-One)
 */
async function restartRestChildren(
  state: SupervisorState,
  failedChild: ChildInfo,
  context: ActorContext<SupervisorState>,
): Promise<void> {
  const children = Array.from(state.children.values())
    .filter((child) => child.createdAt >= failedChild.createdAt)
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const childInfo of children) {
    await restartChild(state, childInfo, context);
  }
}

/**
 * Crée une définition de superviseur
 */
export function createSupervisor(
  strategy: SupervisionStrategy = new OneForOneStrategy(),
  backoffStrategy: ExponentialBackoffStrategy = new ExponentialBackoffStrategy(),
): ActorDefinition<SupervisorState, SupervisorMessage> {
  return {
    behavior: supervisorBehavior,
    initialState: {
      children: new Map(),
      strategy,
      backoffStrategy,
      stopped: false,
    },
    supervisorStrategy: { type: "escalate" },
    preStart: async (context) => {
      console.log(`Supervisor ${context.self} started`);
    },
    postStop: async (context) => {
      console.log(`Supervisor ${context.self} stopped`);
    },
  };
}

/**
 * Crée un superviseur de trading spécialisé
 */
export function createTradingSupervisor(): ActorDefinition<SupervisorState, SupervisorMessage> {
  const strategy = new OneForOneStrategy(5, 300000, tradingErrorDecider);
  const backoffStrategy = new ExponentialBackoffStrategy(1000, 60000, 1.5);
  return createSupervisor(strategy, backoffStrategy);
}
