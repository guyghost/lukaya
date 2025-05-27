#!/usr/bin/env bun
/**
 * Point d'entrée principal du Lukaya Trading Bot
 * Version refactorisée avec une architecture propre et une gestion d'erreur améliorée
 */

import { loadConfig, getNetworkFromString } from "./infrastructure/config/enhanced-config";
import { initializeLogger, createContextualLogger } from "./infrastructure/logging/enhanced-logger";
import { createDydxClient } from "./adapters/secondary/dydx-client.adapter";
import { createTradingBotService, TradingBotService } from "./application/services/trading-bot.service";
import { StrategyFactory } from "./adapters/strategies";
import { ServiceStatus, StrategyType } from "./shared/enums";
import { Result } from "./shared/types";
import { result } from "./shared/utils";
import { AppConfig } from "./shared/interfaces/config.interface";

// Interface pour l'application principale
interface LukayaApp {
  status: ServiceStatus;
  start(): Promise<Result<void>>;
  stop(): Promise<Result<void>>;
  getHealth(): Promise<any>;
}

/**
 * Classe principale de l'application Lukaya Trading Bot
 */
class LukayaTradingApp implements LukayaApp {
  public status: ServiceStatus = ServiceStatus.STOPPED;
  private logger = createContextualLogger('LukayaApp');
  private tradingBot!: TradingBotService; // Définitive assignment assertion
  private config!: AppConfig; // Définitive assignment assertion

  constructor() {
    this.setupProcessHandlers();
  }

  /**
   * Démarre l'application
   */
  public async start(): Promise<Result<void>> {
    try {
      this.status = ServiceStatus.STARTING;
      this.logger.info("🚀 Démarrage de Lukaya Trading Bot...");

      // 1. Charger la configuration
      const configResult = await this.loadConfiguration();
      if (!configResult.success) {
        return configResult;
      }

      // 2. Initialiser les services
      const servicesResult = await this.initializeServices();
      if (!servicesResult.success) {
        return servicesResult;
      }

      // 3. Démarrer le bot de trading (Moved BEFORE setupStrategies)
      const botResult = await this.startTradingBot();
      if (!botResult.success) {
        return botResult;
      }

      // 4. Configurer les stratégies (Moved AFTER startTradingBot)
      const strategiesResult = await this.setupStrategies();
      if (!strategiesResult.success) {
        return strategiesResult;
      }

      this.status = ServiceStatus.RUNNING;
      this.logger.info("✅ Lukaya Trading Bot démarré avec succès!");

      return result.success(undefined, "Application démarrée");

    } catch (error) {
      this.status = ServiceStatus.ERROR;
      const errorMsg = "Erreur critique lors du démarrage";
      this.logger.error(errorMsg, error as Error);
      return result.error(error as Error, errorMsg);
    }
  }

  /**
   * Arrête l'application
   */
  public async stop(): Promise<Result<void>> {
    try {
      this.status = ServiceStatus.STOPPING;
      this.logger.info("🛑 Arrêt de Lukaya Trading Bot...");

      if (this.tradingBot) {
        // Analyse finale des positions avant l'arrêt
        this.logger.info("Analyse finale des positions ouvertes...");
        await this.tradingBot.analyzeOpenPositions();

        // Arrêt du bot
        this.tradingBot.stop();
      }

      this.status = ServiceStatus.STOPPED;
      this.logger.info("✅ Lukaya Trading Bot arrêté proprement");

      return result.success(undefined, "Application arrêtée");

    } catch (error) {
      this.status = ServiceStatus.ERROR;
      const errorMsg = "Erreur lors de l'arrêt";
      this.logger.error(errorMsg, error as Error);
      return result.error(error as Error, errorMsg);
    }
  }

  /**
   * Retourne l'état de santé de l'application
   */
  public async getHealth(): Promise<any> {
    return {
      status: this.status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      pid: process.pid,
      version: process.env.npm_package_version || '1.0.0',
    };
  }

  /**
   * Charge et valide la configuration
   */
  private async loadConfiguration(): Promise<Result<void>> {
    try {
      this.logger.debug("📋 Chargement de la configuration...");
      
      this.config = loadConfig();
      
      // Initialiser le logger avec la nouvelle configuration
      initializeLogger({
        level: this.config.logging.level,
        fileOutput: this.config.logging.fileOutput,
        logFilePath: this.config.logging.logFilePath,
        maxFileSize: this.config.logging.maxFileSize,
        maxFiles: this.config.logging.maxFiles,
      });

      this.logger.info("Configuration chargée", {
        network: this.config.network,
        strategiesCount: this.config.strategies.length,
        symbolsCount: this.config.trading.defaultSymbols.length,
      });

      return result.success(undefined, "Configuration chargée");

    } catch (error) {
      return result.error(error as Error, "Erreur lors du chargement de la configuration");
    }
  }

