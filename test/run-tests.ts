#!/usr/bin/env bun

/**
 * Script d'exécution des tests pour Lukaya Trading Bot
 *
 * Usage:
 *   bun run test/run-tests.ts [options]
 *
 * Options:
 *   --unit           Exécuter seulement les tests unitaires
 *   --integration    Exécuter seulement les tests d'intégration
 *   --reliability    Exécuter seulement les tests de fiabilité
 *   --performance    Exécuter seulement les tests de performance
 *   --coverage       Inclure la couverture de code
 *   --watch          Mode watch
 *   --verbose        Mode verbose
 *   --bail           Arrêter à la première erreur
 *   --parallel       Nombre de workers parallèles (défaut: 4)
 *   --timeout        Timeout en ms (défaut: 30000)
 *   --help           Afficher cette aide
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";

interface TestOptions {
  unit?: boolean;
  integration?: boolean;
  reliability?: boolean;
  performance?: boolean;
  coverage?: boolean;
  watch?: boolean;
  verbose?: boolean;
  bail?: boolean;
  parallel?: number;
  timeout?: number;
  help?: boolean;
}

class TestRunner {
  private options: TestOptions;
  private testPatterns: string[] = [];

  constructor(options: TestOptions) {
    this.options = options;
    this.buildTestPatterns();
  }

  private buildTestPatterns(): void {
    if (this.options.unit) {
      this.testPatterns.push("test/unit/**/*.test.ts");
    }

    if (this.options.integration) {
      this.testPatterns.push("test/integration/**/*.test.ts");
    }

    if (this.options.reliability) {
      this.testPatterns.push("test/unit/reliability-validation.test.ts");
      this.testPatterns.push(
        "test/integration/test-reliability-improvements.test.ts",
      );
    }

    if (this.options.performance) {
      this.testPatterns.push(
        "test/application/actors/performance-tracker/**/*.test.ts",
      );
    }

    // Si aucun pattern spécifique, exécuter tous les tests
    if (this.testPatterns.length === 0) {
      this.testPatterns.push("test/**/*.test.ts");
    }
  }

  private buildCommand(): string[] {
    const args = ["test"];

    // Patterns de test avec le bon format pour Bun
    if (this.testPatterns.length > 0) {
      this.testPatterns.forEach((pattern) => {
        args.push("./" + pattern);
      });
    } else {
      args.push("./test/**/*.test.ts");
    }

    // Options Bun
    if (this.options.coverage) {
      args.push("--coverage");
    }

    if (this.options.watch) {
      args.push("--watch");
    }

    if (this.options.verbose) {
      args.push("--verbose");
    }

    if (this.options.bail) {
      args.push("--bail");
    }

    if (this.options.timeout) {
      args.push("--timeout", this.options.timeout.toString());
    }

    return args;
  }

  private validateEnvironment(): boolean {
    // Vérifier que Bun est installé
    try {
      const bunVersion = Bun.version;
      console.log(`🟢 Bun version: ${bunVersion}`);
    } catch (error) {
      console.error("❌ Bun n'est pas installé ou accessible");
      return false;
    }

    // Vérifier que les dossiers de test existent
    const testDirs = ["test/unit", "test/integration", "test/application"];
    for (const dir of testDirs) {
      if (!existsSync(dir)) {
        console.warn(`⚠️  Dossier de test manquant: ${dir}`);
      }
    }

    // Vérifier la configuration
    if (!existsSync("bunfig.toml")) {
      console.warn("⚠️  Fichier de configuration bunfig.toml manquant");
    }

    return true;
  }

  private showHelp(): void {
    console.log(`
🧪 Lukaya Trading Bot - Test Runner

Usage:
  bun run test/run-tests.ts [options]

Options:
  --unit           Exécuter seulement les tests unitaires
  --integration    Exécuter seulement les tests d'intégration
  --reliability    Exécuter seulement les tests de fiabilité
  --performance    Exécuter seulement les tests de performance
  --coverage       Inclure la couverture de code
  --watch          Mode watch
  --verbose        Mode verbose
  --bail           Arrêter à la première erreur
  --parallel N     Nombre de workers parallèles (défaut: 4)
  --timeout N      Timeout en ms (défaut: 30000)
  --help           Afficher cette aide

Exemples:
  bun run test/run-tests.ts --unit --coverage
  bun run test/run-tests.ts --integration --verbose
  bun run test/run-tests.ts --reliability
  bun run test/run-tests.ts --watch
  bun run test/run-tests.ts --unit --integration --bail

Types de tests:
  📋 Unit        Tests unitaires rapides (< 1s par test)
  🔗 Integration Tests d'intégration (interaction entre composants)
  🛡️  Reliability Tests de fiabilité et récupération d'erreurs
  ⚡ Performance Tests de performance et charge
    `);
  }

  private printTestSummary(): void {
    console.log("📊 Configuration des tests:");
    console.log(`   Patterns: ${this.testPatterns.join(", ")}`);
    console.log(`   Coverage: ${this.options.coverage ? "✅" : "❌"}`);
    console.log(`   Watch: ${this.options.watch ? "✅" : "❌"}`);
    console.log(`   Verbose: ${this.options.verbose ? "✅" : "❌"}`);
    console.log(`   Bail: ${this.options.bail ? "✅" : "❌"}`);
    console.log(`   Timeout: ${this.options.timeout || 30000}ms`);
    console.log("");
  }

  async run(): Promise<number> {
    if (this.options.help) {
      this.showHelp();
      return 0;
    }

    console.log("🚀 Démarrage des tests Lukaya Trading Bot...\n");

    if (!this.validateEnvironment()) {
      return 1;
    }

    this.printTestSummary();

    const command = this.buildCommand();
    console.log(`🔧 Commande: bun ${command.join(" ")}\n`);

    return new Promise((resolve) => {
      const startTime = Date.now();

      const proc = spawn("bun", command, {
        stdio: "inherit",
        cwd: process.cwd(),
      });

      proc.on("close", (code) => {
        const duration = Date.now() - startTime;
        const minutes = Math.floor(duration / 60000);
        const seconds = Math.floor((duration % 60000) / 1000);

        console.log(`\n⏱️  Durée d'exécution: ${minutes}m ${seconds}s`);

        if (code === 0) {
          console.log("✅ Tous les tests sont passés avec succès!");

          if (this.options.coverage) {
            console.log("📈 Rapport de couverture généré dans ./coverage/");
          }
        } else {
          console.log(`❌ Tests échoués avec le code: ${code}`);
        }

        resolve(code || 0);
      });

      proc.on("error", (error) => {
        console.error(`❌ Erreur lors de l'exécution: ${error.message}`);
        resolve(1);
      });
    });
  }
}

