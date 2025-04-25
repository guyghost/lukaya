export type ActorAddress = string & { readonly __brand: unique symbol };

export interface ActorMessage<T> {
  sender: ActorAddress;
  payload: T;
}

export interface ActorContext<TState> {
  self: ActorAddress;
  state: () => TState;
  children: () => ActorAddress[];
  createActor: <TChildState, TChildMessage>(
    definition: ActorDefinition<TChildState, TChildMessage>
  ) => ActorAddress;
  send: <T>(recipient: ActorAddress, message: T) => void;
  stop: () => void;
}

export interface ActorBehaviorResult<TState> {
  state: TState;
  spawn?: ActorDefinition<unknown, unknown>[];
}

export type ActorBehavior<TState, TMessage> = (
  state: TState,
  message: ActorMessage<TMessage>,
  context: ActorContext<TState>
) => Promise<ActorBehaviorResult<TState>> | ActorBehaviorResult<TState>;

export type SupervisorStrategy =
  | { type: "resume" }
  | { type: "restart" }
  | { type: "stop" }
  | { type: "escalate" };

export interface ActorDefinition<TState, TMessage> {
  behavior: ActorBehavior<TState, TMessage>;
  initialState: TState;
  supervisorStrategy?: SupervisorStrategy;
}

export interface ActorSystem {
  createActor: <TState, TMessage>(
    definition: ActorDefinition<TState, TMessage>,
    parent?: ActorAddress
  ) => ActorAddress;
  
  send: <T>(
    recipient: ActorAddress,
    message: T,
    sender?: ActorAddress
  ) => void;
  
  stop: (address: ActorAddress) => void;
}
