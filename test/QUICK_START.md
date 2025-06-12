# Guide de Démarrage Rapide - Tests

Ce guide vous permet de commencer rapidement avec les tests du bot de trading Lukaya.

## 🚀 Démarrage Rapide

### Prérequis
- **Bun** installé (pas besoin de Jest ou autres runners)
- Node.js 18+ recommandé

### Installation
```bash
# Cloner le projet
git clone <repo-url>
cd lukaya

# Installer les dépendances
bun install
```

## 📋 Commandes Essentielles

### Tests de Base
```bash
# Tous les tests
bun run test

# Tests rapides (sans configuration avancée)
bun run test:quick

# Tests avec couverture
bun run test:coverage
```

### Tests par Type
```bash
# Tests unitaires seulement
bun run test:unit

# Tests d'intégration seulement
bun run test:integration

# Tests de fiabilité
bun run test:reliability

# Tests de performance
bun run test:performance
```

### Mode Développement
```bash
# Mode watch (re-exécute les tests automatiquement)
bun run test:watch

# Tests complets pour CI/CD
bun run test:ci
```

## 📁 Structure des Tests

```
test/
├── unit/                    # Tests unitaires rapides
│   ├── domain/             # Tests des modèles du domaine
│   ├── shared/             # Tests des utilitaires partagés
│   └── infrastructure/     # Tests de l'infrastructure
├── integration/            # Tests d'intégration
│   ├── order-orchestration.test.ts
│   └── test-reliability-improvements.test.ts
├── application/            # Tests des acteurs
│   └── actors/
│       └── performance-tracker/
└── test-utils.ts          # Utilitaires pour les tests
```

## ✅ Premier Test

Créer un nouveau test unitaire :

```typescript
// test/unit/my-component.test.ts
import { describe, test, expect } from "bun:test";
import { createTestOrder } from "../test-utils";

describe("My Component", () => {
  test("should work correctly", () => {
    const order = createTestOrder({ symbol: "BTC-USD" });
    expect(order.symbol).toBe("BTC-USD");
  });
});
```

Exécuter votre test :
```bash
bun run test:unit
```

## 🔧 Configuration

### Variables d'Environnement
Les tests utilisent automatiquement :
- `NODE_ENV=test`
- `LOG_LEVEL=error`
- `DISABLE_EXTERNAL_CALLS=true`

### Timeouts
- Tests unitaires : 5 secondes par défaut
- Tests d'intégration : 30 secondes par défaut

## 🛠️ Utilitaires Disponibles

```typescript
import {
  createMockContext,
  createTestOrder,
  expectToBeWithinRange,
  TestTimer,
  TestLogger
} from "./test-utils";

// Context mock pour les acteurs
const context = createMockContext("my-actor");

// Ordre de test
const order = createTestOrder({ symbol: "ETH-USD", size: 0.5 });

// Assertions personnalisées
expectToBeWithinRange(42, 40, 50);

// Timer pour mesurer la performance
const timer = new TestTimer();
timer.start();
// ... code à tester
timer.expectToBeWithin(100, 500); // entre 100ms et 500ms

// Logger pour capturer les logs
const logger = new TestLogger();
logger.info("Test message");
logger.expectLogCount("info", 1);
```

## 📊 Couverture de Code

Générer un rapport de couverture :
```bash
bun run test:coverage
```

Le rapport sera disponible dans :
- Console : résumé textuel
- `coverage/index.html` : rapport HTML détaillé
- `coverage/lcov.info` : format LCOV pour les outils CI/CD

## 🐛 Debugging

### Logs de Debug
```bash
# Activer les logs détaillés
LOG_LEVEL=debug bun run test:unit
```

### Tests Spécifiques
```bash
# Exécuter un seul fichier
bun test test/unit/domain/market.model.test.ts

# Exécuter avec verbose
bun test --verbose test/unit/domain/market.model.test.ts
```

### Mode Watch pour Development
```bash
# Re-exécute automatiquement les tests modifiés
bun run test:watch
```

## 📈 Bonnes Pratiques

### Structure d'un Test
```typescript
describe("Component Name", () => {
  let component: ComponentType;

  beforeEach(() => {
    // Setup avant chaque test
  });

  afterEach(() => {
    // Cleanup après chaque test
  });

  test("should do something when condition", () => {
    // Arrange - Préparer les données
    const input = createTestData();

    // Act - Exécuter l'action
    const result = component.method(input);

    // Assert - Vérifier le résultat
    expect(result).toBe(expected);
  });
});
```

### Nommage
- **Fichiers** : `*.test.ts`
- **Tests** : `should [action] when [condition]`
- **Groupes** : Nom du composant ou de la fonctionnalité

### Assertions
```typescript
// Basiques
expect(value).toBe(expected);
expect(value).toEqual(expectedObject);
expect(array).toHaveLength(3);
expect(object).toHaveProperty("key");

// Personnalisées
expect(number).toBeWithinRange(10, 20);
expectToMatchTimestamp(timestamp);
```

## 🚨 Résolution de Problèmes

### Tests qui ne passent pas
1. Vérifier la structure des imports
2. S'assurer que les mocks sont correctement configurés
3. Vérifier les variables d'environnement

### Performance lente
1. Utiliser `test:unit` pour les tests rapides
2. Éviter les timeouts inutiles
3. Nettoyer les ressources dans `afterEach`

### Erreurs de couverture
1. Vérifier que les fichiers sont dans `src/`
2. Éviter les fichiers exclus (`.d.ts`, etc.)
3. Utiliser `test:coverage` pour voir les détails

## 📚 Ressources

- [Documentation Bun Test](https://bun.sh/docs/cli/test)
- [Guide complet des tests](./README.md)
- [Utilitaires de test](./test-utils.ts)
- [Configuration](../bunfig.toml)

## 🎯 Prochaines Étapes

1. **Découvrir** : Explorez les tests existants
2. **Créer** : Ajoutez vos propres tests
3. **Intégrer** : Utilisez les utilitaires disponibles
4. **Optimiser** : Améliorez la couverture et la performance

Besoin d'aide ? Consultez le [README complet](./README.md) ou l'équipe de développement.
