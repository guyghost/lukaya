import { Result } from '../types';
import { result } from '../utils';
import { resultUtils } from '../utils/result-utils';
import * as ErrorTypes from './error-types';

/**
 * Utilitaire pour standardiser la gestion d'erreurs avec le pattern Result
 * Permet de convertir des exceptions en objets Result
 */
export const errorHandler = {
  /**
   * Convertit une erreur en Result typé
   */
  handleError<T>(error: unknown, contextMessage?: string): Result<T> {
    // Si c'est déjà une erreur métier, on la garde
    if (error instanceof ErrorTypes.AppError) {
      return result.error<T>(error, contextMessage || error.message);
    }
    
    // Si c'est une Error standard, on la convertit en UnexpectedError
    if (error instanceof Error) {
      const unexpectedError = new ErrorTypes.UnexpectedError(error.message);
      return result.error<T>(unexpectedError, contextMessage || error.message);
    }
    
    // Si c'est autre chose, on crée une UnexpectedError
    const message = typeof error === 'string' ? error : 'Une erreur inattendue est survenue';
    const unexpectedError = new ErrorTypes.UnexpectedError(message);
    return result.error<T>(unexpectedError, contextMessage || message);
  },

  /**
   * Exécute une fonction asynchrone et renvoie un Result
   * Capture les exceptions et les convertit en Result.error
   */
  async handleAsync<T>(
    fn: () => Promise<T>,
    contextMessage?: string
  ): Promise<Result<T>> {
    return resultUtils.fromPromise(fn())
      .catch(error => this.handleError<T>(error, contextMessage));
  },

  /**
   * Exécute une fonction synchrone et renvoie un Result
   * Capture les exceptions et les convertit en Result.error
   */
  handle<T>(fn: () => T, contextMessage?: string): Result<T> {
    try {
      const data = fn();
      return result.success<T>(data);
    } catch (error) {
      return this.handleError<T>(error, contextMessage);
    }
  },

  /**
   * Convertit une erreur de validation en ValidationError
   */
  validationError<T>(message: string): Result<T> {
    return result.error<T>(new ErrorTypes.ValidationError(message), message);
  },

  /**
   * Convertit une erreur de trading en TradingError
   */
  tradingError<T>(message: string): Result<T> {
    return result.error<T>(new ErrorTypes.TradingError(message), message);
  },

  /**
   * Convertit une erreur de marché en MarketError
   */
  marketError<T>(message: string): Result<T> {
    return result.error<T>(new ErrorTypes.MarketError(message), message);
  },

  /**
   * Convertit une erreur de stratégie en StrategyError
   */
  strategyError<T>(message: string): Result<T> {
    return result.error<T>(new ErrorTypes.StrategyError(message), message);
  },

  /**
   * Convertit une erreur technique en TechnicalError
   */
  technicalError<T>(message: string): Result<T> {
    return result.error<T>(new ErrorTypes.TechnicalError(message), message);
  },
  
  /**
   * Retry a function with a delay between attempts
   * @param fn Function to retry
   * @param retries Maximum number of retries
   * @param delay Delay between retries in milliseconds
   * @param contextMessage Optional context message for errors
   * @returns Promise<Result<T>>
   */
  async retryAsync<T>(
    fn: () => Promise<T>,
    retries: number = 3,
    delay: number = 1000,
    contextMessage?: string
  ): Promise<Result<T>> {
    let lastError: unknown;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Add delay before retries (not before first attempt)
        if (attempt > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        const data = await fn();
        return result.success<T>(data);
      } catch (error) {
        lastError = error;
        
        // Log retry attempts
        if (attempt < retries) {
          console.warn(`Attempt ${attempt + 1}/${retries + 1} failed, retrying in ${delay}ms...`, error);
        }
      }
    }
    
    return this.handleError<T>(
      lastError, 
      contextMessage || `Failed after ${retries + 1} attempts`
    );
  }
};
