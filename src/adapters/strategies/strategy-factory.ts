/**
 * Factory pour créer des instances de stratégies de trading
 * Implémente le pattern Factory pour une création centralisée et typée des stratégies
 */

import { Strategy } from "../../domain/models/strategy.model";
import { StrategyType } from "../../shared/enums";
import { Result } from "../../shared/types";
import { result } from "../../shared/utils";
import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";

// Import des stratégies existantes
import { createRsiDivergenceStrategy } from "../primary/rsi-divergence.strategy";
import { createVolumeAnalysisStrategy } from "../primary/volume-analysis.strategy";
import { createElliottWaveStrategy } from "../primary/elliott-wave.strategy";
import { createHarmonicPatternStrategy } from "../primary/harmonic-pattern.strategy";
import { createScalpingEntryExitStrategy } from "../primary/scalping-entry-exit.strategy";
import { createCoordinatedMultiStrategy, CoordinatedMultiStrategyConfig } from "../primary/coordinated-multi-strategy.strategy";

// Types pour les configurations de stratégies
export interface RsiDivergenceConfig {
  rsiPeriod: number;
  divergenceWindow: number;
  symbol: string;
  positionSize: number;
  overboughtLevel: number;
  oversoldLevel: number;
  maxSlippagePercent?: number;
  minLiquidityRatio?: number;
  riskPerTrade?: number;
  stopLossPercent?: number;
  accountSize?: number;
  maxCapitalPerTrade?: number;
  limitOrderBuffer?: number;
  useLimitOrders?: boolean;
}

export interface VolumeAnalysisConfig {
  volumeThreshold: number;
  volumeMALength: number;
  priceMALength: number;
  symbol: string;
  positionSize: number;
  volumeSpikeFactor: number;
  priceSensitivity: number;
  maxSlippagePercent?: number;
  minLiquidityRatio?: number;
  riskPerTrade?: number;
  stopLossPercent?: number;
  accountSize?: number;
  maxCapitalPerTrade?: number;
  limitOrderBuffer?: number;
  useLimitOrders?: boolean;
}

export interface ElliottWaveConfig {
  waveDetectionLength: number;
  priceSensitivity: number;
  symbol: string;
  positionSize: number;
  zerolineBufferPercent: number;
  maxSlippagePercent?: number;
  minLiquidityRatio?: number;
  riskPerTrade?: number;
  stopLossPercent?: number;
  accountSize?: number;
  maxCapitalPerTrade?: number;
  limitOrderBuffer?: number;
  useLimitOrders?: boolean;
}

export interface HarmonicPatternConfig {
  detectionLength: number;
  fibRetracementTolerance: number;
  symbol: string;
  positionSize: number;
  patternConfirmationPercentage: number;
  maxSlippagePercent?: number;
  minLiquidityRatio?: number;
  riskPerTrade?: number;
  stopLossPercent?: number;
  accountSize?: number;
  maxCapitalPerTrade?: number;
  limitOrderBuffer?: number;
  useLimitOrders?: boolean;
}

export interface ScalpingEntryExitConfig {
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  rsiPeriod: number;
  momentumPeriod: number;
  symbol: string;
  positionSize: number;
  maxHoldingPeriod: number; // En nombre de candles
  profitTargetPercent: number;
  stopLossPercent: number;
  rsiOverboughtLevel: number;
  rsiOversoldLevel: number;
  momentumThreshold: number;
  priceDeviationThreshold: number;
  maxSlippagePercent?: number;
  minLiquidityRatio?: number;
  riskPerTrade?: number;
  accountSize?: number;
  maxCapitalPerTrade?: number;
  limitOrderBuffer?: number;
  useLimitOrders?: boolean;
}

