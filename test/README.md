# Tests - Lukaya Trading Bot

Ce dossier contient tous les tests unitaires et d'intégration pour le bot de trading Lukaya.

## Structure des Tests

```
test/
├── README.md                          # Ce fichier
├── setup.ts                          # Configuration globale des tests
├── test-utils.ts                      # Utilitaires communs pour les tests
├── application/                       # Tests de la couche application
│   └── actors/
│       └── performance-tracker/
│           └── performance-tracker.logging.test.ts
├── reliability-validation.test.ts     # Tests de validation de fiabilité
└── test-reliability-improvements.test.ts # Tests d'améliorations de fiabilité
```

## Configuration

### Bun Test Runner

Ce projet utilise **Bun** comme test runner, pas Jest. La configuration se trouve dans `bunfig.toml`.

### Variables d'environnement

Les tests utilisent les variables d'environnement suivantes :
- `NODE_ENV=test`
- `LOG_LEVEL=error`
- `DISABLE_EXTERNAL_CALLS=true`

## Scripts de Test

### Package.json Scripts

```bash
# Exécuter tous les tests
bun run test

# Tests unitaires seulement
bun run test:unit

# Tests d'intégration seulement
bun run test:integration

# Tests en mode watch
bun run test:watch

# Tests avec couverture de code
bun run test:coverage
```

### Commandes Bun directes

```bash
# Exécuter tous les tests
bun test

# Exécuter un fichier de test spécifique
bun test test/reliability-validation.test.ts

# Exécuter les tests avec couverture
bun test --coverage

# Exécuter les tests en mode watch
bun test --watch

# Exécuter les tests avec verbose
bun test --verbose
```

## Types de Tests

### 1. Tests Unitaires

Tests des fonctions et classes individuelles sans dépendances externes.

**Exemple :**
```typescript
import { test, expect } from "bun:test";
import { createTestOrder } from "./test-utils";

test("should create valid order", () => {
  const order = createTestOrder({ symbol: "BTC-USD", size: 0.001 });
  expect(order.symbol).toBe("BTC-USD");
  expect(order.size).toBe(0.001);
});
```

### 2. Tests d'Intégration

Tests des interactions entre plusieurs composants.

**Exemple :**
```typescript
import { test, expect } from "bun:test";
import { createMockContext } from "./test-utils";

test("should process trade through full pipeline", async () => {
  const context = createMockContext();
  // Test de l'intégration complète
});
```

### 3. Tests de Fiabilité

Tests spécifiques aux améliorations de fiabilité du système.

## Utilitaires de Test

### test-utils.ts

Contient des helpers pour :
- Création d'objets mock
- Assertions personnalisées
- Gestion du temps dans les tests
- Logging de test
- Génération de données de test

**Exemples d'utilisation :**

```typescript
import {
  createMockContext,
  createTestOrder,
  expectToBeWithinRange,
  TestTimer,
  TestLogger
} from "./test-utils";

// Mock context
const context = createMockContext("test-actor");

// Test order
const order = createTestOrder({ symbol: "ETH-USD" });

// Assertions personnalisées
expectToBeWithinRange(42, 40, 45);

// Timer de test
const timer = new TestTimer();
timer.start();
// ... code à tester
timer.expectToBeWithin(100, 200);

// Logger de test
const logger = new TestLogger();
logger.info("Test message");
logger.expectLogCount("info", 1);
```

### setup.ts

Configuration globale qui :
- Configure les variables d'environnement
- Initialise les mocks globaux
- Étend les matchers expect
- Gère le cleanup des ressources

## Conventions de Test

### Nommage

- **Fichiers :** `*.test.ts` ou `*.spec.ts`
- **Fonctions :** `describe()` pour les groupes, `test()` ou `it()` pour les cas
- **Mocks :** Préfixe `mock` ou `Mock`

### Structure d'un Test

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";

describe("ComponentName", () => {
  let component: ComponentType;

  beforeEach(() => {
    // Setup avant chaque test
    component = new ComponentType();
  });

  afterEach(() => {
    // Cleanup après chaque test
    component.cleanup?.();
  });

  describe("methodName", () => {
    test("should do something when condition", () => {
      // Arrange
      const input = createTestInput();

      // Act
      const result = component.methodName(input);

      // Assert
      expect(result).toBe(expectedValue);
    });

    test("should throw error when invalid input", () => {
      expect(() => component.methodName(null)).toThrow();
    });
  });
});
```

### Assertions

```typescript
// Assertions de base
expect(value).toBe(expected);
expect(value).toEqual(expected);
expect(value).toBeNull();
expect(value).toBeUndefined();
expect(value).toBeTruthy();
expect(value).toBeFalsy();

