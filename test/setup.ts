/**
 * Configuration globale pour les tests
 */

import { beforeAll, afterAll, beforeEach, afterEach } from "bun:test";

// Variables globales pour les tests
declare global {
  var testStartTime: number;
  var testLogger: any;
}

// Setup avant tous les tests
beforeAll(async () => {
  console.log("🚀 Initialisation de la suite de tests...");

  // Configuration des variables d'environnement pour les tests
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "error";
  process.env.DISABLE_EXTERNAL_CALLS = "true";

  // Initialisation du timer global
  global.testStartTime = Date.now();

  console.log("✅ Setup global terminé");
});

// Cleanup après tous les tests
afterAll(async () => {
  const duration = Date.now() - global.testStartTime;
  console.log(`🏁 Tests terminés en ${duration}ms`);

  // Nettoyage des ressources globales
  if (global.testLogger) {
    global.testLogger.clear();
  }
});

// Setup avant chaque test
beforeEach(() => {
  // Reset des mocks si nécessaire
});

// Cleanup après chaque test
afterEach(() => {
  // Nettoyage des timers et intervalles
});

// Helpers globaux pour les tests
global.testUtils = {
  createMockPromise: <T>() => {
    let resolve: (value: T) => void;
    let reject: (reason?: any) => void;

    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    return { promise, resolve: resolve!, reject: reject! };
  },

  sleep: (ms: number): Promise<void> => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  mockConsole: () => {
    const originalConsole = { ...console };
    const logs: string[] = [];

    console.log = (...args) => logs.push(args.join(" "));
    console.error = (...args) => logs.push(`ERROR: ${args.join(" ")}`);
    console.warn = (...args) => logs.push(`WARN: ${args.join(" ")}`);

    return {
      logs,
      restore: () => {
        Object.assign(console, originalConsole);
      },
    };
  },
};

// Types pour TypeScript
declare global {
  var testUtils: {
    createMockPromise: <T>() => {
      promise: Promise<T>;
      resolve: (value: T) => void;
      reject: (reason?: any) => void;
    };
    sleep: (ms: number) => Promise<void>;
    mockConsole: () => {
      logs: string[];
      restore: () => void;
    };
  };
}

export {};
