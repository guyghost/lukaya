# Supervisor Pattern pour le Système d'Acteurs

Le supervisor pattern est un mécanisme de gestion des erreurs et de tolérance aux pannes dans le système d'acteurs. Il permet de superviser et de gérer automatiquement les acteurs enfants en cas d'erreur.

## Vue d'ensemble

Le supervisor pattern implémente une hiérarchie d'acteurs où les acteurs parents (superviseurs) sont responsables de la gestion des erreurs de leurs enfants. Lorsqu'un acteur enfant rencontre une erreur, le superviseur décide de l'action à prendre selon une stratégie prédéfinie.

## Stratégies de Supervision

### 1. One-For-One Strategy

Supervise chaque acteur enfant individuellement. Seul l'acteur qui a échoué est affecté par la décision de supervision.

```typescript
import { OneForOneStrategy } from "../supervisor/strategies";

const strategy = new OneForOneStrategy(
  3,     // maxRetries: nombre maximum de redémarrages
  60000, // withinTimeMs: fenêtre de temps en millisecondes
  customDecider // optionnel: fonction de décision personnalisée
);
```

### 2. All-For-One Strategy

Redémarre tous les acteurs enfants si l'un d'eux échoue. Utile lorsque les acteurs enfants sont fortement couplés.

```typescript
import { AllForOneStrategy } from "../supervisor/strategies";

const strategy = new AllForOneStrategy(3, 60000);
```

### 3. Rest-For-One Strategy

Redémarre l'acteur qui a échoué et tous ses frères créés après lui. Utile pour les acteurs qui dépendent d'un ordre de création.

```typescript
import { RestForOneStrategy } from "../supervisor/strategies";

const strategy = new RestForOneStrategy(3, 60000);
```

## Actions de Supervision

Le superviseur peut prendre les actions suivantes en cas d'erreur :

- **Resume** : Continue l'exécution sans redémarrer l'acteur
- **Restart** : Redémarre l'acteur avec son état initial
- **Stop** : Arrête définitivement l'acteur
- **Escalate** : Transmet l'erreur au superviseur parent

## Utilisation

### Créer un Superviseur Simple

```typescript
import { createActorSystem } from "../system";
import { createSupervisor, OneForOneStrategy } from "../supervisor";

// Créer le système d'acteurs
const system = createActorSystem();

// Créer un superviseur avec stratégie One-For-One
const supervisor = system.createActor(
  createSupervisor(new OneForOneStrategy(3, 60000))
);

// Créer un acteur enfant via le superviseur
system.send(supervisor, {
  type: "createChild",
  definition: {
    behavior: async (state, message, context) => {
      // Logique de l'acteur
      return { state };
    },
    initialState: { count: 0 },
    supervisorStrategy: { type: "escalate" }
  },
  name: "my-child-actor"
});
```

### Superviseur de Trading Spécialisé

```typescript
import { createTradingSupervisor } from "../supervisor";

// Créer un superviseur pré-configuré pour le trading
const tradingSupervisor = system.createActor(createTradingSupervisor());

// Le superviseur de trading utilise :
// - Une stratégie One-For-One avec 5 redémarrages max en 5 minutes
// - Un décideur spécialisé pour les erreurs de trading
// - Un backoff exponentiel entre les redémarrages
```

### Décideur Personnalisé

```typescript
import { SupervisionDecider } from "../models/actor.model";

const customDecider: SupervisionDecider = (context) => {
  const error = context.error;

  // Erreurs de réseau - reprendre avec délai
  if (error.message.includes("network")) {
    return { action: "resume", delay: 5000 };
  }

  // Erreurs de données - redémarrer
  if (error.message.includes("invalid data")) {
    return { action: "restart" };
  }

  // Erreurs critiques - arrêter
  if (error.message.includes("fatal")) {
    return { action: "stop" };
  }

  // Par défaut - escalader au parent
  return { action: "escalate" };
};
```

## Gestion du Cycle de Vie

Les acteurs supervisés peuvent implémenter des hooks de cycle de vie :

```typescript
const actorDefinition = {
  behavior: myBehavior,
  initialState: myInitialState,

  // Appelé au démarrage de l'acteur
  preStart: async (context) => {
    console.log("Actor starting...");
  },

  // Appelé avant le redémarrage
  preRestart: async (context, error) => {
    console.log("Actor restarting due to:", error);
  },

  // Appelé après le redémarrage
  postRestart: async (context, error) => {
    console.log("Actor restarted successfully");
  },

  // Appelé à l'arrêt de l'acteur
  postStop: async (context) => {
    console.log("Actor stopped");
  }
};
```