// Assertions numériques
expect(value).toBeGreaterThan(5);
expect(value).toBeLessThanOrEqual(10);
expect(value).toBeCloseTo(3.14, 2);

// Assertions de tableaux et objets
expect(array).toHaveLength(3);
expect(array).toContain(item);
expect(object).toHaveProperty('key');
expect(object).toMatchObject(partial);

// Assertions personnalisées
expect(value).toBeWithinRange(10, 20);
```

## Debugging des Tests

### Logs de Debug

```typescript
// Activer les logs de debug pour un test
process.env.LOG_LEVEL = "debug";

// Utiliser le TestLogger
const logger = new TestLogger();
// ... vérifier les logs après le test
```

### Tests Flaky

Pour les tests instables :

```typescript
// Retry automatique
test("flaky test", async () => {
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {
      await testFunction();
      break;
    } catch (error) {
      attempts++;
      if (attempts === maxAttempts) throw error;
      await sleep(100);
    }
  }
});
```

## Performance des Tests

### Timeouts

```typescript
// Timeout par défaut : 30s
// Timeout personnalisé
test("long running test", async () => {
  // Test logic
}, 60000); // 60 secondes
```

### Parallélisation

Bun exécute les tests en parallèle par défaut. Pour les tests qui nécessitent un ordre spécifique :

```typescript
// Tests séquentiels
test.only("sequential test 1", async () => {
  // Premier test
});

test.only("sequential test 2", async () => {
  // Deuxième test (après le premier)
});
```

## Couverture de Code

### Configuration

La couverture est configurée dans `bunfig.toml` :
- Seuil minimum : 80%
- Formats : text, html, lcov
- Dossier de sortie : `./coverage`

### Exclusions

Fichiers exclus de la couverture :
- `*.d.ts` (déclarations TypeScript)
- `**/test/**` (fichiers de test)
- `**/index.ts` (fichiers d'export)

## Mocking

### Mocks de Modules

```typescript
// Mock d'un module externe
const mockModule = {
  functionName: jest.fn(),
};

// Mock d'une classe
class MockClass {
  method = jest.fn();
}
```

### Mocks de Fonctions

```typescript
const mockFunction = jest.fn();
mockFunction.mockReturnValue("mocked value");
mockFunction.mockResolvedValue(Promise.resolve("async value"));
```

## Troubleshooting

### Erreurs Communes

1. **Import/Export issues**
   - Vérifier les chemins relatifs depuis le dossier `test/`
   - S'assurer que les modules sont exportés correctement

2. **Tests qui ne se terminent pas**
   - Vérifier les timeouts
   - S'assurer que les promesses sont attendues
   - Nettoyer les timers et intervalles

3. **Mocks qui ne fonctionnent pas**
   - Vérifier l'ordre d'importation
   - S'assurer que les mocks sont réinitialisés entre les tests

### Debug Commands

```bash
# Exécuter un seul test avec debug
bun test --verbose test/specific-test.test.ts

# Exécuter les tests avec plus d'informations
bun test --reporter=verbose

# Analyser la couverture de code
bun test --coverage && open coverage/index.html
```

## Contribution

### Ajouter de Nouveaux Tests

1. Créer le fichier de test dans le bon dossier
2. Importer les utilitaires nécessaires
3. Suivre les conventions de nommage
4. Ajouter des assertions complètes
5. Tester localement avant de commit

### Bonnes Pratiques

- **Un test = une responsabilité**
- **Arrange, Act, Assert** pattern
- **Noms descriptifs** pour les tests
- **Cleanup** des ressources
- **Mocks** minimaux et ciblés
- **Assertions** explicites et complètes

## Ressources

- [Bun Test Documentation](https://bun.sh/docs/cli/test)
- [TypeScript Testing Best Practices](https://typescript-eslint.io/docs/linting/troubleshooting/#testing)
- [Jest API Reference](https://jestjs.io/docs/api) (pour la compatibilité des matchers)
