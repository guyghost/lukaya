/**
 * Coordinated Multi-Strategy Workflow
 *
 * Implements a systematic approach combining:
 * 1. Elliott Wave trend identification
 * 2. Harmonic pattern formation at key levels
 * 3. Volume confirmation with surge detection
 * 4. Scalping indicators (EMA, RSI) for precise entry and exit
 *
 * Strategy Flow: Elliott Wave → Harmonic Pattern → Volume → Scalping
 */

import { Strategy, StrategySignal } from "../../domain/models/strategy.model";
import {
  MarketData,
  OrderParams,
  OrderSide,
  OrderType,
  TimeInForce,
} from "../../domain/models/market.model";
import { MarketDataPort } from "../../application/ports/market-data.port";
import { createContextualLogger } from "../../infrastructure/logging/enhanced-logger";
import { SMA, EMA, RSI, MACD, BollingerBands } from "technicalindicators";

export interface CoordinatedMultiStrategyConfig {
  symbol: string;
  positionSize: number;

  // Elliott Wave settings
  waveDetectionLength: number;
  priceSensitivity: number;

  // Harmonic Pattern settings
  detectionLength: number;
  fibRetracementTolerance: number;
  patternConfirmationPercentage: number;

  // Volume Analysis settings
  volumeThreshold: number;
  volumeMALength: number;
  priceMALength: number;
  volumeSpikeFactor: number;

  // Scalping settings
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  rsiPeriod: number;
  momentumPeriod: number;
  maxHoldingPeriod: number;
  profitTargetPercent: number;
  stopLossPercent: number;
  rsiOverboughtLevel: number;
  rsiOversoldLevel: number;
  momentumThreshold: number;
  priceDeviationThreshold: number;

  // Coordination settings
  trendConfidenceThreshold: number;
  patternConfidenceThreshold: number;
  volumeConfidenceThreshold: number;
  overallConfidenceThreshold: number;
  maxSlippagePercent?: number;
  minLiquidityRatio?: number;
  riskPerTrade?: number;
  accountSize?: number;
  maxCapitalPerTrade?: number;
  limitOrderBuffer?: number;
  useLimitOrders?: boolean;
}

interface StrategyStepResult {
  confidence: number;
  signal?: "long" | "short" | "exit";
  strength: number;
  metadata?: Record<string, any>;
}

interface CoordinatedAnalysis {
  elliottWave: StrategyStepResult;
  harmonicPattern: StrategyStepResult;
  volumeAnalysis: StrategyStepResult;
  scalpingSignals: StrategyStepResult;
  overallConfidence: number;
  recommendedAction:
    | "entry_long"
    | "entry_short"
    | "exit_long"
    | "exit_short"
    | "hold"
    | "wait";
}

