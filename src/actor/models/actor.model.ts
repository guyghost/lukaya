export type ActorAddress = string & { readonly __brand: unique symbol };

export interface ActorMessage<T> {
  sender: ActorAddress;
  payload: T;
}

export interface SystemMessage {
  type: "childTerminated" | "supervise" | "restart" | "stop";
  child?: ActorAddress;
  error?: Error;
  reason?: string;
}

export interface SupervisionDecision {
  action: "resume" | "restart" | "stop" | "escalate";
  delay?: number;
}

export interface ActorContext<TState> {
  self: ActorAddress;
  state: () => TState;
  children: () => ActorAddress[];
  parent: () => ActorAddress | null;
  createActor: <TChildState, TChildMessage>(
    definition: ActorDefinition<TChildState, TChildMessage>,
    name?: string,
  ) => ActorAddress;
  send: <T>(recipient: ActorAddress, message: T) => void;
  stop: () => void;
  watch: (actor: ActorAddress) => void;
  unwatch: (actor: ActorAddress) => void;
  schedule: <T>(
    delay: number,
    recipient: ActorAddress,
    message: T,
  ) => NodeJS.Timeout;
  cancelSchedule: (timeoutId: NodeJS.Timeout) => void;
}

export interface ActorBehaviorResult<TState> {
  state: TState;
  spawn?: ActorDefinition<unknown, unknown>[];
}

export type ActorBehavior<TState, TMessage> = (
  state: TState,
  message: ActorMessage<TMessage>,
  context: ActorContext<TState>,
) => Promise<ActorBehaviorResult<TState>> | ActorBehaviorResult<TState>;

export type SupervisorStrategy =
  | { type: "resume" }
  | { type: "restart"; maxRetries?: number; withinTimeMs?: number }
  | { type: "stop" }
  | { type: "escalate" };

export interface SupervisionContext {
  child: ActorAddress;
  error: Error;
  message?: unknown;
  restartCount: number;
  lastRestartTime?: number;
}

export type SupervisionDecider = (
  context: SupervisionContext,
) => SupervisionDecision;

export interface ActorDefinition<TState, TMessage> {
  behavior: ActorBehavior<TState, TMessage>;
  initialState: TState;
  supervisorStrategy?: SupervisorStrategy;
  supervisionDecider?: SupervisionDecider;
  preStart?: (context: ActorContext<TState>) => Promise<void> | void;
  postStop?: (context: ActorContext<TState>) => Promise<void> | void;
  preRestart?: (
    context: ActorContext<TState>,
    error: Error,
  ) => Promise<void> | void;
  postRestart?: (
    context: ActorContext<TState>,
    error: Error,
  ) => Promise<void> | void;
}

export interface ActorSystem {
  createActor: <TState, TMessage>(
    definition: ActorDefinition<TState, TMessage>,
    parent?: ActorAddress,
    name?: string,
  ) => ActorAddress;

  send: <T>(recipient: ActorAddress, message: T, sender?: ActorAddress) => void;

  stop: (address: ActorAddress) => void;

  getActor: (address: ActorAddress) => ActorContext<unknown> | undefined;

  createRootSupervisor: <TState, TMessage>(
    definition: ActorDefinition<TState, TMessage>,
  ) => ActorAddress;
}

export interface ActorStats {
  address: ActorAddress;
  mailboxSize: number;
  childrenCount: number;
  restartCount: number;
  lastRestartTime?: number;
  state: "idle" | "processing" | "stopped";
}