// Parsing des arguments
function parseArgs(): TestOptions {
  const args = process.argv.slice(2);
  const options: TestOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--unit":
        options.unit = true;
        break;
      case "--integration":
        options.integration = true;
        break;
      case "--reliability":
        options.reliability = true;
        break;
      case "--performance":
        options.performance = true;
        break;
      case "--coverage":
        options.coverage = true;
        break;
      case "--watch":
        options.watch = true;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--bail":
        options.bail = true;
        break;
      case "--parallel":
        options.parallel = parseInt(args[++i]) || 4;
        break;
      case "--timeout":
        options.timeout = parseInt(args[++i]) || 30000;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        if (arg.startsWith("--")) {
          console.warn(`⚠️  Option inconnue: ${arg}`);
        }
        break;
    }
  }

  return options;
}

// Point d'entrée principal
async function main(): Promise<void> {
  try {
    const options = parseArgs();
    const runner = new TestRunner(options);
    const exitCode = await runner.run();
    process.exit(exitCode);
  } catch (error) {
    console.error("❌ Erreur fatale:", error);
    process.exit(1);
  }
}

// Gestion des signaux pour un arrêt propre
process.on("SIGINT", () => {
  console.log("\n⚠️  Arrêt des tests demandé...");
  process.exit(130);
});

process.on("SIGTERM", () => {
  console.log("\n⚠️  Arrêt des tests (SIGTERM)...");
  process.exit(143);
});

// Exécution si le script est appelé directement
if (import.meta.main) {
  main();
}

export { TestRunner, parseArgs };
