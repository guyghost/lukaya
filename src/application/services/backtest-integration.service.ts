import { BacktestService } from "../../backtest/services/backtest.service";
import {
  BacktestConfig,
  BacktestResult,
} from "../../backtest/models/backtest.model";
import { Strategy } from "../../domain/models/strategy.model";
import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";
import { TradingBotService } from "./trading-bot.service";

/**
 * Service d'intégration du backtesting avec le bot de trading
 * Permet d'utiliser le backtesting pour évaluer et valider les stratégies
 * avant de les déployer en production
 */
export class BacktestIntegrationService {
  private logger = createContextualLogger("BacktestIntegrationService");
  private backtestService: BacktestService;
  private tradingBotService: TradingBotService;

  constructor(tradingBotService: TradingBotService) {
    this.backtestService = new BacktestService();
    this.tradingBotService = tradingBotService;
  }

  /**
   * Teste une stratégie en backtest avant de l'ajouter au bot de trading
   * Si la stratégie est rentable selon les critères, elle est ajoutée automatiquement
   */
  async validateAndAddStrategy(
    strategy: Strategy,
    config: BacktestConfig,
    validationCriteria: {
      minProfitPercentage?: number;
      minWinRate?: number;
      maxDrawdownPercentage?: number;
      minSharpeRatio?: number;
    } = {},
  ): Promise<{
    passed: boolean;
    result: BacktestResult;
    addedToBot: boolean;
    reason?: string;
  }> {
    this.logger.info(
      "Validation de la stratégie " +
        strategy.getName() +
        " avant ajout au bot",
    );

    try {
      // Exécuter le backtest
      const result = await this.backtestService.runBacktest(strategy, config);

      // Critères de validation par défaut
      const criteria = {
        minProfitPercentage: validationCriteria.minProfitPercentage ?? 5,
        minWinRate: validationCriteria.minWinRate ?? 0.5,
        maxDrawdownPercentage: validationCriteria.maxDrawdownPercentage ?? 15,
        minSharpeRatio: validationCriteria.minSharpeRatio ?? 0.5,
      };

      // Vérifier si la stratégie répond aux critères
      const validationResults = {
        profitPercentage:
          result.profitPercentage >= criteria.minProfitPercentage,
        winRate: result.metrics.winRate >= criteria.minWinRate,
        drawdown:
          result.metrics.maxDrawdownPercentage <=
          criteria.maxDrawdownPercentage,
        sharpeRatio: result.metrics.sharpeRatio >= criteria.minSharpeRatio,
      };

      // Vérifier si tous les critères sont respectés
      const passed = Object.values(validationResults).every((v) => v);

      if (passed) {
        this.logger.info(
          "La stratégie " +
            strategy.getName() +
            " a passé tous les critères de validation",
        );

        try {
          // Ajouter la stratégie au bot de trading
          this.tradingBotService.addStrategy(strategy);

          return {
            passed: true,
            result,
            addedToBot: true,
          };
        } catch (error) {
          this.logger.error(
            "Erreur lors de l'ajout de la stratégie au bot :",
            error as Error,
          );

          return {
            passed: true,
            result,
            addedToBot: false,
            reason: `Erreur lors de l'ajout au bot: ${(error as Error).message}`,
          };
        }
      } else {
        // Construire la raison de l'échec
        const failedCriteria = [];

        if (!validationResults.profitPercentage) {
          failedCriteria.push(
            `Profit (${result.profitPercentage.toFixed(2)}%) < ${criteria.minProfitPercentage}%`,
          );
        }

        if (!validationResults.winRate) {
          failedCriteria.push(
            `Win rate (${(result.metrics.winRate * 100).toFixed(2)}%) < ${criteria.minWinRate * 100}%`,
          );
        }

        if (!validationResults.drawdown) {
          failedCriteria.push(
            `Drawdown (${result.metrics.maxDrawdownPercentage.toFixed(2)}%) > ${criteria.maxDrawdownPercentage}%`,
          );
        }

        if (!validationResults.sharpeRatio) {
          failedCriteria.push(
            `Sharpe ratio (${result.metrics.sharpeRatio.toFixed(2)}) < ${criteria.minSharpeRatio}`,
          );
        }

        const reason = `La stratégie n'a pas respecté les critères: ${failedCriteria.join(", ")}`;
        this.logger.warn(reason);

        return {
          passed: false,
          result,
          addedToBot: false,
          reason,
        };
      }
    } catch (error) {
      this.logger.error(
        "Erreur lors de la validation de la stratégie :",
        error as Error,
      );

      return {
        passed: false,
        result: {} as BacktestResult,
        addedToBot: false,
        reason: `Erreur lors du backtest: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Valide toutes les stratégies actives du bot sur des données historiques
   * Génère un rapport de performance et suggère des modifications
   */
  async validateActiveStrategies(config: BacktestConfig): Promise<{
    results: Record<string, BacktestResult>;
    recommendations: Record<
      string,
      {
        action: "keep" | "remove" | "optimize";
        reason: string;
        optimizationSuggestions?: Record<string, any>;
      }
    >;
  }> {
    this.logger.info("Validation des stratégies actives");

    const results: Record<string, BacktestResult> = {};
    const recommendations: Record<
      string,
      {
        action: "keep" | "remove" | "optimize";
        reason: string;
        optimizationSuggestions?: Record<string, any>;
      }
    > = {};

    // Récupérer toutes les stratégies actives
    // Cette méthode peut ne pas exister et doit être adaptée selon l'implémentation réelle
    // @ts-ignore
    const activeStrategies =
      this.tradingBotService.getActiveStrategies?.() || [];

    if (activeStrategies.length === 0) {
      this.logger.warn("Aucune stratégie active à valider");
      return { results, recommendations };
    }

    // Évaluer chaque stratégie active
    for (const strategy of activeStrategies) {
      this.logger.info(
        "Validation de la stratégie active : " + strategy.getName(),
      );

      try {
        const result = await this.backtestService.runBacktest(strategy, config);
        results[strategy.getId()] = result;

        // Critères pour les recommandations
        if (result.profitPercentage <= 0) {
          // Stratégie non rentable, suggérer de la retirer
          recommendations[strategy.getId()] = {
            action: "remove",
            reason: `Stratégie non rentable (${result.profitPercentage.toFixed(2)}%) sur la période de test`,
          };
        } else if (
          result.profitPercentage < 3 ||
          result.metrics.winRate < 0.45
        ) {
          // Stratégie peu performante, suggérer l'optimisation
          recommendations[strategy.getId()] = {
            action: "optimize",
            reason: `Performance faible: Profit ${result.profitPercentage.toFixed(2)}%, Win rate ${(result.metrics.winRate * 100).toFixed(2)}%`,
            optimizationSuggestions: {
              // Suggestions basées sur l'analyse des résultats
              // Ceci est un exemple simplifié
              stopLoss:
                result.metrics.maxDrawdownPercentage > 10
                  ? Math.min(
                      Math.ceil(result.metrics.maxDrawdownPercentage / 2),
                      5,
                    )
                  : undefined,
              takeProfit:
                result.metrics.averageWin > 0
                  ? Math.ceil(
                      (result.metrics.averageWin / result.initialBalance) * 100,
                    )
                  : undefined,
            },
          };
        } else {
          // Stratégie performante, conserver
          recommendations[strategy.getId()] = {
            action: "keep",
            reason: `Bonne performance: Profit ${result.profitPercentage.toFixed(2)}%, Win rate ${(result.metrics.winRate * 100).toFixed(2)}%`,
          };
        }
      } catch (error) {
        this.logger.error(
          "Erreur lors de la validation de la stratégie " +
            strategy.getName() +
            " :",
          error as Error,
        );

        // En cas d'erreur, suggérer une vérification manuelle
        recommendations[strategy.getId()] = {
          action: "optimize",
          reason: `Erreur lors du backtest: ${(error as Error).message}`,
        };
      }
    }

    return { results, recommendations };
  }
}
