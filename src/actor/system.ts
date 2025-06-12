import type {
  ActorAddress,
  ActorBehavior,
  ActorContext,
  ActorDefinition,
  ActorMessage,
  ActorSystem,
  SupervisorStrategy,
  SupervisionContext,
  SystemMessage,
  ActorStats,
} from "./models/actor.model";

interface ActorInstance {
  address: ActorAddress;
  name?: string;
  parent: ActorAddress | null;
  mailbox: ActorMessage<unknown>[];
  behavior: ActorBehavior<unknown, unknown>;
  state: unknown;
  children: Set<ActorAddress>;
  watchers: Set<ActorAddress>;
  definition: ActorDefinition<unknown, unknown>;
  processing: boolean;
  stopped: boolean;
  restartCount: number;
  lastRestartTime?: number;
  createdAt: number;
  scheduledTasks: Set<NodeJS.Timeout>;
}

const createActorSystem = (): ActorSystem => {
  const actors = new Map<ActorAddress, ActorInstance>();
  const nameToAddress = new Map<string, ActorAddress>();
  let rootSupervisor: ActorAddress | null = null;

  const generateAddress = (): ActorAddress =>
    crypto.randomUUID() as ActorAddress;

  const getActorInstance = (address: ActorAddress): ActorInstance | undefined =>
    actors.get(address);

  const processMailbox = async (address: ActorAddress) => {
    const actor = actors.get(address);
    if (
      !actor ||
      actor.processing ||
      actor.stopped ||
      actor.mailbox.length === 0
    ) {
      return;
    }

    actor.processing = true;
    const message = actor.mailbox.shift()!;

    try {
      const context = createActorContext(address);

      // Appeler preStart lors de la première exécution
      if (
        actor.restartCount === 0 &&
        actor.mailbox.length === 0 &&
        actor.definition.preStart
      ) {
        await actor.definition.preStart(context);
      }

      const result = await actor.behavior(actor.state, message, context);
      actor.state = result.state;

      if (result.spawn) {
        for (const childDef of result.spawn) {
          const childAddress = system.createActor(childDef, address);
          actor.children.add(childAddress);
        }
      }
    } catch (error) {
      await handleActorError(address, error as Error, message);
    } finally {
      actor.processing = false;
      // Continuer à traiter les messages
      setImmediate(() => processMailbox(address));
    }
  };

  const createActorContext = (address: ActorAddress): ActorContext<unknown> => {
    const actor = actors.get(address)!;

    return {
      self: address,
      state: () => actor.state,
      children: () => Array.from(actor.children),
      parent: () => actor.parent,

      createActor: <TChildState, TChildMessage>(
        definition: ActorDefinition<TChildState, TChildMessage>,
        name?: string,
      ) => {
        const childAddress = system.createActor(definition, address, name);
        actor.children.add(childAddress);
        return childAddress;
      },

      send: (recipient, message) => system.send(recipient, message, address),

      stop: () => system.stop(address),

      watch: (watchedActor) => {
        const watched = actors.get(watchedActor);
        if (watched) {
          watched.watchers.add(address);
        }
      },

      unwatch: (watchedActor) => {
        const watched = actors.get(watchedActor);
        if (watched) {
          watched.watchers.delete(address);
        }
      },

      schedule: <T>(delay: number, recipient: ActorAddress, message: T) => {
        const timeoutId = setTimeout(() => {
          system.send(recipient, message, address);
          actor.scheduledTasks.delete(timeoutId);
        }, delay);
        actor.scheduledTasks.add(timeoutId);
        return timeoutId;
      },

      cancelSchedule: (timeoutId: NodeJS.Timeout) => {
        clearTimeout(timeoutId);
        actor.scheduledTasks.delete(timeoutId);
      },
    };
  };

  const handleActorError = async (
    address: ActorAddress,
    error: Error,
    message: ActorMessage<unknown>,
  ) => {
    const actor = actors.get(address);
    if (!actor) return;

    const parent = actor.parent ? actors.get(actor.parent) : null;
    const strategy = actor.definition.supervisorStrategy || { type: "stop" };

    // Si pas de parent, l'acteur doit s'arrêter
    if (!parent) {
      console.error(`Unhandled error in root actor ${address}:`, error);
      system.stop(address);
      return;
    }

    // Créer le contexte de supervision
    const supervisionContext: SupervisionContext = {
      child: address,
      error,
      message: message.payload,
      restartCount: actor.restartCount,
      lastRestartTime: actor.lastRestartTime,
    };

    // Appliquer la stratégie de supervision
    switch (strategy.type) {
      case "resume":
        // Ne rien faire, continuer le traitement
        break;

      case "restart":
        await restartActor(address, error);
        break;

      case "stop":
        system.stop(address);
        break;

      case "escalate":
        // Envoyer l'erreur au parent pour supervision
        system.send(
          actor.parent,
          {
            type: "supervise",
            child: address,
            error,
            message: message.payload,
          } as SystemMessage,
          address,
        );
        break;
    }
  };

  const restartActor = async (address: ActorAddress, error: Error) => {
    const actor = actors.get(address);
    if (!actor) return;

    // Appeler preRestart si défini
    if (actor.definition.preRestart) {
      const context = createActorContext(address);
      await actor.definition.preRestart(context, error);
    }

    // Arrêter tous les enfants
    for (const child of actor.children) {
      system.stop(child);
    }
    actor.children.clear();

    // Réinitialiser l'état
    actor.state = actor.definition.initialState;
    actor.restartCount++;
    actor.lastRestartTime = Date.now();

    // Appeler postRestart si défini
    if (actor.definition.postRestart) {
      const context = createActorContext(address);
      await actor.definition.postRestart(context, error);
    }

    // Vider la mailbox et continuer
    actor.mailbox = [];
    actor.processing = false;
  };

  const notifyWatchers = (address: ActorAddress, reason?: string) => {
    const actor = actors.get(address);
    if (!actor) return;

    for (const watcher of actor.watchers) {
      system.send(watcher, {
        type: "childTerminated",
        child: address,
        reason,
      } as SystemMessage);
    }
  };

  const system: ActorSystem = {
    createActor: <TState, TMessage>(
      definition: ActorDefinition<TState, TMessage>,
      parent?: ActorAddress,
      name?: string,
    ) => {
      const address = generateAddress();

      // Vérifier l'unicité du nom
      if (name) {
        if (nameToAddress.has(name)) {
          throw new Error(`Actor with name '${name}' already exists`);
        }
        nameToAddress.set(name, address);
      }

      const actor: ActorInstance = {
        address,
        name,
        parent: parent ?? null,
        mailbox: [],
        behavior: definition.behavior as ActorBehavior<unknown, unknown>,
        state: definition.initialState,
        children: new Set(),
        watchers: new Set(),
        definition: definition as ActorDefinition<unknown, unknown>,
        processing: false,
        stopped: false,
        restartCount: 0,
        createdAt: Date.now(),
        scheduledTasks: new Set(),
      };

      actors.set(address, actor);

      // Démarrer le traitement des messages
      setImmediate(() => processMailbox(address));

      return address;
    },

    send: <T>(recipient: ActorAddress, message: T, sender?: ActorAddress) => {
      const actor = actors.get(recipient);
      if (!actor || actor.stopped) return;

      const fullMessage: ActorMessage<T> = {
        sender: sender ?? ("system" as ActorAddress),
        payload: message,
      };

      actor.mailbox.push(fullMessage);
      setImmediate(() => processMailbox(recipient));
    },

    stop: async (address: ActorAddress) => {
      const actor = actors.get(address);
      if (!actor || actor.stopped) return;

      actor.stopped = true;

      // Annuler toutes les tâches planifiées
      for (const timeoutId of actor.scheduledTasks) {
        clearTimeout(timeoutId);
      }
      actor.scheduledTasks.clear();

      // Appeler postStop si défini
      if (actor.definition.postStop) {
        const context = createActorContext(address);
        await actor.definition.postStop(context);
      }

      // Arrêter tous les enfants
      for (const child of actor.children) {
        system.stop(child);
      }

      // Notifier les watchers
      notifyWatchers(address, "stopped");

      // Retirer des watchers des autres acteurs
      for (const [_, otherActor] of actors) {
        otherActor.watchers.delete(address);
      }

      // Supprimer l'acteur
      actors.delete(address);
      if (actor.name) {
        nameToAddress.delete(actor.name);
      }
    },

    getActor: (address: ActorAddress) => {
      const actor = actors.get(address);
      if (!actor) return undefined;
      return createActorContext(address);
    },

    createRootSupervisor: <TState, TMessage>(
      definition: ActorDefinition<TState, TMessage>,
    ) => {
      if (rootSupervisor) {
        throw new Error("Root supervisor already exists");
      }
      rootSupervisor = system.createActor(
        definition,
        undefined,
        "root-supervisor",
      );
      return rootSupervisor;
    },
  };

  return system;
};

/**
 * Fonction helper pour obtenir les statistiques d'un acteur
 */
export const getActorStats = (
  system: ActorSystem,
  address: ActorAddress,
): ActorStats | undefined => {
  const context = system.getActor(address);
  if (!context) return undefined;

  // Note: Cette implémentation nécessiterait un accès direct aux données internes
  // Dans une vraie implémentation, on pourrait exposer ces infos via le contexte
  return {
    address,
    mailboxSize: 0, // À implémenter
    childrenCount: context.children().length,
    restartCount: 0, // À implémenter
    lastRestartTime: undefined, // À implémenter
    state: "idle", // À implémenter
  };
};

export { createActorSystem };