// Union type pour toutes les configurations possibles
export type StrategyConfigMap = {
  [StrategyType.RSI_DIVERGENCE]: RsiDivergenceConfig;
  [StrategyType.VOLUME_ANALYSIS]: VolumeAnalysisConfig;
  [StrategyType.ELLIOTT_WAVE]: ElliottWaveConfig;
  [StrategyType.HARMONIC_PATTERN]: HarmonicPatternConfig;
  [StrategyType.SCALPING_ENTRY_EXIT]: ScalpingEntryExitConfig;
  [StrategyType.COORDINATED_MULTI_STRATEGY]: CoordinatedMultiStrategyConfig;
};

/**
 * Factory pour créer des stratégies de trading
 */
export class StrategyFactory {
  private readonly logger = createContextualLogger('StrategyFactory');

  /**
   * Crée une stratégie basée sur son type et sa configuration
   */
  public async createStrategy<T extends StrategyType>(
    type: T,
    config: StrategyConfigMap[T]
  ): Promise<Strategy> {
    try {
      this.logger.info(`Création de la stratégie: ${type}`, { 
        symbol: config.symbol,
        positionSize: config.positionSize 
      });

      // Validation de base de la configuration
      const validationResult = this.validateConfig(type, config);
      if (!validationResult.success) {
        throw new Error(`Configuration invalide pour ${type}: ${validationResult.message || 'Erreur de validation'}`);
      }

      // Créer la stratégie selon son type
      let strategy: Strategy;

      switch (type) {
        case StrategyType.RSI_DIVERGENCE:
          strategy = createRsiDivergenceStrategy(config as RsiDivergenceConfig);
          break;

        case StrategyType.VOLUME_ANALYSIS:
          strategy = createVolumeAnalysisStrategy(config as VolumeAnalysisConfig);
          break;

        case StrategyType.ELLIOTT_WAVE:
          strategy = createElliottWaveStrategy(config as ElliottWaveConfig);
          break;

        case StrategyType.HARMONIC_PATTERN:
          strategy = createHarmonicPatternStrategy(config as HarmonicPatternConfig);
          break;

        case StrategyType.SCALPING_ENTRY_EXIT:
          strategy = createScalpingEntryExitStrategy(config as ScalpingEntryExitConfig);
          break;

        case StrategyType.COORDINATED_MULTI_STRATEGY:
          strategy = createCoordinatedMultiStrategy(config as CoordinatedMultiStrategyConfig);
          break;

        default:
          throw new Error(`Type de stratégie non supporté: ${type}`);
      }

      this.logger.info(`Stratégie créée avec succès: ${strategy.getName()}`, {
        id: strategy.getId(),
        type
      });

      return strategy;

    } catch (error) {
      this.logger.error(`Erreur lors de la création de la stratégie ${type}`, error as Error);
      throw error;
    }
  }

  /**
   * Obtient la liste des types de stratégies supportés
   */
  public getSupportedStrategyTypes(): StrategyType[] {
    return [
      StrategyType.RSI_DIVERGENCE,
      StrategyType.VOLUME_ANALYSIS,
      StrategyType.ELLIOTT_WAVE,
      StrategyType.HARMONIC_PATTERN,
      StrategyType.SCALPING_ENTRY_EXIT,
      StrategyType.COORDINATED_MULTI_STRATEGY,
    ];
  }

