import { BacktestUiAdapter } from "../../adapters/primary/backtest-ui.adapter";
import { BacktestConfig } from "../models/backtest.model";
import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";
import {
  createStrategyService,
  StrategyService,
} from "../../domain/services/strategy.service";
import { errorHandler } from "../../shared/errors";
import { Result, ParameterRanges } from "../../shared/types";
import { result } from "../../shared/utils";
import fs from "fs";
import path from "path";

/**
 * Interface en ligne de commande pour le backtesting
 */
export class BacktestCli {
  private logger = createContextualLogger("BacktestCli");
  private backtestAdapter: BacktestUiAdapter;

  constructor(strategyService: StrategyService) {
    this.backtestAdapter = new BacktestUiAdapter(strategyService);
  }

  /**
   * Affiche l'aide du CLI
   */
  showHelp(): void {
    console.log("Usage: bun run backtest [command] [options]");
    console.log("");
    console.log("Commands:");
    console.log(
      "  list                                Liste les stratégies disponibles",
    );
    console.log("  run --strategy <id> --config <path> Exécute un backtest");
    console.log(
      "  compare --strategies <ids> --config <path> Compare plusieurs stratégies",
    );
    console.log(
      "  optimize --strategy <id> --config <path> --params <path> Optimise les paramètres",
    );
    console.log("");
    console.log("Options:");
    console.log("  --strategy <id>      ID de la stratégie à tester");
    console.log(
      "  --strategies <ids>   IDs des stratégies à comparer (séparés par des virgules)",
    );
    console.log(
      "  --config <path>      Chemin vers le fichier de configuration JSON",
    );
    console.log(
      "  --params <path>      Chemin vers le fichier JSON contenant les plages de paramètres",
    );
    console.log(
      "  --output <path>      Chemin pour sauvegarder les résultats (optionnel)",
    );
    console.log(
      "  --format <format>    Format de sortie: json, report (default: report)",
    );
    console.log("  --help               Affiche ce message d'aide");
  }