  /**
   * Initialise les services principaux
   */
  private async initializeServices(): Promise<Result<void>> {
    try {
      this.logger.debug("🔧 Initialisation des services...");

      // Initialiser le client dYdX
      const { marketDataPort, tradingPort } = createDydxClient({
        network: getNetworkFromString(this.config.network),
        mnemonic: this.config.dydx.mnemonic,
      });

      // Vérifier l'accès au compte
      this.logger.debug("Vérification de l'accès au compte...");
      const accountBalance = await tradingPort.getAccountBalance();
      
      this.logger.info("Accès au compte validé", {
        balanceKeys: Object.keys(accountBalance),
      });

      // Créer le service de trading bot
      this.tradingBot = createTradingBotService(
        marketDataPort,
        tradingPort,
        {
          pollInterval: this.config.trading.pollInterval,
          positionAnalysisInterval: this.config.trading.positionAnalysisInterval,
          maxFundsPerOrder: this.config.trading.maxFundsPerOrder,
          riskConfig: {
            maxRiskPerTrade: this.config.trading.riskPerTrade,
            stopLossPercent: this.config.trading.stopLossPercent,
            accountSize: this.config.trading.defaultAccountSize,
            maxLeverage: this.config.trading.maxLeverage,
            maxOpenPositions: this.config.actors?.riskManager?.maxOpenPositions ?? 3,
            maxPositionSize: this.config.trading.maxCapitalPerTrade,
          },
          strategyConfig: {
            autoAdjustWeights: this.config.actors?.strategyManager?.autoAdjustWeights ?? true,
            maxActiveStrategies: this.config.actors?.strategyManager?.maxActiveStrategies ?? 4,
            conflictResolutionMode: this.config.actors?.strategyManager?.conflictResolutionMode ?? 'performance_weighted',
            optimizationEnabled: this.config.actors?.strategyManager?.optimizationEnabled ?? true,
          },
          performanceConfig: {
            historyLength: this.config.actors?.performanceTracker?.historyLength ?? 100,
            trackOpenPositions: this.config.actors?.performanceTracker?.trackOpenPositions ?? true,
            realTimeUpdates: this.config.actors?.performanceTracker?.realTimeUpdates ?? true,
            calculationInterval: this.config.actors?.performanceTracker?.calculationInterval ?? 300000,
          },
          takeProfitConfig: {
            enabled: this.config.takeProfit?.enabled ?? false,
            profitTiers: this.config.takeProfit?.profitTiers ?? [],
            cooldownPeriod: this.config.takeProfit?.cooldownPeriod ?? 600000,
            trailingMode: this.config.takeProfit?.trailingMode ?? false,
          },
          takeProfitIntegratorConfig: {
            priceCheckInterval: 30 * 1000,
            positionCheckInterval: 2 * 60 * 1000,
          },
        }
      );

      return result.success(undefined, "Services initialisés");

    } catch (error) {
      return result.error(error as Error, "Erreur lors de l'initialisation des services");
    }
  }

  /**
   * Convertit un type de stratégie string en enum StrategyType
   */
  private getStrategyType(typeString: string): StrategyType | null {
    if (!typeString) {
      this.logger.error("Type de stratégie non spécifié");
      return null;
    }
    
    const typeMap: Record<string, StrategyType> = {
      'rsi-div': StrategyType.RSI_DIVERGENCE,
      'rsi-divergence': StrategyType.RSI_DIVERGENCE,  // Keep for backwards compatibility
      'volume-analysis': StrategyType.VOLUME_ANALYSIS,
      'elliott-wave': StrategyType.ELLIOTT_WAVE,
      'harmonic-pattern': StrategyType.HARMONIC_PATTERN
    };

    const strategyType = typeMap[typeString];
    if (!strategyType) {
      this.logger.error(`Type de stratégie non supporté: ${typeString}. Types supportés: ${Object.keys(typeMap).join(', ')}`);
      return null;
    }

    return strategyType;
  }