  /**
   * Valide la configuration d'une stratégie
   */
  private validateConfig<T extends StrategyType>(
    type: T,
    config: StrategyConfigMap[T]
  ): Result<void> {
    try {
      // Validation de base commune à toutes les stratégies
      if (!config.symbol || typeof config.symbol !== 'string') {
        return result.error(new Error("Symbol requis et doit être une chaîne de caractères"));
      }
      if (typeof config.positionSize !== 'number' || config.positionSize <= 0) {
        return result.error(new Error("Position size requis et doit être un nombre positif"));
      }

      // Validation spécifique à chaque stratégie
      switch (type) {
        case StrategyType.RSI_DIVERGENCE:
          const rsiConfig = config as RsiDivergenceConfig;
          if (typeof rsiConfig.rsiPeriod !== 'number' || rsiConfig.rsiPeriod < 2) {
            return result.error(new Error("RSI period doit être un nombre >= 2"));
          }
          if (typeof rsiConfig.divergenceWindow !== 'number' || rsiConfig.divergenceWindow <= 0) {
            return result.error(new Error("Divergence window doit être un nombre positif"));
          }
          if (typeof rsiConfig.overboughtLevel !== 'number' || rsiConfig.overboughtLevel < 0 || rsiConfig.overboughtLevel > 100) {
            return result.error(new Error("Overbought level doit être un nombre entre 0 et 100"));
          }
          if (typeof rsiConfig.oversoldLevel !== 'number' || rsiConfig.oversoldLevel < 0 || rsiConfig.oversoldLevel > 100) {
            return result.error(new Error("Oversold level doit être un nombre entre 0 et 100"));
          }
          if (rsiConfig.oversoldLevel >= rsiConfig.overboughtLevel) {
            return result.error(new Error("Oversold level doit être inférieur à Overbought level"));
          }
          break;

        case StrategyType.VOLUME_ANALYSIS:
          const volumeConfig = config as VolumeAnalysisConfig;
          if (typeof volumeConfig.volumeThreshold !== 'number' || volumeConfig.volumeThreshold <= 0) {
            return result.error(new Error("Volume threshold doit être un nombre positif"));
          }
          if (typeof volumeConfig.volumeMALength !== 'number' || volumeConfig.volumeMALength <= 0) {
            return result.error(new Error("Volume MA length doit être un nombre positif"));
          }
          if (typeof volumeConfig.priceMALength !== 'number' || volumeConfig.priceMALength <= 0) {
            return result.error(new Error("Price MA length doit être un nombre positif"));
          }
          break;

        case StrategyType.ELLIOTT_WAVE:
          const elliottConfig = config as ElliottWaveConfig;
          if (typeof elliottConfig.waveDetectionLength !== 'number' || elliottConfig.waveDetectionLength <= 0) {
            return result.error(new Error("Wave detection length doit être un nombre positif"));
          }
          if (typeof elliottConfig.priceSensitivity !== 'number' || elliottConfig.priceSensitivity <= 0) {
            return result.error(new Error("Price sensitivity doit être un nombre positif"));
          }
          break;

        case StrategyType.HARMONIC_PATTERN:
          const harmonicConfig = config as HarmonicPatternConfig;
          if (typeof harmonicConfig.detectionLength !== 'number' || harmonicConfig.detectionLength <= 0) {
            return result.error(new Error("Detection length doit être un nombre positif"));
          }
          if (typeof harmonicConfig.fibRetracementTolerance !== 'number' || harmonicConfig.fibRetracementTolerance <= 0 || harmonicConfig.fibRetracementTolerance > 0.1) {
            return result.error(new Error("Fib retracement tolerance doit être un nombre entre 0 et 0.1"));
          }
          break;

        case StrategyType.SCALPING_ENTRY_EXIT:
          const scalpingConfig = config as ScalpingEntryExitConfig;
          if (typeof scalpingConfig.fastEmaPeriod !== 'number' || scalpingConfig.fastEmaPeriod <= 0) {
            return result.error(new Error("Fast EMA period doit être un nombre positif"));
          }
          if (typeof scalpingConfig.slowEmaPeriod !== 'number' || scalpingConfig.slowEmaPeriod <= 0) {
            return result.error(new Error("Slow EMA period doit être un nombre positif"));
          }
          if (scalpingConfig.fastEmaPeriod >= scalpingConfig.slowEmaPeriod) {
            return result.error(new Error("Fast EMA period doit être inférieur à Slow EMA period"));
          }
          if (typeof scalpingConfig.rsiPeriod !== 'number' || scalpingConfig.rsiPeriod < 2) {
            return result.error(new Error("RSI period doit être un nombre >= 2"));
          }
          if (typeof scalpingConfig.rsiOverboughtLevel !== 'number' || scalpingConfig.rsiOverboughtLevel < 0 || scalpingConfig.rsiOverboughtLevel > 100) {
            return result.error(new Error("RSI overbought level doit être un nombre entre 0 et 100"));
          }
          if (typeof scalpingConfig.rsiOversoldLevel !== 'number' || scalpingConfig.rsiOversoldLevel < 0 || scalpingConfig.rsiOversoldLevel > 100) {
            return result.error(new Error("RSI oversold level doit être un nombre entre 0 et 100"));
          }
          if (scalpingConfig.rsiOversoldLevel >= scalpingConfig.rsiOverboughtLevel) {
            return result.error(new Error("RSI oversold level doit être inférieur à RSI overbought level"));
          }
          break;

        case StrategyType.COORDINATED_MULTI_STRATEGY:
          const coordinatedConfig = config as CoordinatedMultiStrategyConfig;
          
          // Validate Elliott Wave settings
          if (typeof coordinatedConfig.waveDetectionLength !== 'number' || coordinatedConfig.waveDetectionLength <= 0) {
            return result.error(new Error("Wave detection length doit être un nombre positif"));
          }
          if (typeof coordinatedConfig.priceSensitivity !== 'number' || coordinatedConfig.priceSensitivity <= 0) {
            return result.error(new Error("Price sensitivity doit être un nombre positif"));
          }
          
          // Validate Harmonic Pattern settings
          if (typeof coordinatedConfig.detectionLength !== 'number' || coordinatedConfig.detectionLength <= 0) {
            return result.error(new Error("Detection length doit être un nombre positif"));
          }
          if (typeof coordinatedConfig.fibRetracementTolerance !== 'number' || coordinatedConfig.fibRetracementTolerance <= 0 || coordinatedConfig.fibRetracementTolerance > 0.1) {
            return result.error(new Error("Fib retracement tolerance doit être un nombre entre 0 et 0.1"));
          }
          if (typeof coordinatedConfig.patternConfirmationPercentage !== 'number' || coordinatedConfig.patternConfirmationPercentage < 0 || coordinatedConfig.patternConfirmationPercentage > 100) {
            return result.error(new Error("Pattern confirmation percentage doit être un nombre entre 0 et 100"));
          }
          
          // Validate Volume Analysis settings
          if (typeof coordinatedConfig.volumeThreshold !== 'number' || coordinatedConfig.volumeThreshold <= 0) {
            return result.error(new Error("Volume threshold doit être un nombre positif"));
          }
          if (typeof coordinatedConfig.volumeMALength !== 'number' || coordinatedConfig.volumeMALength <= 0) {
            return result.error(new Error("Volume MA length doit être un nombre positif"));
          }
          if (typeof coordinatedConfig.priceMALength !== 'number' || coordinatedConfig.priceMALength <= 0) {
            return result.error(new Error("Price MA length doit être un nombre positif"));
          }
          if (typeof coordinatedConfig.volumeSpikeFactor !== 'number' || coordinatedConfig.volumeSpikeFactor <= 1) {
            return result.error(new Error("Volume spike factor doit être un nombre > 1"));
          }
          
          // Validate Scalping settings
          if (typeof coordinatedConfig.fastEmaPeriod !== 'number' || coordinatedConfig.fastEmaPeriod <= 0) {
            return result.error(new Error("Fast EMA period doit être un nombre positif"));
          }
          if (typeof coordinatedConfig.slowEmaPeriod !== 'number' || coordinatedConfig.slowEmaPeriod <= 0) {
            return result.error(new Error("Slow EMA period doit être un nombre positif"));
          }
          if (coordinatedConfig.fastEmaPeriod >= coordinatedConfig.slowEmaPeriod) {
            return result.error(new Error("Fast EMA period doit être inférieur à Slow EMA period"));
          }
          if (typeof coordinatedConfig.rsiPeriod !== 'number' || coordinatedConfig.rsiPeriod < 2) {
            return result.error(new Error("RSI period doit être un nombre >= 2"));
          }
          
          // Validate confidence thresholds
          if (typeof coordinatedConfig.trendConfidenceThreshold !== 'number' || coordinatedConfig.trendConfidenceThreshold < 0 || coordinatedConfig.trendConfidenceThreshold > 1) {
            return result.error(new Error("Trend confidence threshold doit être un nombre entre 0 et 1"));
          }
          if (typeof coordinatedConfig.patternConfidenceThreshold !== 'number' || coordinatedConfig.patternConfidenceThreshold < 0 || coordinatedConfig.patternConfidenceThreshold > 1) {
            return result.error(new Error("Pattern confidence threshold doit être un nombre entre 0 et 1"));
          }
          if (typeof coordinatedConfig.volumeConfidenceThreshold !== 'number' || coordinatedConfig.volumeConfidenceThreshold < 0 || coordinatedConfig.volumeConfidenceThreshold > 1) {
            return result.error(new Error("Volume confidence threshold doit être un nombre entre 0 et 1"));
          }
          if (typeof coordinatedConfig.overallConfidenceThreshold !== 'number' || coordinatedConfig.overallConfidenceThreshold < 0 || coordinatedConfig.overallConfidenceThreshold > 1) {
            return result.error(new Error("Overall confidence threshold doit être un nombre entre 0 et 1"));
          }
          break;
      }

      return result.success(undefined);
    } catch (error) {
      this.logger.error("Erreur inattendue lors de la validation de la configuration", error as Error, { type, config });
      return result.error(new Error(`Erreur inattendue de validation pour ${type}: ${(error as Error).message}`));
    }
  }

