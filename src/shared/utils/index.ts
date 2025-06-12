/**
 * Utilitaires partagés pour Lukaya Trading Bot
 */

import {
  Result,
  LogLevel,
  SanitizableValue,
  SanitizableObject,
} from "../types";

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
  isSuccess: <T>(
    result: Result<T>,
  ): result is Result<T> & { success: true; data: T } => {
    return result.success;
  },

  /**
   * Vérifie si un Result est une erreur
   */
  isError: <T>(
    result: Result<T>,
  ): result is Result<T> & { success: false; error: Error } => {
    return !result.success;
  },
};

// Utilitaires de logging
export const logging = {
  /**
   * Sanitise un objet pour le logging (retire les informations sensibles)
   */
  sanitize: (obj: SanitizableValue): SanitizableValue => {
    const sensitiveKeys = [
      "mnemonic",
      "privateKey",
      "secret",
      "password",
      "token",
      "apiKey",
    ];

    if (typeof obj !== "object" || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => logging.sanitize(item));
    }

    const sanitized: SanitizableObject = {};
    for (const [key, value] of Object.entries(obj)) {
      if (
        sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))
      ) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null) {
        sanitized[key] = logging.sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  },
};