export const createCoordinatedMultiStrategy = (
  config: CoordinatedMultiStrategyConfig,
  marketDataPort?: MarketDataPort,
): Strategy => {
  const logger = createContextualLogger("CoordinatedMultiStrategy");

  // Data storage for historical analysis
  let marketDataHistory: MarketData[] = [];
  let currentPosition: "long" | "short" | "none" = "none";
  let entryTime: number | null = null;
  let entryPrice: number | null = null;

  /**
   * Helper function to calculate momentum
   */
  const calculateMomentum = (values: number[], period: number): number => {
    if (values.length < period + 1) return 0;
    const currentValue = values[values.length - 1];
    const pastValue = values[values.length - 1 - period];
    return (currentValue - pastValue) / pastValue;
  };

  /**
   * Helper function to calculate SMA
   */
  const calculateSMA = (values: number[], period: number): number[] => {
    if (values.length < period) return [];
    return SMA.calculate({ period, values });
  };

  /**
   * Helper function to calculate EMA
   */
  const calculateEMA = (values: number[], period: number): number[] => {
    if (values.length < period) return [];
    return EMA.calculate({ period, values });
  };

  /**
   * Helper function to calculate RSI
   */
  const calculateRSI = (values: number[], period: number): number[] => {
    if (values.length < period + 1) return [];
    return RSI.calculate({ period, values });
  };

  /**
   * Enhanced technical indicators for better signal quality
   */
  const calculateMACD = (
    values: number[],
  ): { macd: number; signal: number; histogram: number } | null => {
    if (values.length < 26) return null;
    const macdResult = MACD.calculate({
      values,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    if (macdResult.length === 0) return null;
    const latest = macdResult[macdResult.length - 1];
    return {
      macd: latest.MACD || 0,
      signal: latest.signal || 0,
      histogram: latest.histogram || 0,
    };
  };

  const calculateBollingerBands = (
    values: number[],
    period: number = 20,
    stdDev: number = 2,
  ): { upper: number; middle: number; lower: number } | null => {
    if (values.length < period) return null;
    const bbResult = BollingerBands.calculate({
      period,
      values,
      stdDev,
    });

    if (bbResult.length === 0) return null;
    return bbResult[bbResult.length - 1];
  };

  /**
   * Step 1: Elliott Wave Trend Identification
   * Analyzes the broader trend using Elliott Wave principles
   */
  const analyzeElliottWave = (data: MarketData[]): StrategyStepResult => {
    logger.debug(
      `📈 Elliott Wave: Starting analysis with ${data.length} data points`,
    );

    // Réduire les exigences minimales de données
    const minDataPoints = Math.max(50, config.waveDetectionLength * 0.6);
    if (data.length < minDataPoints) {
      logger.debug(
        `📈 Elliott Wave: Insufficient data (${data.length} < ${minDataPoints})`,
      );
      return { confidence: 0, strength: 0 };
    }

    const recentData = data.slice(-config.waveDetectionLength);
    const prices = recentData.map((d) => d.price);
    const volumes = recentData.map((d) => d.volume);

    logger.debug(
      `📈 Elliott Wave: Analyzing ${config.waveDetectionLength} recent data points`,
    );
    logger.debug(
      `📈 Elliott Wave: Price range: ${Math.min(...prices).toFixed(4)} - ${Math.max(...prices).toFixed(4)}`,
    );

    // Calculate price momentum and wave structure
    const shortTermMomentum = calculateMomentum(prices, 5);
    const mediumTermMomentum = calculateMomentum(prices, 10);
    const longTermMomentum = calculateMomentum(prices, 20);

    logger.debug(`📈 Elliott Wave: Momentum analysis:`);
    logger.debug(`   Short-term (5): ${(shortTermMomentum * 100).toFixed(3)}%`);
    logger.debug(
      `   Medium-term (10): ${(mediumTermMomentum * 100).toFixed(3)}%`,
    );
    logger.debug(`   Long-term (20): ${(longTermMomentum * 100).toFixed(3)}%`);

    // Identify potential wave patterns
    const highsAndLows = identifyHighsAndLows(prices);
    const waveCount = highsAndLows.length;

    logger.debug(`📈 Elliott Wave: Identified ${waveCount} highs and lows`);
    if (waveCount > 0) {
      logger.debug(
        `📈 Elliott Wave: Recent pivot points: ${highsAndLows
          .slice(-3)
          .map((p) => `${p.type}@${p.price.toFixed(4)}`)
          .join(", ")}`,
      );
    }

    // Calculate trend strength based on momentum alignment
    let trendStrength = 0;
    let trendDirection: "long" | "short" | undefined;

    if (
      shortTermMomentum > 0 &&
      mediumTermMomentum > 0 &&
      longTermMomentum > 0
    ) {
      trendDirection = "long";
      trendStrength = Math.min(
        1,
        (shortTermMomentum + mediumTermMomentum + longTermMomentum) / 3,
      );
      logger.debug(
        `📈 Elliott Wave: BULLISH trend detected - all momentum positive`,
      );
    } else if (
      shortTermMomentum < 0 &&
      mediumTermMomentum < 0 &&
      longTermMomentum < 0
    ) {
      trendDirection = "short";
      trendStrength = Math.min(
        1,
        Math.abs(shortTermMomentum + mediumTermMomentum + longTermMomentum) / 3,
      );
      logger.debug(
        `📈 Elliott Wave: BEARISH trend detected - all momentum negative`,
      );
    } else {
      logger.debug(`📈 Elliott Wave: MIXED signals - no clear trend direction`);
    }

    // Calculate confidence based on wave structure and momentum alignment - Système plus tolérant
    let confidence = 0;
    if (waveCount >= 1 && trendDirection) {
      // Confiance basée sur la force de la tendance même avec peu de vagues
      confidence = Math.min(
        0.8,
        trendStrength * 0.8 + (Math.min(waveCount, 5) / 5) * 0.2,
      );
      logger.debug(
        `📈 Elliott Wave: Confidence calculation: ${trendStrength.toFixed(3)} * 0.8 + ${Math.min(waveCount, 5)}/5 * 0.2 = ${confidence.toFixed(3)}`,
      );
    } else if (trendDirection) {
      // Donner une confiance minimale basée sur le momentum même sans vagues claires
      confidence = Math.min(0.4, trendStrength * 0.5);
      logger.debug(
        `📈 Elliott Wave: Minimal confidence based on trend strength: ${confidence.toFixed(3)}`,
      );
    } else {
      logger.debug(
        `📈 Elliott Wave: Low confidence due to insufficient waves (${waveCount}) or unclear trend`,
      );
      // Au lieu de 0, donner une confiance très faible
      confidence = 0.05;
    }

    logger.info(
      `📈 Elliott Wave Complete: direction=${trendDirection || "none"}, strength=${trendStrength.toFixed(3)}, confidence=${confidence.toFixed(3)}, waves=${waveCount}`,
    );

    return {
      confidence,
      signal: trendDirection,
      strength: trendStrength,
      metadata: {
        waveCount,
        shortTermMomentum,
        mediumTermMomentum,
        longTermMomentum,
        priceRange: { min: Math.min(...prices), max: Math.max(...prices) },
      },
    };
  };

  /**
   * Step 2: Harmonic Pattern Formation Analysis
   * Looks for harmonic patterns at key levels identified by Elliott Wave
   */
  const analyzeHarmonicPatterns = (
    data: MarketData[],
    elliottResult: StrategyStepResult,
  ): StrategyStepResult => {
    logger.debug(
      `🎯 Harmonic Pattern: Starting analysis with ${data.length} data points`,
    );
    logger.debug(
      `🎯 Harmonic Pattern: Elliott Wave input - confidence: ${elliottResult.confidence.toFixed(3)}, signal: ${elliottResult.signal || "none"}`,
    );

    // Réduire les exigences et permettre l'analyse indépendante
    const minDataLength = Math.max(100, config.detectionLength * 0.7);
    if (data.length < minDataLength) {
      logger.debug(
        `🎯 Harmonic Pattern: Insufficient data (${data.length} < ${minDataLength})`,
      );
      return { confidence: 0, strength: 0 };
    }

    // Permettre l'analyse même avec Elliott Wave faible, mais avec poids réduit
    const elliottBias =
      elliottResult.confidence >= config.trendConfidenceThreshold ? 1.0 : 0.5;
    if (elliottResult.confidence < config.trendConfidenceThreshold) {
      logger.debug(
        `🎯 Harmonic Pattern: Elliott Wave confidence low (${elliottResult.confidence.toFixed(3)} < ${config.trendConfidenceThreshold}), proceeding with reduced weight`,
      );
    }

    const recentData = data.slice(-config.detectionLength);
    const prices = recentData.map((d) => d.price);

    logger.debug(
      `🎯 Harmonic Pattern: Analyzing ${config.detectionLength} recent data points`,
    );
    logger.debug(
      `🎯 Harmonic Pattern: Price range: ${Math.min(...prices).toFixed(4)} - ${Math.max(...prices).toFixed(4)}`,
    );

    // Find significant highs and lows for pattern detection
    const pivots = identifyPivotPoints(prices);

    logger.debug(`🎯 Harmonic Pattern: Found ${pivots.length} pivot points`);

    if (pivots.length < 4) {
      logger.debug(
        `🎯 Harmonic Pattern: Insufficient pivot points (${pivots.length} < 4) for pattern formation`,
      );
      return { confidence: 0, strength: 0 };
    }

    logger.debug(
      `🎯 Harmonic Pattern: Recent pivots: ${pivots
        .slice(-4)
        .map((p) => `${p.price.toFixed(4)}@${p.index}`)
        .join(", ")}`,
    );

    // Check for common harmonic patterns (Gartley, Butterfly, Bat, Crab)
    const patterns = detectHarmonicPatterns(pivots);
    let bestPattern = null;
    let maxScore = 0;

    logger.debug(
      `🎯 Harmonic Pattern: Detected ${patterns.length} potential patterns`,
    );

    for (const pattern of patterns) {
      logger.debug(
        `🎯 Harmonic Pattern: ${pattern.type} - direction: ${pattern.direction}, score: ${pattern.score.toFixed(3)}`,
      );
      if (pattern.score > maxScore) {
        maxScore = pattern.score;
        bestPattern = pattern;
      }
    }

    // Seuil de confirmation plus tolérant
    const adjustedConfirmationThreshold =
      (config.patternConfirmationPercentage / 100) * 0.8;

    if (!bestPattern || maxScore < adjustedConfirmationThreshold) {
      logger.debug(
        `🎯 Harmonic Pattern: No strong pattern found. Best score: ${maxScore.toFixed(3)}, required: ${adjustedConfirmationThreshold.toFixed(3)}`,
      );

      // Au lieu de retourner 0, donner une confiance minimale basée sur Elliott Wave
      const fallbackConfidence = Math.min(
        0.15,
        elliottResult.confidence * 0.3 * elliottBias,
      );
      return {
        confidence: fallbackConfidence,
        strength: 0,
        signal: elliottResult.signal,
        metadata: { fallbackMode: true, elliottBias },
      };
    }

    logger.debug(
      `🎯 Harmonic Pattern: Best pattern selected: ${bestPattern.type} with score ${maxScore.toFixed(3)}`,
    );

    // Verify pattern aligns with Elliott Wave trend
    const alignmentBonus =
      elliottResult.signal === bestPattern.direction ? 0.2 : -0.1;
    const adjustedScore = Math.max(0, maxScore + alignmentBonus);

    logger.debug(`🎯 Harmonic Pattern: Alignment check:`);
    logger.debug(
      `   Elliott signal: ${elliottResult.signal}, Pattern direction: ${bestPattern.direction}`,
    );
    logger.debug(
      `   Alignment bonus: ${alignmentBonus > 0 ? "+" : ""}${alignmentBonus}`,
    );
    logger.debug(
      `   Adjusted score: ${maxScore.toFixed(3)} + ${alignmentBonus} = ${adjustedScore.toFixed(3)}`,
    );

    logger.info(
      `🎯 Harmonic Pattern Complete: pattern=${bestPattern.type}, direction=${bestPattern.direction}, score=${adjustedScore.toFixed(3)}, alignment=${alignmentBonus > 0 ? "good" : "poor"}`,
    );

    return {
      confidence: adjustedScore,
      signal: bestPattern.direction,
      strength: maxScore,
      metadata: {
        patternType: bestPattern.type,
        patternPoints: bestPattern.points,
        fibRetracementLevels: bestPattern.fibLevels,
        alignmentBonus,
        originalScore: maxScore,
        totalPatternsFound: patterns.length,
      },
    };
  };

  /**
   * Step 3: Volume Confirmation Analysis
   * Validates the move with volume surge detection
   * Can operate independently if Elliott Wave shows directional bias
   */
  const analyzeVolumeConfirmation = (
    data: MarketData[],
    patternResult: StrategyStepResult,
    elliottResult: StrategyStepResult,
  ): StrategyStepResult => {
    logger.debug(
      `📊 Volume Analysis: Starting analysis with ${data.length} data points`,
    );
    logger.debug(
      `📊 Volume Analysis: Pattern input - confidence: ${patternResult.confidence.toFixed(3)}, signal: ${patternResult.signal || "none"}`,
    );
    logger.debug(
      `📊 Volume Analysis: Elliott input - confidence: ${elliottResult.confidence.toFixed(3)}, signal: ${elliottResult.signal || "none"}`,
    );

    // Check if we have sufficient data
    if (data.length < config.volumeMALength * 2) {
      logger.debug(
        `📊 Volume Analysis: Insufficient data (${data.length} < ${config.volumeMALength * 2})`,
      );
      return { confidence: 0, strength: 0 };
    }

    // Check if we can proceed with volume analysis - Critères plus souples
    const hasPatternConfirmation =
      patternResult.confidence >= config.patternConfidenceThreshold;
    const hasElliottBias =
      elliottResult.confidence >= config.trendConfidenceThreshold * 0.5 &&
      elliottResult.signal; // Seuil réduit de 50%
    const hasMinimalSignal =
      patternResult.confidence > 0.05 || elliottResult.confidence > 0.05;
    const canAnalyze =
      hasPatternConfirmation || hasElliottBias || hasMinimalSignal;

    if (!canAnalyze) {
      logger.debug(`📊 Volume Analysis: No signals available for analysis`);
      return { confidence: 0.05, strength: 0 }; // Confiance minimale au lieu de 0
    }

    // Use the best available signal (prefer pattern, fallback to Elliott)
    const referenceSignal = hasPatternConfirmation
      ? patternResult.signal
      : elliottResult.signal;
    logger.debug(
      `📊 Volume Analysis: Using ${hasPatternConfirmation ? "pattern" : "Elliott"} signal: ${referenceSignal}`,
    );

    if (!referenceSignal) {
      logger.debug(`📊 Volume Analysis: No directional signal available`);
      return { confidence: 0, strength: 0 };
    }

    const recentData = data.slice(-config.volumeMALength * 2);
    const volumes = recentData.map((d) => d.volume);
    const prices = recentData.map((d) => d.price);

    logger.debug(
      `📊 Volume Analysis: Analyzing ${config.volumeMALength * 2} recent data points`,
    );

    // Calculate volume moving average
    const volumeMA = calculateSMA(volumes, config.volumeMALength);
    const currentVolume = volumes[volumes.length - 1];
    const avgVolume = volumeMA[volumeMA.length - 1];

    // Calculate price movement
    const priceMA = calculateSMA(prices, config.priceMALength);
    const currentPrice = prices[prices.length - 1];
    const avgPrice = priceMA[priceMA.length - 1];

    logger.debug(`📊 Volume Analysis: Volume metrics:`);
    logger.debug(`   Current volume: ${currentVolume.toFixed(0)}`);
    logger.debug(
      `   Average volume (${config.volumeMALength}): ${avgVolume.toFixed(0)}`,
    );
    logger.debug(`   Volume ratio: ${(currentVolume / avgVolume).toFixed(2)}x`);

    logger.debug(`📊 Volume Analysis: Price metrics:`);
    logger.debug(`   Current price: ${currentPrice.toFixed(4)}`);
    logger.debug(
      `   Average price (${config.priceMALength}): ${avgPrice.toFixed(4)}`,
    );
    logger.debug(
      `   Price change: ${(((currentPrice - avgPrice) / avgPrice) * 100).toFixed(3)}%`,
    );

    // Volume surge detection
    const volumeRatio = currentVolume / avgVolume;
    const volumeSurge = volumeRatio > config.volumeSpikeFactor;

    logger.debug(`📊 Volume Analysis: Volume surge check:`);
    logger.debug(
      `   Ratio: ${volumeRatio.toFixed(2)}, Threshold: ${config.volumeSpikeFactor}`,
    );
    logger.debug(`   Volume surge: ${volumeSurge ? "✅ YES" : "❌ NO"}`);

    // Price-volume correlation
    const priceChange = (currentPrice - avgPrice) / avgPrice;
    const priceVolumeAlignment = Math.abs(priceChange) * volumeRatio;

    logger.debug(
      `📊 Volume Analysis: Price-volume alignment: ${priceVolumeAlignment.toFixed(4)}`,
    );

    // Check for volume confirmation of reference signal direction
    let volumeConfirmation = 0;
    if (volumeSurge && referenceSignal) {
      const priceMovementDirection = priceChange > 0 ? "long" : "short";
      logger.debug(`📊 Volume Analysis: Direction alignment check:`);
      logger.debug(`   Price movement direction: ${priceMovementDirection}`);
      logger.debug(`   Reference signal direction: ${referenceSignal}`);

      if (priceMovementDirection === referenceSignal) {
        // Calculate base confirmation from volume and price alignment
        let baseConfirmation = Math.min(
          0.9,
          priceVolumeAlignment * 0.5 + volumeRatio * 0.3,
        );

        // Apply confidence modifier based on signal source
        if (hasPatternConfirmation) {
          // Full confidence if pattern confirms
          volumeConfirmation = baseConfirmation;
          logger.debug(
            `📊 Volume Analysis: ✅ Pattern-based directions aligned! Confirmation: ${volumeConfirmation.toFixed(3)}`,
          );
        } else {
          // Reduced but still meaningful confidence for Elliott-based analysis
          volumeConfirmation = baseConfirmation * 0.7; // 70% of full confidence
          logger.debug(
            `📊 Volume Analysis: ✅ Elliott-based directions aligned! Confirmation: ${volumeConfirmation.toFixed(3)} (reduced)`,
          );
        }
      } else {
        logger.debug(
          `📊 Volume Analysis: ❌ Direction mismatch - no confirmation`,
        );
      }
    } else {
      if (!volumeSurge) {
        logger.debug(`📊 Volume Analysis: No volume surge detected`);
      }
      if (!referenceSignal) {
        logger.debug(`📊 Volume Analysis: No reference signal to confirm`);
      }
    }

    logger.info(
      `📊 Volume Analysis Complete: surge=${volumeSurge}, ratio=${volumeRatio.toFixed(2)}x, confirmation=${volumeConfirmation.toFixed(3)}, alignment=${priceVolumeAlignment.toFixed(4)}`,
    );

    return {
      confidence: volumeConfirmation,
      signal: referenceSignal, // Use reference signal instead of just pattern signal
      strength: priceVolumeAlignment,
      metadata: {
        volumeRatio,
        volumeSurge,
        priceChange,
        priceVolumeAlignment,
        currentVolume,
        avgVolume,
        currentPrice,
        avgPrice,
        spikeFactor: config.volumeSpikeFactor,
        signalSource: hasPatternConfirmation ? "pattern" : "elliott", // Track signal source
      },
    };
  };

  /**
   * Step 4: Scalping Indicators for Precise Entry/Exit
   * Uses EMA and RSI for precise timing
   */
  const analyzeScalpingSignals = (
    data: MarketData[],
    volumeResult: StrategyStepResult,
  ): StrategyStepResult => {
    logger.debug(
      `⚡ Scalping Analysis: Starting analysis with ${data.length} data points`,
    );
    logger.debug(
      `⚡ Scalping Analysis: Volume input - confidence: ${volumeResult.confidence.toFixed(3)}, signal: ${volumeResult.signal || "none"}`,
    );
    logger.debug(`⚡ Scalping Analysis: Current position: ${currentPosition}`);

    const requiredDataLength = Math.max(
      config.fastEmaPeriod,
      config.slowEmaPeriod,
      config.rsiPeriod,
    );
    if (data.length < requiredDataLength) {
      logger.debug(
        `⚡ Scalping Analysis: Insufficient data (${data.length} < ${requiredDataLength})`,
      );
      return { confidence: 0, strength: 0 };
    }

    // Permettre l'analyse scalping même avec volume faible, mais avec poids réduit
    const volumeWeight =
      volumeResult.confidence >= config.volumeConfidenceThreshold ? 1.0 : 0.6;
    if (volumeResult.confidence < config.volumeConfidenceThreshold) {
      logger.debug(
        `⚡ Scalping Analysis: Volume confidence low (${volumeResult.confidence.toFixed(3)} < ${config.volumeConfidenceThreshold}), proceeding with reduced weight`,
      );
    }

    const prices = data.map((d) => d.price);
    const closes = data.map((d) => d.price); // Assuming price is close price

    logger.debug(
      `⚡ Scalping Analysis: Price range: ${Math.min(...prices).toFixed(4)} - ${Math.max(...prices).toFixed(4)}`,
    );

    // Calculate EMA crossover
    const fastEMA = calculateEMA(prices, config.fastEmaPeriod);
    const slowEMA = calculateEMA(prices, config.slowEmaPeriod);
    const currentFastEMA = fastEMA[fastEMA.length - 1];
    const currentSlowEMA = slowEMA[slowEMA.length - 1];
    const prevFastEMA = fastEMA[fastEMA.length - 2];
    const prevSlowEMA = slowEMA[slowEMA.length - 2];

    logger.debug(`⚡ Scalping Analysis: EMA values:`);
    logger.debug(
      `   Fast EMA (${config.fastEmaPeriod}): current=${currentFastEMA.toFixed(4)}, previous=${prevFastEMA.toFixed(4)}`,
    );
    logger.debug(
      `   Slow EMA (${config.slowEmaPeriod}): current=${currentSlowEMA.toFixed(4)}, previous=${prevSlowEMA.toFixed(4)}`,
    );
    logger.debug(
      `   EMA spread: ${(((currentFastEMA - currentSlowEMA) / currentSlowEMA) * 100).toFixed(3)}%`,
    );

    // EMA crossover detection
    const bullishCrossover =
      currentFastEMA > currentSlowEMA && prevFastEMA <= prevSlowEMA;
    const bearishCrossover =
      currentFastEMA < currentSlowEMA && prevFastEMA >= prevSlowEMA;

    logger.debug(`⚡ Scalping Analysis: Crossover detection:`);
    logger.debug(
      `   Bullish crossover: ${bullishCrossover ? "✅ YES" : "❌ NO"}`,
    );
    logger.debug(
      `   Bearish crossover: ${bearishCrossover ? "✅ YES" : "❌ NO"}`,
    );

    // RSI calculation
    const rsi = calculateRSI(closes, config.rsiPeriod);
    const currentRSI = rsi[rsi.length - 1];

    logger.debug(
      `⚡ Scalping Analysis: RSI (${config.rsiPeriod}): ${currentRSI.toFixed(1)}`,
    );
    logger.debug(
      `   Overbought level: ${config.rsiOverboughtLevel}, Oversold level: ${config.rsiOversoldLevel}`,
    );
    logger.debug(
      `   RSI status: ${currentRSI > config.rsiOverboughtLevel ? "OVERBOUGHT" : currentRSI < config.rsiOversoldLevel ? "OVERSOLD" : "NEUTRAL"}`,
    );

    // Momentum calculation
    const currentMomentum = calculateMomentum(prices, config.momentumPeriod);

    logger.debug(
      `⚡ Scalping Analysis: Momentum (${config.momentumPeriod}): ${(currentMomentum * 100).toFixed(3)}%`,
    );
    logger.debug(
      `   Momentum threshold: ±${(config.momentumThreshold * 100).toFixed(3)}%`,
    );
    logger.debug(
      `   Momentum status: ${Math.abs(currentMomentum) > config.momentumThreshold ? (currentMomentum > 0 ? "STRONG POSITIVE" : "STRONG NEGATIVE") : "WEAK"}`,
    );

    // Determine scalping signal
    let scalpingSignal: "long" | "short" | "exit" | undefined;
    let signalStrength = 0;

    logger.debug(`⚡ Scalping Analysis: Signal determination logic:`);

    // Entry signals
    if (currentPosition === "none") {
      logger.debug(`   No current position - checking entry signals...`);

      // Long entry conditions - TRÈS flexible: 2 critères sur 4 suffisent maintenant
      const longConditions = {
        bullishCrossover,
        rsiNotOverbought: currentRSI < config.rsiOverboughtLevel + 10, // Marge élargie de 10 points
        positiveMomentum: currentMomentum > config.momentumThreshold * 0.5, // Seuil réduit de 50%
        volumeSignalLong: volumeResult.signal === "long",
      };

      logger.debug(`   Long entry conditions (ASSOUPLIES):`);
      logger.debug(
        `     Bullish crossover: ${longConditions.bullishCrossover ? "✅" : "❌"}`,
      );
      logger.debug(
        `     RSI not overbought: ${longConditions.rsiNotOverbought ? "✅" : "❌"} (${currentRSI.toFixed(1)} < ${config.rsiOverboughtLevel + 10})`,
      );
      logger.debug(
        `     Positive momentum: ${longConditions.positiveMomentum ? "✅" : "❌"} (${(currentMomentum * 100).toFixed(3)}% > ${(config.momentumThreshold * 0.5 * 100).toFixed(3)}%)`,
      );
      logger.debug(
        `     Volume signal long: ${longConditions.volumeSignalLong ? "✅" : "❌"}`,
      );

      // Compter les conditions remplies
      const longConditionsMet =
        Object.values(longConditions).filter(Boolean).length;
      const longRequiredConditions = 2; // RÉDUIT: 2 sur 4 suffisent maintenant

      if (longConditionsMet >= longRequiredConditions) {
        scalpingSignal = "long";
        signalStrength =
          Math.min(
            0.9,
            (1 - currentRSI / 100) * 0.4 + Math.abs(currentMomentum) * 0.6,
          ) *
          (longConditionsMet / 4);
        logger.debug(
          `   ✅ LONG ENTRY SIGNAL confirmed! Conditions: ${longConditionsMet}/4 (requis: ${longRequiredConditions}), Strength: ${signalStrength.toFixed(3)}`,
        );
      } else {
        // Short entry conditions - TRÈS flexible: 2 critères sur 4 suffisent maintenant
        const shortConditions = {
          bearishCrossover,
          rsiConfirmsDowntrend: currentRSI > config.rsiOversoldLevel - 10, // Marge élargie de 10 points
          negativeMomentum: currentMomentum < -config.momentumThreshold * 0.5, // Seuil réduit de 50%
          volumeSignalShort: volumeResult.signal === "short",
        };

        logger.debug(`   Short entry conditions (ASSOUPLIES):`);
        logger.debug(
          `     Bearish crossover: ${shortConditions.bearishCrossover ? "✅" : "❌"}`,
        );
        logger.debug(
          `     RSI confirms downtrend: ${shortConditions.rsiConfirmsDowntrend ? "✅" : "❌"} (${currentRSI.toFixed(1)} > ${config.rsiOversoldLevel - 10})`,
        );
        logger.debug(
          `     Negative momentum: ${shortConditions.negativeMomentum ? "✅" : "❌"} (${(currentMomentum * 100).toFixed(3)}% < ${(-config.momentumThreshold * 0.5 * 100).toFixed(3)}%)`,
        );
        logger.debug(
          `     Volume signal short: ${shortConditions.volumeSignalShort ? "✅" : "❌"}`,
        );

        // Compter les conditions remplies
        const shortConditionsMet =
          Object.values(shortConditions).filter(Boolean).length;
        const shortRequiredConditions = 2; // RÉDUIT: 2 sur 4 suffisent maintenant

        if (shortConditionsMet >= shortRequiredConditions) {
          scalpingSignal = "short";
          signalStrength =
            Math.min(
              0.9,
              (currentRSI / 100) * 0.4 + Math.abs(currentMomentum) * 0.6,
            ) *
            (shortConditionsMet / 4);
          logger.debug(
            `   ✅ SHORT ENTRY SIGNAL confirmed! Conditions: ${shortConditionsMet}/4 (requis: ${shortRequiredConditions}), Strength: ${signalStrength.toFixed(3)}`,
          );
        } else {
          logger.debug(
            `   ❌ No entry conditions met - Long: ${longConditionsMet}/4 (requis: ${longRequiredConditions}), Short: ${shortConditionsMet}/4 (requis: ${shortRequiredConditions})`,
          );
        }
      }
    }

    // Exit signals
    if (currentPosition !== "none" && entryTime) {
      logger.debug(
        `   Current position: ${currentPosition} - checking exit signals...`,
      );

      const timeInPosition = Date.now() - entryTime;
      const maxHoldingTime = config.maxHoldingPeriod * 60000; // Convert to milliseconds

      logger.debug(`   Position metrics:`);
      logger.debug(
        `     Entry time: ${entryTime ? new Date(entryTime).toISOString() : "unknown"}`,
      );
      logger.debug(
        `     Holding time: ${(timeInPosition / 1000).toFixed(1)}s / ${(maxHoldingTime / 1000).toFixed(0)}s max`,
      );

      if (entryPrice) {
        const currentPnL =
          ((data[data.length - 1].price - entryPrice) / entryPrice) *
          (currentPosition === "long" ? 1 : -1);
        logger.debug(`     P&L: ${(currentPnL * 100).toFixed(3)}%`);
        logger.debug(
          `     Profit target: ${(config.profitTargetPercent * 100).toFixed(3)}%`,
        );
        logger.debug(
          `     Stop loss: ${(-config.stopLossPercent * 100).toFixed(3)}%`,
        );
      }

      const shouldExitTime = timeInPosition > maxHoldingTime;
      const shouldExitRSI =
        (currentPosition === "long" &&
          currentRSI > config.rsiOverboughtLevel) ||
        (currentPosition === "short" && currentRSI < config.rsiOversoldLevel);
      const shouldExitEMA =
        (currentPosition === "long" && bearishCrossover) ||
        (currentPosition === "short" && bullishCrossover);

      logger.debug(`   Exit conditions:`);
      logger.debug(
        `     Max holding time exceeded: ${shouldExitTime ? "✅" : "❌"}`,
      );
      logger.debug(`     Extreme RSI: ${shouldExitRSI ? "✅" : "❌"}`);
      logger.debug(`     Opposing crossover: ${shouldExitEMA ? "✅" : "❌"}`);

      if (shouldExitTime || shouldExitRSI || shouldExitEMA) {
        scalpingSignal = "exit";
        signalStrength = 0.8;

        const exitReason = shouldExitTime
          ? "max holding time"
          : shouldExitRSI
            ? "extreme RSI"
            : "opposing crossover";

        logger.debug(
          `   ✅ EXIT SIGNAL confirmed! Reason: ${exitReason}, Strength: ${signalStrength.toFixed(3)}`,
        );
      } else {
        logger.debug(`   ❌ No exit conditions met - maintaining position`);
      }
    }

    // Appliquer le poids du volume au calcul de confiance
    const confidence = scalpingSignal
      ? signalStrength * volumeWeight
      : Math.min(0.1, volumeResult.confidence * 0.2);

    logger.info(
      `⚡ Scalping Analysis Complete: signal=${scalpingSignal || "none"}, confidence=${confidence.toFixed(3)}, RSI=${currentRSI.toFixed(1)}, momentum=${(currentMomentum * 100).toFixed(3)}%`,
    );

    return {
      confidence,
      signal: scalpingSignal,
      strength: signalStrength,
      metadata: {
        fastEMA: currentFastEMA,
        slowEMA: currentSlowEMA,
        rsi: currentRSI,
        momentum: currentMomentum,
        bullishCrossover,
        bearishCrossover,
        holdingTime: entryTime ? Date.now() - entryTime : 0,
        position: currentPosition,
        entryPrice,
      },
    };
  };

  /**
   * Coordinate all strategy steps and generate final signal
   */
  const coordinateStrategies = (data: MarketData[]): CoordinatedAnalysis => {
    logger.info(
      `🚀 Starting coordinated multi-strategy analysis for ${config.symbol}`,
    );
    logger.debug(
      `📊 Data points available: ${data.length}, Current position: ${currentPosition}`,
    );

    // Step 1: Elliott Wave trend identification
    logger.info(`📈 Step 1/4: Analyzing Elliott Wave trend...`);
    const elliottResult = analyzeElliottWave(data);
    logger.info(
      `📈 Elliott Wave Result: signal=${elliottResult.signal || "none"}, confidence=${elliottResult.confidence.toFixed(3)}, strength=${elliottResult.strength.toFixed(3)}`,
    );

    if (elliottResult.confidence < config.trendConfidenceThreshold) {
      logger.warn(
        `⚠️  Elliott Wave confidence ${elliottResult.confidence.toFixed(3)} below threshold ${config.trendConfidenceThreshold}. Continuing with reduced weight.`,
      );
    }

    // Step 2: Harmonic pattern formation (depends on Elliott Wave)
    logger.info(`🎯 Step 2/4: Analyzing Harmonic Patterns...`);
    const harmonicResult = analyzeHarmonicPatterns(data, elliottResult);
    logger.info(
      `🎯 Harmonic Pattern Result: signal=${harmonicResult.signal || "none"}, confidence=${harmonicResult.confidence.toFixed(3)}, strength=${harmonicResult.strength.toFixed(3)}`,
    );

    if (harmonicResult.metadata?.patternType) {
      logger.info(
        `🎯 Pattern detected: ${harmonicResult.metadata.patternType} with ${harmonicResult.metadata.patternPoints?.length || 0} points`,
      );
    }

    if (harmonicResult.confidence < config.patternConfidenceThreshold) {
      logger.warn(
        `⚠️  Harmonic Pattern confidence ${harmonicResult.confidence.toFixed(3)} below threshold ${config.patternConfidenceThreshold}.`,
      );
    }

    // Step 3: Volume confirmation (can depend on either Harmonic Pattern or Elliott Wave)
    logger.info(`📊 Step 3/4: Analyzing Volume Confirmation...`);
    const volumeResult = analyzeVolumeConfirmation(
      data,
      harmonicResult,
      elliottResult,
    );
    logger.info(
      `📊 Volume Analysis Result: signal=${volumeResult.signal || "none"}, confidence=${volumeResult.confidence.toFixed(3)}, strength=${volumeResult.strength.toFixed(3)}`,
    );

    if (volumeResult.metadata?.volumeSurge) {
      logger.info(
        `📊 Volume surge detected! Ratio: ${volumeResult.metadata.volumeRatio.toFixed(2)}x average`,
      );
    }

    if (volumeResult.confidence < config.volumeConfidenceThreshold) {
      logger.warn(
        `⚠️  Volume confirmation ${volumeResult.confidence.toFixed(3)} below threshold ${config.volumeConfidenceThreshold}.`,
      );
    }

    // Step 4: Scalping indicators (depends on Volume Analysis)
    logger.info(`⚡ Step 4/4: Analyzing Scalping Signals...`);
    const scalpingResult = analyzeScalpingSignals(data, volumeResult);
    logger.info(
      `⚡ Scalping Signals Result: signal=${scalpingResult.signal || "none"}, confidence=${scalpingResult.confidence.toFixed(3)}, strength=${scalpingResult.strength.toFixed(3)}`,
    );

    if (scalpingResult.metadata) {
      logger.debug(
        `⚡ Scalping details: RSI=${scalpingResult.metadata.rsi?.toFixed(1)}, FastEMA=${scalpingResult.metadata.fastEMA?.toFixed(4)}, SlowEMA=${scalpingResult.metadata.slowEMA?.toFixed(4)}`,
      );
    }

    // Calculate overall confidence as weighted average
    const weights = {
      elliott: 0.3,
      harmonic: 0.25,
      volume: 0.25,
      scalping: 0.2,
    };

    const overallConfidence =
      elliottResult.confidence * weights.elliott +
      harmonicResult.confidence * weights.harmonic +
      volumeResult.confidence * weights.volume +
      scalpingResult.confidence * weights.scalping;

    logger.info(`🎯 WEIGHTED CONFIDENCE CALCULATION:`);
    logger.info(
      `   Elliott Wave: ${elliottResult.confidence.toFixed(3)} × ${weights.elliott} = ${(elliottResult.confidence * weights.elliott).toFixed(3)}`,
    );
    logger.info(
      `   Harmonic Pattern: ${harmonicResult.confidence.toFixed(3)} × ${weights.harmonic} = ${(harmonicResult.confidence * weights.harmonic).toFixed(3)}`,
    );
    logger.info(
      `   Volume Analysis: ${volumeResult.confidence.toFixed(3)} × ${weights.volume} = ${(volumeResult.confidence * weights.volume).toFixed(3)}`,
    );
    logger.info(
      `   Scalping Signals: ${scalpingResult.confidence.toFixed(3)} × ${weights.scalping} = ${(scalpingResult.confidence * weights.scalping).toFixed(3)}`,
    );
    logger.info(
      `   TOTAL CONFIDENCE: ${overallConfidence.toFixed(3)} (adaptive threshold: ${adaptiveThresholds.overall.toFixed(3)})`,
    );

    // Determine recommended action using adaptive thresholds
    let recommendedAction: CoordinatedAnalysis["recommendedAction"] = "wait";

    logger.info(`🔍 DECISION LOGIC:`);
    logger.info(
      `   Overall confidence: ${overallConfidence.toFixed(3)} vs adaptive threshold: ${adaptiveThresholds.overall.toFixed(3)}`,
    );

    if (overallConfidence >= adaptiveThresholds.overall) {
      logger.info(`✅ Confidence threshold met! Evaluating scalping signal...`);

      if (scalpingResult.signal === "long") {
        recommendedAction = "entry_long";
        logger.info(
          `🚀 RECOMMENDED ACTION: ENTRY LONG - Scalping signal aligned with trend`,
        );
      } else if (scalpingResult.signal === "short") {
        recommendedAction = "entry_short";
        logger.info(
          `🚀 RECOMMENDED ACTION: ENTRY SHORT - Scalping signal aligned with trend`,
        );
      } else if (scalpingResult.signal === "exit") {
        recommendedAction =
          currentPosition === "long" ? "exit_long" : "exit_short";
        logger.info(
          `🚪 RECOMMENDED ACTION: EXIT ${currentPosition.toUpperCase()} - Scalping exit signal`,
        );
      } else {
        logger.info(
          `⏳ No clear scalping signal despite high confidence. Waiting...`,
        );
      }
    } else if (overallConfidence < adaptiveThresholds.overall * 0.5) {
      recommendedAction = "hold";
      logger.info(
        `⏸️  RECOMMENDED ACTION: HOLD - Confidence too low (${overallConfidence.toFixed(3)} < ${(adaptiveThresholds.overall * 0.5).toFixed(3)})`,
      );
    } else {
      logger.info(
        `⏳ RECOMMENDED ACTION: WAIT - Moderate confidence, waiting for clearer signal`,
      );
    }

    logger.info(
      `🏁 Coordinated analysis complete. Final action: ${recommendedAction}`,
    );

    return {
      elliottWave: elliottResult,
      harmonicPattern: harmonicResult,
      volumeAnalysis: volumeResult,
      scalpingSignals: scalpingResult,
      overallConfidence,
      recommendedAction,
    };
  };

  // Helper functions
  const identifyHighsAndLows = (
    prices: number[],
  ): Array<{ index: number; price: number; type: "high" | "low" }> => {
    const points: Array<{
      index: number;
      price: number;
      type: "high" | "low";
    }> = [];
    const minDistance = 3; // Minimum distance between points

    for (let i = minDistance; i < prices.length - minDistance; i++) {
      const current = prices[i];
      let isHigh = true;
      let isLow = true;

      // Check if current point is a local high or low
      for (let j = 1; j <= minDistance; j++) {
        if (current <= prices[i - j] || current <= prices[i + j]) {
          isHigh = false;
        }
        if (current >= prices[i - j] || current >= prices[i + j]) {
          isLow = false;
        }
      }

      if (isHigh) {
        points.push({ index: i, price: current, type: "high" });
      } else if (isLow) {
        points.push({ index: i, price: current, type: "low" });
      }
    }

    return points;
  };

  const identifyPivotPoints = (
    prices: number[],
  ): Array<{ index: number; price: number }> => {
    const points = identifyHighsAndLows(prices);
    return points.map((p) => ({ index: p.index, price: p.price }));
  };

  const detectHarmonicPatterns = (
    pivots: Array<{ index: number; price: number }>,
  ): Array<{
    type: string;
    direction: "long" | "short";
    score: number;
    points: Array<{ index: number; price: number }>;
    fibLevels: number[];
  }> => {
    const patterns = [];

    // Simplified pattern detection - in reality this would be much more complex
    if (pivots.length >= 5) {
      const lastFive = pivots.slice(-5);
      const priceRange =
        Math.max(...lastFive.map((p) => p.price)) -
        Math.min(...lastFive.map((p) => p.price));
      const avgPrice =
        lastFive.reduce((sum, p) => sum + p.price, 0) / lastFive.length;

      // Simple bullish pattern detection
      if (
        lastFive[0].price > lastFive[2].price &&
        lastFive[4].price > lastFive[2].price
      ) {
        patterns.push({
          type: "Bullish Gartley",
          direction: "long" as const,
          score: 0.7,
          points: lastFive,
          fibLevels: [0.618, 0.786, 1.272, 1.618],
        });
      }

      // Simple bearish pattern detection
      if (
        lastFive[0].price < lastFive[2].price &&
        lastFive[4].price < lastFive[2].price
      ) {
        patterns.push({
          type: "Bearish Gartley",
          direction: "short" as const,
          score: 0.7,
          points: lastFive,
          fibLevels: [0.618, 0.786, 1.272, 1.618],
        });
      }
    }

    return patterns;
  };

  /**
   * Auto-tuning system to adapt thresholds based on market conditions
   */
  let adaptiveThresholds = {
    elliott: config.trendConfidenceThreshold,
    pattern: config.patternConfidenceThreshold,
    volume: config.volumeConfidenceThreshold,
    overall: config.overallConfidenceThreshold,
    lastAdjustment: Date.now(),
    performanceHistory: [] as Array<{
      timestamp: number;
      success: boolean;
      confidence: number;
    }>,
  };

  const adjustThresholdsBasedOnPerformance = () => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    // Ajuster les seuils toutes les heures
    if (now - adaptiveThresholds.lastAdjustment < oneHour) return;

    const recentPerformance = adaptiveThresholds.performanceHistory.filter(
      (p) => now - p.timestamp < oneHour * 6, // Dernières 6 heures
    );

    if (recentPerformance.length < 3) return; // Pas assez de données

    const successRate =
      recentPerformance.filter((p) => p.success).length /
      recentPerformance.length;
    const avgConfidence =
      recentPerformance.reduce((sum, p) => sum + p.confidence, 0) /
      recentPerformance.length;

    logger.debug(
      `🎯 Auto-tuning: Success rate: ${(successRate * 100).toFixed(1)}%, Avg confidence: ${avgConfidence.toFixed(3)}`,
    );

    // Si trop peu de signaux (succès rate très bas), réduire les seuils
    if (successRate < 0.1 && avgConfidence > 0.4) {
      adaptiveThresholds.elliott *= 0.9;
      adaptiveThresholds.pattern *= 0.9;
      adaptiveThresholds.volume *= 0.9;
      adaptiveThresholds.overall *= 0.9;
      logger.info(`🎯 Auto-tuning: Reducing thresholds due to low signal rate`);
    }
    // Si trop de signaux avec performance médiocre, augmenter les seuils
    else if (successRate > 0.8 && avgConfidence < 0.3) {
      adaptiveThresholds.elliott = Math.min(
        adaptiveThresholds.elliott * 1.1,
        config.trendConfidenceThreshold * 1.5,
      );
      adaptiveThresholds.pattern = Math.min(
        adaptiveThresholds.pattern * 1.1,
        config.patternConfidenceThreshold * 1.5,
      );
      adaptiveThresholds.volume = Math.min(
        adaptiveThresholds.volume * 1.1,
        config.volumeConfidenceThreshold * 1.5,
      );
      adaptiveThresholds.overall = Math.min(
        adaptiveThresholds.overall * 1.1,
        config.overallConfidenceThreshold * 1.5,
      );
      logger.info(
        `🎯 Auto-tuning: Increasing thresholds due to poor performance`,
      );
    }

    adaptiveThresholds.lastAdjustment = now;
  };

  const strategy: Strategy = {
    getId: () => `coordinated-multi-strategy-${config.symbol}`,
    getName: () => `Coordinated Multi-Strategy (${config.symbol})`,
    getConfig: () => ({
      id: `coordinated-multi-strategy-${config.symbol}`,
      name: `Coordinated Multi-Strategy (${config.symbol})`,
      description:
        "Coordinated workflow combining Elliott Wave, Harmonic Patterns, Volume Analysis, and Scalping indicators",
      parameters: config as unknown as Record<string, unknown>,
      enabled: true,
    }),

    processMarketData: async (
      data: MarketData,
    ): Promise<StrategySignal | null> => {
      try {
        logger.debug(
          `📥 Processing market data for ${config.symbol}: price=${data.price}, volume=${data.volume}, timestamp=${data.timestamp}`,
        );

        // Add new data to history
        marketDataHistory.push(data);

        // Keep only necessary history (max length for all indicators)
        const maxHistoryLength =
          Math.max(
            config.waveDetectionLength,
            config.detectionLength,
            config.volumeMALength * 2,
            config.slowEmaPeriod,
          ) + 10;

        if (marketDataHistory.length > maxHistoryLength) {
          const removed = marketDataHistory.length - maxHistoryLength;
          marketDataHistory = marketDataHistory.slice(-maxHistoryLength);
          logger.debug(
            `🗂️  Trimmed history: removed ${removed} old data points, keeping ${maxHistoryLength}`,
          );
        }

        // Check if we need to refresh historical data
        const requiredDataPoints = maxHistoryLength * 0.8;
        if (marketDataHistory.length < requiredDataPoints) {
          logger.info(
            `📈 Insufficient data (${marketDataHistory.length}/${requiredDataPoints}), attempting to refresh historical data for ${config.symbol}...`,
          );

          // Try to get additional historical data if marketDataPort is available
          try {
            if (marketDataPort) {
              logger.debug(
                `🔄 Fetching fresh historical data from market data port...`,
              );
              const freshHistoricalData =
                await marketDataPort.getHistoricalMarketData(
                  config.symbol,
                  maxHistoryLength,
                );

              if (freshHistoricalData && freshHistoricalData.length > 0) {
                logger.info(
                  `✅ Retrieved ${freshHistoricalData.length} fresh historical data points`,
                );

                // Merge fresh historical data with existing real-time data
                // Create a map to avoid duplicates by timestamp
                const dataMap = new Map<number, MarketData>();

                // Add fresh historical data first
                for (const data of freshHistoricalData) {
                  if (
                    data.symbol === config.symbol &&
                    data.price &&
                    data.price > 0 &&
                    data.volume >= 0
                  ) {
                    dataMap.set(data.timestamp, data);
                  }
                }

                // Add existing real-time data (which may override some historical data with more recent versions)
                for (const data of marketDataHistory) {
                  dataMap.set(data.timestamp, data);
                }

                // Convert back to array and sort by timestamp
                const mergedData = Array.from(dataMap.values()).sort(
                  (a, b) => a.timestamp - b.timestamp,
                );

                // Keep only the most recent data up to maxHistoryLength
                marketDataHistory = mergedData.slice(-maxHistoryLength);

                logger.info(
                  `🔄 Data refresh complete: merged to ${marketDataHistory.length} total data points for ${config.symbol}`,
                );
              } else {
                logger.warn(
                  `⚠️ No fresh historical data received from market data port for ${config.symbol}`,
                );
              }
            } else {
              logger.warn(
                `⚠️ No market data port available for refreshing historical data for ${config.symbol}`,
              );
            }

            // If we still don't have enough data, wait for more real-time data
            if (marketDataHistory.length < requiredDataPoints) {
              const stillNeedData =
                requiredDataPoints - marketDataHistory.length;
              logger.debug(
                `⏳ Still need ${stillNeedData} more data points for ${config.symbol}. Continuing to accumulate real-time data...`,
              );
              return null;
            }
          } catch (error) {
            logger.warn(
              `Failed to refresh historical data for ${config.symbol}:`,
              error as Error,
            );
            return null;
          }
        }

        logger.info(
          `🔄 Starting coordinated analysis with ${marketDataHistory.length} data points`,
        );

        // Apply auto-tuning before analysis
        adjustThresholdsBasedOnPerformance();

        // Perform coordinated analysis with adaptive thresholds
        const analysis = coordinateStrategies(marketDataHistory);

        logger.info(`📋 COORDINATED ANALYSIS SUMMARY:`);
        logger.info(
          `   Overall confidence: ${analysis.overallConfidence.toFixed(3)}`,
        );
        logger.info(`   Recommended action: ${analysis.recommendedAction}`);
        logger.info(`   Current position: ${currentPosition}`);

        // Log detailed breakdown
        logger.debug(`📊 Strategy Breakdown:`);
        logger.debug(
          `   Elliott Wave: ${analysis.elliottWave.confidence.toFixed(3)} (${analysis.elliottWave.signal || "none"})`,
        );
        logger.debug(
          `   Harmonic Pattern: ${analysis.harmonicPattern.confidence.toFixed(3)} (${analysis.harmonicPattern.signal || "none"})`,
        );
        logger.debug(
          `   Volume Analysis: ${analysis.volumeAnalysis.confidence.toFixed(3)} (${analysis.volumeAnalysis.signal || "none"})`,
        );
        logger.debug(
          `   Scalping Signals: ${analysis.scalpingSignals.confidence.toFixed(3)} (${analysis.scalpingSignals.signal || "none"})`,
        );

        // Generate signal based on coordinated analysis
        if (analysis.recommendedAction === "entry_long") {
          logger.info(`🚀 EXECUTING LONG ENTRY at price ${data.price}`);
          currentPosition = "long";
          entryTime = Date.now();
          entryPrice = data.price;

          return {
            type: "entry",
            direction: "long",
            reason: `Coordinated multi-strategy entry signal - confidence: ${analysis.overallConfidence.toFixed(3)}`,
            confidence: analysis.overallConfidence,
            metadata: {
              strategy: "coordinated-multi-strategy",
              analysis,
              entryPrice: data.price,
              entryTime: entryTime,
            },
          };
        } else if (analysis.recommendedAction === "entry_short") {
          logger.info(`🚀 EXECUTING SHORT ENTRY at price ${data.price}`);
          currentPosition = "short";
          entryTime = Date.now();
          entryPrice = data.price;

          return {
            type: "entry",
            direction: "short",
            reason: `Coordinated multi-strategy short entry signal - confidence: ${analysis.overallConfidence.toFixed(3)}`,
            confidence: analysis.overallConfidence,
            metadata: {
              strategy: "coordinated-multi-strategy",
              analysis,
              entryPrice: data.price,
              entryTime: entryTime,
            },
          };
        } else if (
          analysis.recommendedAction === "exit_long" ||
          analysis.recommendedAction === "exit_short"
        ) {
          const exitDirection = currentPosition === "long" ? "short" : "long";
          const holdingPeriod = entryTime ? Date.now() - entryTime : 0;
          const pnl = entryPrice
            ? ((data.price - entryPrice) / entryPrice) *
              (currentPosition === "long" ? 1 : -1)
            : 0;

          logger.info(
            `🚪 EXECUTING EXIT from ${currentPosition.toUpperCase()} position`,
          );
          logger.info(`   Entry price: ${entryPrice}`);
          logger.info(`   Exit price: ${data.price}`);
          logger.info(
            `   Holding period: ${(holdingPeriod / 1000).toFixed(1)}s`,
          );
          logger.info(`   P&L: ${(pnl * 100).toFixed(2)}%`);

          currentPosition = "none";
          entryTime = null;
          entryPrice = null;

          return {
            type: "exit",
            direction: exitDirection,
            reason: `Coordinated multi-strategy exit signal - scalping confidence: ${analysis.scalpingSignals.confidence.toFixed(3)}`,
            confidence: analysis.scalpingSignals.confidence,
            metadata: {
              strategy: "coordinated-multi-strategy",
              analysis,
              exitPrice: data.price,
              holdingPeriod,
              pnl,
            },
          };
        } else if (analysis.recommendedAction === "hold") {
          logger.debug(
            `⏸️  HOLDING current position (${currentPosition}) - confidence too low`,
          );
        } else {
          logger.debug(
            `⏳ WAITING for better signal - current action: ${analysis.recommendedAction}`,
          );
        }

        return null;
      } catch (error) {
        logger.error(
          "❌ Error in coordinated multi-strategy analysis",
          error as Error,
        );
        return null;
      }
    },

    generateOrder: (
      signal: StrategySignal,
      marketData: MarketData,
    ): OrderParams => {
      const side = signal.direction === "long" ? OrderSide.BUY : OrderSide.SELL;
      const size = config.positionSize;

      return {
        symbol: config.symbol,
        side,
        size,
        type: config.useLimitOrders ? OrderType.LIMIT : OrderType.MARKET,
        price: config.useLimitOrders
          ? marketData.price *
            (1 +
              (side === OrderSide.BUY ? 1 : -1) *
                (config.limitOrderBuffer || 0.001))
          : undefined,
        timeInForce: TimeInForce.IMMEDIATE_OR_CANCEL,
      };
    },

    initializeWithHistory: async (
      historicalData: MarketData[],
    ): Promise<void> => {
      if (!historicalData || historicalData.length === 0) {
        logger.info(
          `🔄 No historical data provided for Coordinated Multi-Strategy on ${config.symbol}`,
        );
        return;
      }

      logger.info(
        `🚀 Initializing Coordinated Multi-Strategy with ${historicalData.length} historical data points for ${config.symbol}`,
      );

      // Reset state
      marketDataHistory = [];
      currentPosition = "none";
      entryTime = null;
      entryPrice = null;

      // Calculate the required data points for analysis
      const maxHistoryLength =
        Math.max(
          config.waveDetectionLength,
          config.detectionLength,
          config.volumeMALength * 2,
          config.slowEmaPeriod,
        ) + 10;

      logger.debug(
        `📊 Required data points: ${maxHistoryLength}, Available: ${historicalData.length}`,
      );

      // Process historical data for the correct symbol only
      let processedCount = 0;
      let symbolMismatchCount = 0;
      let priceInvalidCount = 0;
      let volumeInvalidCount = 0;

      // Log first few entries for debugging
      logger.debug(`🔍 First 3 historical data entries for debugging:`);
      for (let i = 0; i < Math.min(3, historicalData.length); i++) {
        const data = historicalData[i];
        logger.debug(
          `   Entry ${i + 1}: symbol="${data.symbol}", price=${data.price}, volume=${data.volume}, timestamp=${data.timestamp}`,
        );
      }

      logger.debug(
        `🔍 Looking for symbol: "${config.symbol}" (length: ${config.symbol.length})`,
      );

      for (const data of historicalData) {
        // Debug symbol matching
        const symbolMatches = data.symbol === config.symbol;
        const priceValid = data.price && data.price > 0;
        const volumeValid = data.volume && data.volume >= 0;

        if (!symbolMatches) {
          symbolMismatchCount++;
          if (symbolMismatchCount <= 3) {
            // Log first few mismatches
            logger.debug(
              `   Symbol mismatch: got "${data.symbol}" (length: ${data.symbol?.length}), expected "${config.symbol}"`,
            );
          }
        }
        if (!priceValid) {
          priceInvalidCount++;
          if (priceInvalidCount <= 3) {
            logger.debug(`   Invalid price: ${data.price}`);
          }
        }
        if (!volumeValid) {
          volumeInvalidCount++;
          if (volumeInvalidCount <= 3) {
            logger.debug(`   Invalid volume: ${data.volume}`);
          }
        }

        if (symbolMatches && priceValid && volumeValid) {
          marketDataHistory.push(data);
          processedCount++;
        }
      }

      logger.debug(`🔍 Filtering results:`);
      logger.debug(
        `   Symbol mismatches: ${symbolMismatchCount}/${historicalData.length}`,
      );
      logger.debug(
        `   Price invalid: ${priceInvalidCount}/${historicalData.length}`,
      );
      logger.debug(
        `   Volume invalid: ${volumeInvalidCount}/${historicalData.length}`,
      );
      logger.debug(
        `   Successfully processed: ${processedCount}/${historicalData.length}`,
      );

      // Keep only the most recent data up to maxHistoryLength
      if (marketDataHistory.length > maxHistoryLength) {
        marketDataHistory = marketDataHistory.slice(-maxHistoryLength);
        logger.debug(
          `🗂️  Trimmed historical data to keep most recent ${maxHistoryLength} points`,
        );
      }

      const requiredDataPoints = maxHistoryLength * 0.8;
      const hasEnoughData = marketDataHistory.length >= requiredDataPoints;

      logger.info(
        `✅ Coordinated Multi-Strategy initialized for ${config.symbol}:`,
        {
          symbol: config.symbol,
          totalHistoricalPoints: historicalData.length,
          processedPoints: processedCount,
          finalHistoryLength: marketDataHistory.length,
          requiredForAnalysis: requiredDataPoints,
          readyForAnalysis: hasEnoughData,
          dataStatus: hasEnoughData ? "READY" : "WAITING_FOR_MORE_DATA",
        },
      );

      // If we have enough data, perform an initial analysis to test the system
      if (hasEnoughData) {
        try {
          logger.info(`🔬 Performing initial analysis with preloaded data...`);
          const analysis = coordinateStrategies(marketDataHistory);
          logger.info(
            `🎯 Initial analysis complete - Overall confidence: ${analysis.overallConfidence.toFixed(3)}, Action: ${analysis.recommendedAction}`,
          );
        } catch (error) {
          logger.warn(
            `⚠️  Initial analysis failed with preloaded data:`,
            error as Error,
          );
        }
      } else {
        logger.warn(
          `📈 Need ${Math.ceil(requiredDataPoints - marketDataHistory.length)} more data points before analysis can begin`,
        );
      }
    },
  };

  return strategy;
};