  /**
   * Obtient la configuration par défaut pour un type de stratégie
   */
  public getDefaultConfig<T extends StrategyType>(
    type: T,
    symbol: string,
    positionSize: number
  ): Result<StrategyConfigMap[T]> {
    try {
      let defaultConfig: any;

      switch (type) {
        case StrategyType.RSI_DIVERGENCE:
          defaultConfig = {
            rsiPeriod: 14,
            divergenceWindow: 20,
            symbol,
            positionSize,
            overboughtLevel: 70,
            oversoldLevel: 30,
            maxSlippagePercent: 1.0,
            minLiquidityRatio: 10.0,
            riskPerTrade: 0.01,
            stopLossPercent: 0.02,
            maxCapitalPerTrade: 0.25,
            limitOrderBuffer: 0.0005,
            useLimitOrders: false
          };
          break;

        case StrategyType.VOLUME_ANALYSIS:
          defaultConfig = {
            volumeThreshold: 1.5,
            volumeMALength: 20,
            priceMALength: 10,
            symbol,
            positionSize,
            volumeSpikeFactor: 2.0,
            priceSensitivity: 0.005,
            maxSlippagePercent: 1.0,
            minLiquidityRatio: 10.0,
            riskPerTrade: 0.01,
            stopLossPercent: 0.02,
            maxCapitalPerTrade: 0.25,
            limitOrderBuffer: 0.0005,
            useLimitOrders: false
          };
          break;

        case StrategyType.ELLIOTT_WAVE:
          defaultConfig = {
            waveDetectionLength: 100,
            priceSensitivity: 0.01,
            symbol,
            positionSize,
            zerolineBufferPercent: 0.1,
            maxSlippagePercent: 1.0,
            minLiquidityRatio: 10.0,
            riskPerTrade: 0.01,
            stopLossPercent: 0.02,
            maxCapitalPerTrade: 0.25,
            limitOrderBuffer: 0.0005,
            useLimitOrders: false
          };
          break;

        case StrategyType.HARMONIC_PATTERN:
          defaultConfig = {
            detectionLength: 200,
            fibRetracementTolerance: 0.02,
            symbol,
            positionSize,
            patternConfirmationPercentage: 80,
            maxSlippagePercent: 1.0,
            minLiquidityRatio: 10.0,
            riskPerTrade: 0.01,
            stopLossPercent: 0.02,
            maxCapitalPerTrade: 0.25,
            limitOrderBuffer: 0.0005,
            useLimitOrders: false
          };
          break;

        case StrategyType.SCALPING_ENTRY_EXIT:
          defaultConfig = {
            fastEmaPeriod: 9,
            slowEmaPeriod: 21,
            rsiPeriod: 14,
            momentumPeriod: 10,
            symbol,
            positionSize,
            maxHoldingPeriod: 30, // 30 candles max
            profitTargetPercent: 0.005, // 0.5%
            stopLossPercent: 0.003, // 0.3%
            rsiOverboughtLevel: 70,
            rsiOversoldLevel: 30,
            momentumThreshold: 0.002, // 0.2%
            priceDeviationThreshold: 0.001, // 0.1%
            maxSlippagePercent: 1.0,
            minLiquidityRatio: 10.0,
            riskPerTrade: 0.01,
            accountSize: 10000,
            maxCapitalPerTrade: 0.1,
            limitOrderBuffer: 0.0005,
            useLimitOrders: false
          };
          break;

        case StrategyType.COORDINATED_MULTI_STRATEGY:
          defaultConfig = {
            symbol,
            positionSize,
            
            // Elliott Wave settings
            waveDetectionLength: 100,
            priceSensitivity: 0.01,
            
            // Harmonic Pattern settings
            detectionLength: 200,
            fibRetracementTolerance: 0.02,
            patternConfirmationPercentage: 80,
            
            // Volume Analysis settings
            volumeThreshold: 1.5,
            volumeMALength: 20,
            priceMALength: 10,
            volumeSpikeFactor: 2.0,
            
            // Scalping settings
            fastEmaPeriod: 20,
            slowEmaPeriod: 50,
            rsiPeriod: 7,
            momentumPeriod: 10,
            maxHoldingPeriod: 15,
            profitTargetPercent: 0.003,
            stopLossPercent: 0.002,
            rsiOverboughtLevel: 70,
            rsiOversoldLevel: 30,
            momentumThreshold: 0.002,
            priceDeviationThreshold: 0.001,
            
            // Coordination settings
            trendConfidenceThreshold: 0.6,
            patternConfidenceThreshold: 0.5,
            volumeConfidenceThreshold: 0.4,
            overallConfidenceThreshold: 0.7,
            
            // Trading settings
            maxSlippagePercent: 1.0,
            minLiquidityRatio: 10.0,
            riskPerTrade: 0.01,
            accountSize: 10000,
            maxCapitalPerTrade: 0.1,
            limitOrderBuffer: 0.0005,
            useLimitOrders: false
          };
          break;

        default:
          return result.error(new Error(`Configuration par défaut non disponible pour ${type}`));
      }

      return result.success(defaultConfig as StrategyConfigMap[T]);

    } catch (error) {
      return result.error(error as Error, `Erreur lors de la création de la configuration par défaut pour ${type}`);
    }
  }

  /**
   * Crée plusieurs stratégies en lot
   */
  public async createStrategies(
    strategies: Array<{ type: StrategyType; config: any }>
  ): Promise<Result<Strategy[]>> {
    try {
      const createdStrategies: Strategy[] = [];
      const errors: string[] = [];

      for (const strategySpec of strategies) {
        try {
          const strategy = await this.createStrategy(strategySpec.type, strategySpec.config);
          createdStrategies.push(strategy);
        } catch (error) {
          const errorMsg = `Erreur création ${strategySpec.type}: ${(error as Error).message}`;
          errors.push(errorMsg);
          this.logger.error(errorMsg, error as Error);
        }
      }

      if (errors.length > 0 && createdStrategies.length === 0) {
        return result.error(
          new Error(`Aucune stratégie créée. Erreurs: ${errors.join(', ')}`),
          "Échec complet de création des stratégies"
        );
      }

      if (errors.length > 0) {
        this.logger.warn(`Création partielle: ${createdStrategies.length} créées, ${errors.length} erreurs`);
      }

      return result.success(createdStrategies, `${createdStrategies.length} stratégies créées avec succès`);

    } catch (error) {
      return result.error(error as Error, "Erreur lors de la création des stratégies en lot");
    }
  }
}