  /**
   * Configure et ajoute les stratégies
   */
  private async setupStrategies(): Promise<Result<void>> {
    try {
      this.logger.info("🎯 Configuration des stratégies de trading...");

      const strategyFactory = new StrategyFactory();
      let addedStrategies = 0;

      for (const strategyConfig of this.config.strategies) {
        if (!strategyConfig.enabled) {
          this.logger.debug(`Stratégie désactivée: ${strategyConfig.type}`);
          continue;
        }

        try {
          // Convertir le type string en enum StrategyType
          const strategyType = this.getStrategyType(strategyConfig.type);
          if (!strategyType) {
            this.logger.error(`Type de stratégie non reconnu: ${strategyConfig.type}`);
            continue;
          }

          // Vérifier que les paramètres sont présents
          if (!strategyConfig.parameters) {
            this.logger.error(`Paramètres manquants pour la stratégie: ${strategyConfig.type}`);
            continue;
          }

          // Créer la stratégie avec le type enum
          const strategy = await strategyFactory.createStrategy(
            strategyType,
            strategyConfig.parameters as any // Cast to any to handle the Record<string, unknown> issue
          );

          this.tradingBot.addStrategy(strategy);
          addedStrategies++;

          this.logger.info(`Stratégie ajoutée: ${strategy.getName()}`, {
            type: strategyConfig.type,
            weight: strategyConfig.weight,
          });

        } catch (error) {
          this.logger.error(
            `Erreur lors de l'initialisation de la stratégie: ${strategyConfig.type}`,
            error as Error
          );
          // Continuer avec les autres stratégies
        }
      }

      if (addedStrategies === 0) {
        return result.error(
          new Error("Aucune stratégie n'a pu être initialisée"),
          "Configuration des stratégies échouée"
        );
      }

      this.logger.info(`${addedStrategies} stratégies configurées avec succès`);
      return result.success(undefined, "Stratégies configurées");

    } catch (error) {
      return result.error(error as Error, "Erreur lors de la configuration des stratégies");
    }
  }

  /**
   * Démarre le bot de trading
   */
  private async startTradingBot(): Promise<Result<void>> {
    try {
      this.logger.info("▶️ Démarrage du bot de trading...");

      this.tradingBot.start();

      // Programmer l'analyse initiale des positions après 1 minute
      setTimeout(() => {
        this.logger.info("Analyse initiale des positions...");
        this.tradingBot.analyzeOpenPositions();
      }, 60 * 1000);

      return result.success(undefined, "Bot de trading démarré");

    } catch (error) {
      return result.error(error as Error, "Erreur lors du démarrage du bot");
    }
  }

  /**
   * Configure les gestionnaires de processus pour un arrêt propre
   */
  private setupProcessHandlers(): void {
    // Arrêt propre sur SIGINT (Ctrl+C)
    process.on("SIGINT", async () => {
      this.logger.info("Signal SIGINT reçu, arrêt en cours...");
      await this.stop();
      process.exit(0);
    });

    // Arrêt propre sur SIGTERM
    process.on("SIGTERM", async () => {
      this.logger.info("Signal SIGTERM reçu, arrêt en cours...");
      await this.stop();
      process.exit(0);
    });

    // Gestion des exceptions non capturées
    process.on("uncaughtException", (error: Error) => {
      this.logger.error("Exception non capturée", error);
      setTimeout(() => process.exit(1), 1000);
    });

    // Gestion des rejets de promesses non capturés
    process.on("unhandledRejection", (reason: unknown) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      this.logger.error("Rejet de promesse non capturé", error);
      setTimeout(() => process.exit(1), 1000);
    });
  }
}

/**
 * Fonction principale d'entrée
 */
export const main = async (): Promise<void> => {
  const app = new LukayaTradingApp();
  
  const startResult = await app.start();
  
  if (!startResult.success) {
    console.error("Erreur fatale:", startResult.error?.message);
    process.exit(1);
  }
};

// Démarrage de l'application si ce fichier est exécuté directement
// Compatible avec Bun et Node.js
const isMainModule = (() => {
  // Pour Bun
  if (typeof import.meta !== 'undefined' && 'main' in import.meta) {
    return import.meta.main;
  }
  // Pour Node.js avec ES modules
  if (typeof process !== 'undefined' && process.argv[1]) {
    const currentFile = import.meta.url;
    const mainFile = `file://${process.argv[1]}`;
    return currentFile === mainFile;
  }
  return false;
})();

if (isMainModule) {
  main().catch((error: Error) => {
    console.error("Erreur fatale lors du démarrage:", error);
    process.exit(1);
  });
}
