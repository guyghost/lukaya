/**
 * Technical Indicators Service
 * Provides common technical analysis calculations
 */

import { EMA, RSI, SMA } from 'technicalindicators';

export class TechnicalIndicators {
  /**
   * Calculate Simple Moving Average
   */
  calculateSMA(values: number[], period: number): number[] {
    if (values.length < period) return [];
    return SMA.calculate({ period, values });
  }

  /**
   * Calculate Exponential Moving Average
   */
  calculateEMA(values: number[], period: number): number[] {
    if (values.length < period) return [];
    return EMA.calculate({ period, values });
  }

  /**
   * Calculate Relative Strength Index
   */
  calculateRSI(values: number[], period: number): number[] {
    if (values.length < period + 1) return [];
    return RSI.calculate({ period, values });
  }

  /**
   * Calculate Momentum
   */
  calculateMomentum(values: number[], period: number): number[] {
    const momentum: number[] = [];
    
    for (let i = period; i < values.length; i++) {
      const currentValue = values[i];
      const pastValue = values[i - period];
      const momentumValue = (currentValue - pastValue) / pastValue;
      momentum.push(momentumValue);
    }
    
    return momentum;
  }

  /**
   * Calculate Rate of Change
   */
  calculateROC(values: number[], period: number): number[] {
    const roc: number[] = [];
    
    for (let i = period; i < values.length; i++) {
      const currentValue = values[i];
      const pastValue = values[i - period];
      const rocValue = ((currentValue - pastValue) / pastValue) * 100;
      roc.push(rocValue);
    }
    
    return roc;
  }

  /**
   * Calculate Standard Deviation
   */
  calculateStandardDeviation(values: number[], period: number): number[] {
    const stdev: number[] = [];
    
    for (let i = period - 1; i < values.length; i++) {
      const slice = values.slice(i - period + 1, i + 1);
      const mean = slice.reduce((sum, val) => sum + val, 0) / slice.length;
      const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / slice.length;
      stdev.push(Math.sqrt(variance));
    }
    
    return stdev;
  }

  /**
   * Calculate Bollinger Bands
   */
  calculateBollingerBands(values: number[], period: number, multiplier: number = 2): {
    upper: number[];
    middle: number[];
    lower: number[];
  } {
    const sma = this.calculateSMA(values, period);
    const stdev = this.calculateStandardDeviation(values, period);
    
    const upper: number[] = [];
    const middle: number[] = [];
    const lower: number[] = [];
    
    for (let i = 0; i < sma.length; i++) {
      const centerLine = sma[i];
      const deviation = stdev[i] * multiplier;
      
      upper.push(centerLine + deviation);
      middle.push(centerLine);
      lower.push(centerLine - deviation);
    }
    
    return { upper, middle, lower };
  }

  /**
   * Calculate Average True Range
   */
  calculateATR(highs: number[], lows: number[], closes: number[], period: number): number[] {
    if (highs.length !== lows.length || lows.length !== closes.length) {
      throw new Error("All arrays must have the same length");
    }
    
    const trueRanges: number[] = [];
    
    for (let i = 1; i < highs.length; i++) {
      const high = highs[i];
      const low = lows[i];
      const prevClose = closes[i - 1];
      
      const tr1 = high - low;
      const tr2 = Math.abs(high - prevClose);
      const tr3 = Math.abs(low - prevClose);
      
      trueRanges.push(Math.max(tr1, tr2, tr3));
    }
    
    return this.calculateSMA(trueRanges, period);
  }

  /**
   * Find peaks and valleys in price data
   */
  findPeaksAndValleys(values: number[], minDistance: number = 3): Array<{
    index: number;
    value: number;
    type: 'peak' | 'valley';
  }> {
    const points: Array<{index: number; value: number; type: 'peak' | 'valley'}> = [];
    
    for (let i = minDistance; i < values.length - minDistance; i++) {
      const current = values[i];
      let isPeak = true;
      let isValley = true;
      
      // Check if current point is a peak or valley
      for (let j = 1; j <= minDistance; j++) {
        if (current <= values[i - j] || current <= values[i + j]) {
          isPeak = false;
        }
        if (current >= values[i - j] || current >= values[i + j]) {
          isValley = false;
        }
      }
      
      if (isPeak) {
        points.push({ index: i, value: current, type: 'peak' });
      } else if (isValley) {
        points.push({ index: i, value: current, type: 'valley' });
      }
    }
    
    return points;
  }

  /**
   * Calculate linear regression
   */
  calculateLinearRegression(values: number[]): {
    slope: number;
    intercept: number;
    r2: number;
  } {
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    
    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = values.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * values[i], 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);
    const sumYY = values.reduce((sum, val) => sum + val * val, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    const meanY = sumY / n;
    const ssTotal = values.reduce((sum, val) => sum + Math.pow(val - meanY, 2), 0);
    const ssResidual = values.reduce((sum, val, i) => {
      const predicted = slope * i + intercept;
      return sum + Math.pow(val - predicted, 2);
    }, 0);
    
    const r2 = 1 - (ssResidual / ssTotal);
    
    return { slope, intercept, r2 };
  }
}
