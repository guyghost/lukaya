import type {
  ActorAddress,
  ActorBehavior,
  ActorContext,
  ActorDefinition,
  ActorMessage,
  ActorSystem,
} from "./models/actor.model";

const createActorSystem = (): ActorSystem => {
  const actors = new Map<
    ActorAddress,
    {
      parent: ActorAddress | null;
      mailbox: ActorMessage<unknown>[];
      behavior: ActorBehavior<unknown, unknown>;
      state: unknown;
      children: ActorAddress[];
      processing: boolean;
      definition: ActorDefinition<unknown, unknown>;
    }
  >();

  const findParent = (address: ActorAddress): ActorAddress | null => {
    return actors.get(address)?.parent ?? null;
  };

  const generateAddress = (): ActorAddress =>
    crypto.randomUUID() as ActorAddress;

  const processMailbox = async (address: ActorAddress) => {
    const actor = actors.get(address);
    if (!actor || actor.processing || actor.mailbox.length === 0) return;

    actor.processing = true;
    const message = actor.mailbox.shift()!;

    try {
      const context: ActorContext<unknown> = {
        self: address,
        state: () => actor.state,
        children: () => [...actor.children],
        createActor: <TChildState, TChildMessage>(
          definition: ActorDefinition<TChildState, TChildMessage>,
        ) => {
          const childAddress = system.createActor(definition, address);
          actor.children.push(childAddress);
          return childAddress;
        },
        send: (recipient, message) => system.send(recipient, message, address),
        stop: () => system.stop(address),
      };

      const result = await actor.behavior(actor.state, message, context);

      actor.state = result.state;

      if (result.spawn) {
        result.spawn.forEach((childDef) => {
          const childAddress = system.createActor(childDef, address);
          actor.children.push(childAddress);
        });
      }
    } catch (error) {
      const actor = actors.get(address)!;
      const parent = findParent(address);

      switch (actor.definition.supervisorStrategy?.type) {
        case "resume":
          break;
        case "restart":
          actor.state = actor.definition.initialState;
          break;
        case "stop":
          system.stop(address);
          break;
        case "escalate":
          parent && system.send(parent, { type: "error", error });
          break;
        default:
          system.stop(address);
      }
    } finally {
      actor.processing = false;
      processMailbox(address);
    }
  };

  const system: ActorSystem = {
    createActor: <TState, TMessage>(
      definition: ActorDefinition<TState, TMessage>,
      parent?: ActorAddress,
    ) => {
      const address = generateAddress();

      actors.set(address, {
        parent: parent ?? null,
        mailbox: [],
        behavior: definition.behavior as ActorBehavior<unknown, unknown>,
        state: definition.initialState,
        children: [],
        processing: false,
        definition: definition as ActorDefinition<unknown, unknown>,
      });

      return address;
    },

    send: <T>(recipient: ActorAddress, message: T, sender?: ActorAddress) => {
      const actor = actors.get(recipient);
      if (!actor) return;

      const fullMessage: ActorMessage<T> = {
        sender: sender ?? ("" as ActorAddress),
        payload: message,
      };

      actor.mailbox.push(fullMessage);
      processMailbox(recipient);
    },

    stop: (address) => {
      const actor = actors.get(address);
      if (!actor) return;

      actor.children.forEach((child) => system.stop(child));
      actors.delete(address);
    },
  };

  return system;
};

export { createActorSystem };