  /**
   * Exécute une commande de backtesting
   */
  async execute(args: string[]): Promise<void> {
    if (args.length === 0 || args.includes("--help")) {
      this.showHelp();
      return;
    }

    const command = args[0];

    try {
      switch (command) {
        case "list":
          this.listStrategies();
          break;

        case "run": {
          const result = await this.runBacktest(args);
          if (!result.success) {
            this.logger.error(
              result.message || "Erreur lors de l'exécution du backtest",
            );
            console.error(`Erreur: ${result.message}`);
            process.exit(1);
          }
          break;
        }

        case "compare": {
          const result = await this.compareStrategies(args);
          if (!result.success) {
            this.logger.error(
              result.message || "Erreur lors de la comparaison des stratégies",
            );
            console.error(`Erreur: ${result.message}`);
            process.exit(1);
          }
          break;
        }

        case "optimize": {
          const result = await this.optimizeStrategy(args);
          if (!result.success) {
            this.logger.error(
              result.message || "Erreur lors de l'optimisation de la stratégie",
            );
            console.error(`Erreur: ${result.message}`);
            process.exit(1);
          }
          break;
        }

        default:
          console.log(`Commande inconnue: ${command}`);
          this.showHelp();
          break;
      }
    } catch (error) {
      this.logger.error(
        "Erreur lors de l'exécution de la commande:",
        error as Error,
      );
      console.error(`Erreur: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  /**
   * Liste les stratégies disponibles
   */
  listStrategies(): void {
    const strategies = this.backtestAdapter.getAvailableStrategies();

    console.log("Stratégies disponibles:");
    console.log("");

    if (strategies.length === 0) {
      console.log("Aucune stratégie disponible.");
      return;
    }

    strategies.forEach((strategy) => {
      console.log(`- ${strategy.id}: ${strategy.name}`);
      if (strategy.description) {
        console.log(`  ${strategy.description}`);
      }
      console.log("");
    });
  }

  /**
   * Parse les arguments de la ligne de commande
   */
  private parseArgs(args: string[]): Record<string, string> {
    const result: Record<string, string> = {};

    for (let i = 1; i < args.length; i++) {
      if (args[i].startsWith("--")) {
        const key = args[i].substring(2);
        if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
          result[key] = args[i + 1];
          i++;
        } else {
          result[key] = "true";
        }
      }
    }

    return result;
  }

  /**
   * Charge un fichier de configuration JSON
   */
  private loadJsonFile<T>(filePath: string): T {
    try {
      const fullPath = path.resolve(process.cwd(), filePath);
      const fileContent = fs.readFileSync(fullPath, "utf8");
      return JSON.parse(fileContent) as T;
    } catch (error) {
      throw new Error(
        `Impossible de charger le fichier ${filePath}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Exécute un backtest
   */
  private async runBacktest(args: string[]): Promise<Result<void>> {
    const options = this.parseArgs(args);

    // Vérifier les options obligatoires
    if (!options.strategy) {
      return errorHandler.validationError("L'option --strategy est requise");
    }

    if (!options.config) {
      return errorHandler.validationError("L'option --config est requise");
    }

    // Charger la configuration
    const config = this.loadJsonFile<BacktestConfig>(options.config);

    // Convertir les dates
    config.startDate = new Date(config.startDate);
    config.endDate = new Date(config.endDate);

    // Exécuter le backtest
    this.logger.info(
      `Exécution du backtest pour la stratégie ${options.strategy}`,
    );
    const backtestResult = await this.backtestAdapter.runBacktest(
      options.strategy,
      config,
    );

    // Déterminer le format de sortie
    const format = options.format || "report";

    if (format === "json") {
      console.log(JSON.stringify(backtestResult, null, 2));
    } else {
      const report =
        this.backtestAdapter.generateBacktestReport(backtestResult);
      console.log(report);
    }

    // Sauvegarder les résultats si demandé
    if (options.output) {
      if (format === "json") {
        this.backtestAdapter.exportBacktestResults(
          backtestResult,
          options.output,
        );
      } else {
        const report =
          this.backtestAdapter.generateBacktestReport(backtestResult);
        fs.writeFileSync(options.output, report);
      }
      console.log(`Résultats sauvegardés dans ${options.output}`);
    }

    return result.success(undefined, "Backtest exécuté avec succès");
  }

  /**
   * Compare plusieurs stratégies
   */
  private async compareStrategies(args: string[]): Promise<Result<void>> {
    const options = this.parseArgs(args);

    // Vérifier les options obligatoires
    if (!options.strategies) {
      return errorHandler.validationError("L'option --strategies est requise");
    }

    if (!options.config) {
      return errorHandler.validationError("L'option --config est requise");
    }

    // Charger la configuration
    const config = this.loadJsonFile<BacktestConfig>(options.config);

    // Convertir les dates
    config.startDate = new Date(config.startDate);
    config.endDate = new Date(config.endDate);

    // Extraire les IDs des stratégies
    const strategyIds = options.strategies.split(",").map((id) => id.trim());

    // Exécuter la comparaison
    this.logger.info(`Comparaison des stratégies: ${strategyIds.join(", ")}`);
    const results = await this.backtestAdapter.compareStrategies(
      strategyIds,
      config,
    );

    // Afficher les résultats
    console.log("Résultats de la comparaison:");
    console.log("");

    // Trier par performance
    results.sort((a, b) => b.profitPercentage - a.profitPercentage);

    results.forEach((result, index) => {
      console.log(`${index + 1}. ${result.strategyName}`);
      console.log(
        `   Profit: ${result.profit.toFixed(2)} USDT (${result.profitPercentage.toFixed(2)}%)`,
      );
      console.log(
        `   Trades: ${result.metrics.totalTrades}, Win rate: ${(result.metrics.winRate * 100).toFixed(2)}%`,
      );
      console.log(
        `   Drawdown max: ${result.metrics.maxDrawdownPercentage.toFixed(2)}%`,
      );
      console.log(
        `   Ratio de Sharpe: ${result.metrics.sharpeRatio.toFixed(2)}`,
      );
      console.log("");
    });

    // Sauvegarder les résultats si demandé
    if (options.output) {
      fs.writeFileSync(options.output, JSON.stringify(results, null, 2));
      console.log(`Résultats sauvegardés dans ${options.output}`);
    }

    return result.success(undefined, "Comparaison exécutée avec succès");
  }

  /**
   * Optimise les paramètres d'une stratégie
   */
  private async optimizeStrategy(args: string[]): Promise<Result<void>> {
    const options = this.parseArgs(args);

    // Vérifier les options obligatoires
    if (!options.strategy) {
      return errorHandler.validationError("L'option --strategy est requise");
    }

    if (!options.config) {
      return errorHandler.validationError("L'option --config est requise");
    }

    if (!options.params) {
      return errorHandler.validationError("L'option --params est requise");
    }

    // Charger la configuration
    const config = this.loadJsonFile<BacktestConfig>(options.config);
    const parameterRanges = this.loadJsonFile<ParameterRanges>(options.params);

    // Convertir les dates
    config.startDate = new Date(config.startDate);
    config.endDate = new Date(config.endDate);

    // Exécuter l'optimisation
    this.logger.info(`Optimisation de la stratégie ${options.strategy}`);
    const results = await this.backtestAdapter.optimizeStrategy(
      options.strategy,
      config,
      parameterRanges,
    );

    // Afficher les résultats
    console.log("Meilleurs paramètres:");
    console.log(JSON.stringify(results.bestParameters, null, 2));
    console.log("");
    console.log("Résultats avec les meilleurs paramètres:");
    console.log(
      `Profit: ${results.bestResult.profit.toFixed(2)} USDT (${results.bestResult.profitPercentage.toFixed(2)}%)`,
    );
    console.log(
      `Trades: ${results.bestResult.metrics.totalTrades}, Win rate: ${(results.bestResult.metrics.winRate * 100).toFixed(2)}%`,
    );
    console.log(
      `Drawdown max: ${results.bestResult.metrics.maxDrawdownPercentage.toFixed(2)}%`,
    );

    // Sauvegarder les résultats si demandé
    if (options.output) {
      fs.writeFileSync(options.output, JSON.stringify(results, null, 2));
      console.log(`Résultats sauvegardés dans ${options.output}`);
    }

    return result.success(undefined, "Optimisation exécutée avec succès");
  }
}

// Function to create and register strategies from environment variables
async function initializeStrategiesFromEnv(
  strategyService: StrategyService,
): Promise<void> {
  const { loadConfig } = await import(
    "../../infrastructure/config/enhanced-config"
  );
  const { StrategyFactory } = await import(
    "../../adapters/strategies/strategy-factory"
  );
  const { StrategyType } = await import("../../shared/enums");

  try {
    // Load configuration from environment variables
    const config = loadConfig();

    // Create strategy factory
    const strategyFactory = new StrategyFactory();

    // Helper function to convert strategy type string to enum
    const getStrategyType = (
      typeString: string,
    ): (typeof StrategyType)[keyof typeof StrategyType] | null => {
      const typeMap: Record<
        string,
        (typeof StrategyType)[keyof typeof StrategyType]
      > = {
        "rsi-div": StrategyType.RSI_DIVERGENCE,
        "rsi-divergence": StrategyType.RSI_DIVERGENCE,
        "volume-analysis": StrategyType.VOLUME_ANALYSIS,
        "elliott-wave": StrategyType.ELLIOTT_WAVE,
        "harmonic-pattern": StrategyType.HARMONIC_PATTERN,
        "scalping-entry-exit": StrategyType.SCALPING_ENTRY_EXIT,
        "coordinated-multi-strategy": StrategyType.COORDINATED_MULTI_STRATEGY,
      };
      return typeMap[typeString] || null;
    };

    // Create strategies from configuration
    let addedStrategies = 0;

    for (const strategyConfig of config.strategies) {
      if (!strategyConfig.enabled) {
        continue;
      }

      try {
        // Convert the type string to enum StrategyType
        const strategyType = getStrategyType(strategyConfig.type);
        if (!strategyType) {
          console.warn(`Type de stratégie non reconnu: ${strategyConfig.type}`);
          continue;
        }

        // Check if parameters are present
        if (!strategyConfig.parameters) {
          console.warn(
            `Paramètres manquants pour la stratégie: ${strategyConfig.type}`,
          );
          continue;
        }

        // Create the strategy with the enum type
        const strategy = await strategyFactory.createStrategy(
          strategyType,
          strategyConfig.parameters as Record<string, unknown>,
        );

        strategyService.registerStrategy(strategy);
        addedStrategies++;

        console.log(`✅ Stratégie chargée: ${strategy.getName()}`);
      } catch (error) {
        console.error(
          `❌ Erreur lors de l'initialisation de la stratégie: ${strategyConfig.type}`,
          error,
        );
      }
    }

    if (addedStrategies > 0) {
      console.log(
        `📈 ${addedStrategies} stratégies chargées depuis les variables d'environnement\n`,
      );
    } else {
      console.log(
        `⚠️  Aucune stratégie chargée. Vérifiez vos variables d'environnement ACTIVE_STRATEGIES\n`,
      );
    }
  } catch (error) {
    console.error("❌ Erreur lors du chargement des stratégies:", error);
  }
}

// Point d'entrée pour l'exécution en ligne de commande
if (import.meta.url === `file://${process.argv[1]}`) {
  const strategyService = createStrategyService();

  // Initialize strategies from environment variables
  initializeStrategiesFromEnv(strategyService)
    .then(() => {
      const cli = new BacktestCli(strategyService);
      cli.execute(process.argv.slice(2));
    })
    .catch((error) => {
      console.error("❌ Erreur lors de l'initialisation:", error);
      process.exit(1);
    });
}
