/**
 * Utilitaires partagés pour Lukaya Trading Bot
 */

import { Result, LogLevel } from '../types';
import { TRADING_CONSTANTS, NETWORK_CONSTANTS } from '../constants';

// Utilitaires de validation
export const validation = {
  /**
   * Valide si un nombre est dans une plage donnée
   */
  isInRange: (value: number, min: number, max: number): boolean => {
    return value >= min && value <= max;
  },

  /**
   * Valide une taille de position
   */
  isValidPositionSize: (size: number): boolean => {
    return validation.isInRange(size, TRADING_CONSTANTS.MIN_POSITION_SIZE, TRADING_CONSTANTS.MAX_POSITION_SIZE);
  },

  /**
   * Valide un pourcentage de risque
   */
  isValidRiskPercent: (risk: number): boolean => {
    return validation.isInRange(risk, 0, TRADING_CONSTANTS.MAX_RISK_PER_TRADE);
  },

  /**
   * Valide un symbole de marché
   */
  isValidSymbol: (symbol: string): boolean => {
    const symbolPattern = /^[A-Z]+-USD$/;
    return symbolPattern.test(symbol);
  },

  /**
   * Valide un niveau de log
   */
  isValidLogLevel: (level: string): level is LogLevel => {
    return ['debug', 'info', 'warn', 'error'].includes(level);
  },
};

// Utilitaires de formatage
export const formatting = {
  /**
   * Formate un nombre en pourcentage
   */
  toPercent: (value: number, decimals: number = 2): string => {
    return `${(value * 100).toFixed(decimals)}%`;
  },

  /**
   * Formate un prix avec le bon nombre de décimales
   */
  formatPrice: (price: number, decimals: number = 2): string => {
    return price.toFixed(decimals);
  },

  /**
   * Formate un timestamp en date lisible
   */
  formatTimestamp: (timestamp: number): string => {
    return new Date(timestamp).toISOString();
  },

  /**
   * Formate une durée en millisecondes en texte lisible
   */
  formatDuration: (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}j ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  },
};

// Utilitaires mathématiques
export const math = {
  /**
   * Calcule le pourcentage de changement entre deux valeurs
   */
  percentChange: (oldValue: number, newValue: number): number => {
    if (oldValue === 0) return 0;
    return (newValue - oldValue) / oldValue;
  },

  /**
   * Calcule la moyenne d'un tableau de nombres
   */
  average: (values: number[]): number => {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  },

  /**
   * Calcule l'écart type d'un tableau de nombres
   */
  standardDeviation: (values: number[]): number => {
    const avg = math.average(values);
    const variance = math.average(values.map(x => Math.pow(x - avg, 2)));
    return Math.sqrt(variance);
  },

  /**
   * Arrondit un nombre à n décimales
   */
  round: (value: number, decimals: number): number => {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  },

  /**
   * Limite une valeur entre min et max
   */
  clamp: (value: number, min: number, max: number): number => {
    return Math.min(Math.max(value, min), max);
  },
};

// Utilitaires d'async/await
export const async = {
  /**
   * Attend un certain nombre de millisecondes
   */
  delay: (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Exécute une fonction avec un timeout
   */
  withTimeout: <T>(promise: Promise<T>, timeoutMs: number = NETWORK_CONSTANTS.DEFAULT_TIMEOUT): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), timeoutMs);
      })
    ]);
  },

  /**
   * Retry une fonction avec backoff exponentiel
   */
  retryWithBackoff: async <T>(
    fn: () => Promise<T>,
    maxRetries: number = NETWORK_CONSTANTS.MAX_RETRIES,
    baseDelay: number = NETWORK_CONSTANTS.RETRY_DELAY
  ): Promise<T> => {
    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries) {
          throw lastError;
        }

        const delay = baseDelay * Math.pow(NETWORK_CONSTANTS.BACKOFF_MULTIPLIER, attempt);
        await async.delay(delay);
      }
    }

    throw lastError!;
  },
};

// Utilitaires de Result/Error handling
export const result = {
  /**
   * Crée un Result de succès
   */
  success: <T>(data: T, message?: string): Result<T> => ({
    success: true,
    data,
    message,
  }),

  /**
   * Crée un Result d'erreur
   */
  error: <T>(error: Error, message?: string): Result<T> => ({
    success: false,
    error,
    message: message || error.message,
  }),

  /**
   * Vérifie si un Result est un succès
   */
  isSuccess: <T>(result: Result<T>): result is Result<T> & { success: true; data: T } => {
    return result.success;
  },

  /**
   * Vérifie si un Result est une erreur
   */
  isError: <T>(result: Result<T>): result is Result<T> & { success: false; error: Error } => {
    return !result.success;
  },
};

// Utilitaires de génération d'ID
export const id = {
  /**
   * Génère un UUID v4
   */
  generate: (): string => {
    return crypto.randomUUID();
  },

  /**
   * Génère un ID court (8 caractères)
   */
  generateShort: (): string => {
    return Math.random().toString(36).substring(2, 10);
  },

  /**
   * Génère un ID préfixé
   */
  generateWithPrefix: (prefix: string): string => {
    return `${prefix}_${id.generateShort()}`;
  },
};

// Utilitaires de logging
export const logging = {
  /**
   * Sanitise un objet pour le logging (retire les informations sensibles)
   */
  sanitize: (obj: any): any => {
    const sensitiveKeys = ['mnemonic', 'privateKey', 'secret', 'password', 'token', 'apiKey'];
    
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(logging.sanitize);
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object') {
        sanitized[key] = logging.sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  },
};
