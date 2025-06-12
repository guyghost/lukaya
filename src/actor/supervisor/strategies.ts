import type {
  SupervisionContext,
  SupervisionDecision,
  SupervisionDecider,
  SupervisorStrategy,
} from "../models/actor.model";

/**
 * Stratégie de supervision One-For-One
 * Supervise chaque acteur enfant individuellement
 */
export class OneForOneStrategy {
  constructor(
    private maxRetries: number = 3,
    private withinTimeMs: number = 60000,
    private decider: SupervisionDecider = defaultDecider,
  ) {}

  decide(context: SupervisionContext): SupervisionDecision {
    // Vérifier si on a dépassé le nombre de redémarrages autorisés
    if (this.maxRetries > 0 && context.restartCount >= this.maxRetries) {
      const timeSinceLastRestart = context.lastRestartTime
        ? Date.now() - context.lastRestartTime
        : Infinity;

      if (timeSinceLastRestart < this.withinTimeMs) {
        return { action: "stop" };
      }
    }

    return this.decider(context);
  }
}

/**
 * Stratégie de supervision All-For-One
 * Redémarre tous les acteurs enfants si l'un d'eux échoue
 */
export class AllForOneStrategy extends OneForOneStrategy {
  constructor(
    maxRetries: number = 3,
    withinTimeMs: number = 60000,
    decider: SupervisionDecider = defaultDecider,
  ) {
    super(maxRetries, withinTimeMs, decider);
  }

  // La logique spécifique à All-For-One sera implémentée dans le système d'acteurs
  isAllForOne(): boolean {
    return true;
  }
}

/**
 * Stratégie de supervision Rest-For-One
 * Redémarre l'acteur qui a échoué et tous ses frères créés après lui
 */
export class RestForOneStrategy extends OneForOneStrategy {
  constructor(
    maxRetries: number = 3,
    withinTimeMs: number = 60000,
    decider: SupervisionDecider = defaultDecider,
  ) {
    super(maxRetries, withinTimeMs, decider);
  }

  // La logique spécifique à Rest-For-One sera implémentée dans le système d'acteurs
  isRestForOne(): boolean {
    return true;
  }
}

/**
 * Décideur par défaut basé sur le type d'erreur
 */
export const defaultDecider: SupervisionDecider = (context) => {
  const error = context.error;

  // Erreurs critiques - arrêter l'acteur
  if (
    error instanceof TypeError ||
    error instanceof ReferenceError ||
    error.message.includes("out of memory")
  ) {
    return { action: "stop" };
  }

  // Erreurs temporaires - reprendre l'exécution
  if (
    error.message.includes("network") ||
    error.message.includes("timeout") ||
    error.message.includes("ECONNREFUSED")
  ) {
    return { action: "resume" };
  }

  // Erreurs de logique métier - redémarrer
  if (
    error.message.includes("invalid state") ||
    error.message.includes("assertion failed")
  ) {
    return { action: "restart" };
  }

  // Par défaut, redémarrer
  return { action: "restart" };
};

/**
 * Décideur personnalisé pour les erreurs de trading
 */
export const tradingErrorDecider: SupervisionDecider = (context) => {
  const error = context.error;

  // Erreurs de connexion API - reprendre avec délai
  if (
    error.message.includes("API") ||
    error.message.includes("rate limit") ||
    error.message.includes("429")
  ) {
    return { action: "resume", delay: 5000 };
  }

  // Erreurs de données invalides - redémarrer
  if (
    error.message.includes("invalid price") ||
    error.message.includes("malformed data")
  ) {
    return { action: "restart" };
  }

  // Erreurs critiques de trading - escalader
  if (
    error.message.includes("insufficient funds") ||
    error.message.includes("position limit exceeded")
  ) {
    return { action: "escalate" };
  }

  // Utiliser le décideur par défaut pour les autres cas
  return defaultDecider(context);
};

/**
 * Stratégie de backoff exponentiel pour les redémarrages
 */
export class ExponentialBackoffStrategy {
  private baseDelayMs: number;
  private maxDelayMs: number;
  private factor: number;

  constructor(
    baseDelayMs: number = 100,
    maxDelayMs: number = 30000,
    factor: number = 2,
  ) {
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.factor = factor;
  }

  calculateDelay(restartCount: number): number {
    const delay = this.baseDelayMs * Math.pow(this.factor, restartCount);
    return Math.min(delay, this.maxDelayMs);
  }
}

/**
 * Helper pour créer des stratégies de supervision personnalisées
 */
export const createSupervisorStrategy = (
  options: {
    maxRetries?: number;
    withinTimeMs?: number;
    decider?: SupervisionDecider;
    type?: "oneForOne" | "allForOne" | "restForOne";
  } = {},
): SupervisorStrategy => {
  const {
    maxRetries = 3,
    withinTimeMs = 60000,
    decider = defaultDecider,
    type = "oneForOne",
  } = options;

  switch (type) {
    case "allForOne":
      return {
        type: "restart",
        maxRetries,
        withinTimeMs,
      };
    case "restForOne":
      return {
        type: "restart",
        maxRetries,
        withinTimeMs,
      };
    default:
      return {
        type: "restart",
        maxRetries,
        withinTimeMs,
      };
  }
};

/**
 * Stratégies de supervision prédéfinies
 */
export const SupervisorStrategies = {
  /**
   * Toujours reprendre l'exécution sans redémarrer
   */
  resume: (): SupervisorStrategy => ({ type: "resume" }),

  /**
   * Toujours arrêter l'acteur en cas d'erreur
   */
  stop: (): SupervisorStrategy => ({ type: "stop" }),

  /**
   * Toujours escalader l'erreur au parent
   */
  escalate: (): SupervisorStrategy => ({ type: "escalate" }),

  /**
   * Redémarrer avec des limites par défaut
   */
  restart: (maxRetries = 3, withinTimeMs = 60000): SupervisorStrategy => ({
    type: "restart",
    maxRetries,
    withinTimeMs,
  }),

  /**
   * Stratégie par défaut recommandée
   */
  default: (): SupervisorStrategy => ({
    type: "restart",
    maxRetries: 3,
    withinTimeMs: 60000,
  }),
};