## Backoff Exponentiel

Pour éviter les redémarrages en boucle, utilisez une stratégie de backoff :

```typescript
import { ExponentialBackoffStrategy } from "../supervisor/strategies";

const backoff = new ExponentialBackoffStrategy(
  100,   // baseDelayMs: délai initial
  30000, // maxDelayMs: délai maximum
  2      // factor: facteur multiplicateur
);

// Utiliser avec un superviseur
const supervisor = createSupervisor(strategy, backoff);
```

## Monitoring et Observabilité

### Surveiller les Acteurs

```typescript
// Un acteur peut surveiller un autre acteur
context.watch(childAddress);

// Sera notifié lorsque l'acteur surveillé s'arrête
// via un message { type: "childTerminated", child: address }
```

### Obtenir les Statistiques

```typescript
// Obtenir la liste des enfants
system.send(supervisor, { type: "getChildren" });

// Obtenir les statistiques d'un enfant
system.send(supervisor, {
  type: "getChildStats",
  child: childAddress
});
```

## Stratégies Prédéfinies

```typescript
import { SupervisorStrategies } from "../supervisor/strategies";

// Toujours reprendre sans redémarrer
const resumeStrategy = SupervisorStrategies.resume();

// Toujours arrêter l'acteur
const stopStrategy = SupervisorStrategies.stop();

// Toujours escalader au parent
const escalateStrategy = SupervisorStrategies.escalate();

// Redémarrer avec limites
const restartStrategy = SupervisorStrategies.restart(3, 60000);

// Stratégie par défaut recommandée
const defaultStrategy = SupervisorStrategies.default();
```

## Exemple Complet

```typescript
import { createActorSystem } from "../system";
import { createSupervisor, OneForOneStrategy, tradingErrorDecider } from "../supervisor";

async function setupTradingSystem() {
  const system = createActorSystem();

  // Créer le superviseur principal
  const mainSupervisor = system.createRootSupervisor(
    createSupervisor(
      new OneForOneStrategy(5, 300000, tradingErrorDecider)
    )
  );

  // Définir les acteurs de trading
  const priceMonitorDef = {
    behavior: async (state, message, context) => {
      // Logique de surveillance des prix
      if (message.payload.type === "checkPrice") {
        // Peut lancer une erreur API
        const price = await fetchPrice();
        return { state: { ...state, lastPrice: price } };
      }
      return { state };
    },
    initialState: { lastPrice: 0 },
    supervisorStrategy: { type: "escalate" as const }
  };

  // Créer l'acteur via le superviseur
  system.send(mainSupervisor, {
    type: "createChild",
    definition: priceMonitorDef,
    name: "price-monitor"
  });

  // L'acteur sera automatiquement supervisé
  // En cas d'erreur API, il sera redémarré selon la stratégie
}
```

## Bonnes Pratiques

1. **Hiérarchie de Supervision** : Organisez vos acteurs en arbre de supervision logique
2. **Isolation des Erreurs** : Utilisez One-For-One sauf si les acteurs sont fortement couplés
3. **Limites de Redémarrage** : Définissez toujours des limites pour éviter les boucles infinies
4. **Décideurs Spécialisés** : Créez des décideurs adaptés à votre domaine métier
5. **Logging** : Utilisez les hooks de cycle de vie pour tracer les redémarrages
6. **Backoff** : Implémentez un délai croissant entre les redémarrages
7. **Tests** : Testez vos stratégies de supervision avec des erreurs simulées

## Dépannage

### L'acteur ne redémarre pas

- Vérifiez que la stratégie de supervision est bien définie
- Vérifiez que le nombre maximum de redémarrages n'est pas atteint
- Assurez-vous que l'erreur est bien escaladée au superviseur

### Redémarrages en boucle

- Implémentez un backoff exponentiel
- Réduisez le nombre maximum de redémarrages
- Utilisez un décideur pour arrêter l'acteur en cas d'erreur persistante

### Performance

- Évitez de créer trop d'acteurs enfants sous un seul superviseur
- Utilisez des superviseurs intermédiaires pour créer une hiérarchie
- Limitez la taille des mailboxes avec des stratégies de back-pressure
