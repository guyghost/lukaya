/**
 * Système de logging amélioré pour Lukaya Trading Bot
 */

import * as fs from "fs";
import * as path from "path";
import { LogLevel, LogContext } from "../../shared/types";
import { logging } from "../../shared/utils";

export interface LoggerConfig {
  level: LogLevel;
  fileOutput: boolean;
  logFilePath?: string;
  maxFileSize: number;
  maxFiles: number;
  includeTimestamp: boolean;
  includeLevel: boolean;
  includeSource: boolean;
  colorOutput: boolean;
}

export interface Logger {
  debug: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, error?: Error, context?: LogContext) => void;
  setLevel: (level: LogLevel) => void;
  setConfig: (config: Partial<LoggerConfig>) => void;
}

// Configuration par défaut
const DEFAULT_CONFIG: LoggerConfig = {
  level: "info",
  fileOutput: false,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
  includeTimestamp: true,
  includeLevel: true,
  includeSource: false,
  colorOutput: true,
};

// Configuration globale du logger
let loggerConfig: LoggerConfig = { ...DEFAULT_CONFIG };

// Priorités des niveaux de log
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Couleurs pour la sortie console
const COLORS = {
  debug: "\x1b[36m", // Cyan
  info: "\x1b[32m", // Vert
  warn: "\x1b[33m", // Jaune
  error: "\x1b[31m", // Rouge
  reset: "\x1b[0m", // Reset
} as const;

/**
 * Vérifie si un message doit être loggé selon le niveau configuré
 */
const shouldLog = (messageLevel: LogLevel): boolean => {
  return LEVEL_PRIORITY[messageLevel] >= LEVEL_PRIORITY[loggerConfig.level];
};

/**
 * Formate un message de log
 */
const formatMessage = (
  level: LogLevel,
  message: string,
  context?: LogContext,
  source?: string,
): string => {
  const parts: string[] = [];

  // Timestamp
  if (loggerConfig.includeTimestamp) {
    parts.push(`[${new Date().toISOString()}]`);
  }

  // Niveau
  if (loggerConfig.includeLevel) {
    parts.push(`[${level.toUpperCase()}]`);
  }

  // Source
  if (loggerConfig.includeSource && source) {
    parts.push(`[${source}]`);
  }

  // Message principal
  parts.push(message);

  // Contexte
  if (context && Object.keys(context).length > 0) {
    const sanitizedContext = logging.sanitize(context);
    parts.push(JSON.stringify(sanitizedContext));
  }

  return parts.join(" ");
};

/**
 * Applique les couleurs au message pour la console
 */
const colorizeMessage = (level: LogLevel, message: string): string => {
  if (!loggerConfig.colorOutput) {
    return message;
  }

  const color = COLORS[level];
  return `${color}${message}${COLORS.reset}`;
};

/**
 * Écrit un message dans un fichier de log
 */
const writeToFile = (message: string): void => {
  if (!loggerConfig.fileOutput || !loggerConfig.logFilePath) {
    return;
  }

  try {
    // Vérifier la taille du fichier et effectuer la rotation si nécessaire
    if (fs.existsSync(loggerConfig.logFilePath)) {
      const stats = fs.statSync(loggerConfig.logFilePath);
      if (stats.size >= loggerConfig.maxFileSize) {
        rotateLogFiles();
      }
    }

    // Écrire le message
    fs.appendFileSync(loggerConfig.logFilePath, message + "\n", {
      encoding: "utf8",
    });
  } catch (error) {
    console.error("Erreur lors de l'écriture du log:", error);
  }
};

/**
 * Effectue la rotation des fichiers de log
 */
const rotateLogFiles = (): void => {
  if (!loggerConfig.logFilePath) return;

  const logDir = path.dirname(loggerConfig.logFilePath);
  const logBaseName = path.basename(
    loggerConfig.logFilePath,
    path.extname(loggerConfig.logFilePath),
  );
  const logExt = path.extname(loggerConfig.logFilePath);

  try {
    // Supprimer le fichier le plus ancien si on atteint la limite
    const oldestFile = path.join(
      logDir,
      `${logBaseName}.${loggerConfig.maxFiles - 1}${logExt}`,
    );
    if (fs.existsSync(oldestFile)) {
      fs.unlinkSync(oldestFile);
    }

    // Décaler tous les fichiers
    for (let i = loggerConfig.maxFiles - 2; i >= 1; i--) {
      const currentFile = path.join(logDir, `${logBaseName}.${i}${logExt}`);
      const nextFile = path.join(logDir, `${logBaseName}.${i + 1}${logExt}`);

      if (fs.existsSync(currentFile)) {
        fs.renameSync(currentFile, nextFile);
      }
    }

    // Renommer le fichier actuel
    const firstBackup = path.join(logDir, `${logBaseName}.1${logExt}`);
    if (fs.existsSync(loggerConfig.logFilePath)) {
      fs.renameSync(loggerConfig.logFilePath, firstBackup);
    }
  } catch (error) {
    console.error("Erreur lors de la rotation des logs:", error);
  }
};

/**
 * Crée l'instance du logger
 */
const createLogger = (): Logger => {
  return {
    debug: (message: string, context?: LogContext): void => {
      if (shouldLog("debug")) {
        const formattedMessage = formatMessage("debug", message, context);
        const colorizedMessage = colorizeMessage("debug", formattedMessage);

        console.debug(colorizedMessage);
        writeToFile(formattedMessage);
      }
    },

    info: (message: string, context?: LogContext): void => {
      if (shouldLog("info")) {
        const formattedMessage = formatMessage("info", message, context);
        const colorizedMessage = colorizeMessage("info", formattedMessage);

        console.info(colorizedMessage);
        writeToFile(formattedMessage);
      }
    },

    warn: (message: string, context?: LogContext): void => {
      if (shouldLog("warn")) {
        const formattedMessage = formatMessage("warn", message, context);
        const colorizedMessage = colorizeMessage("warn", formattedMessage);

        console.warn(colorizedMessage);
        writeToFile(formattedMessage);
      }
    },

    error: (message: string, error?: Error, context?: LogContext): void => {
      if (shouldLog("error")) {
        const errorContext = error
          ? { ...context, errorMessage: error.message, stack: error.stack }
          : context;

        const formattedMessage = formatMessage("error", message, errorContext);
        const colorizedMessage = colorizeMessage("error", formattedMessage);

        console.error(colorizedMessage);
        writeToFile(formattedMessage);
      }
    },

    setLevel: (level: LogLevel): void => {
      loggerConfig.level = level;
    },

    setConfig: (config: Partial<LoggerConfig>): void => {
      loggerConfig = { ...loggerConfig, ...config };
    },
  };
};

// Instance singleton du logger
let logger: Logger;

/**
 * Initialise le logger avec la configuration fournie
 */
export const initializeLogger = (config: Partial<LoggerConfig>): void => {
  loggerConfig = { ...DEFAULT_CONFIG, ...config };

  // Créer le répertoire de log si nécessaire
  if (loggerConfig.fileOutput && loggerConfig.logFilePath) {
    const logDir = path.dirname(loggerConfig.logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  // Créer ou mettre à jour l'instance du logger
  if (!logger) {
    logger = createLogger();
  } else {
    logger.setConfig(loggerConfig);
  }
};

/**
 * Obtient l'instance du logger
 */
export const getLogger = (): Logger => {
  if (!logger) {
    logger = createLogger();
  }
  return logger;
};

/**
 * Crée un logger avec un contexte spécifique (pour les acteurs par exemple)
 */
export const createContextualLogger = (source: string): Logger => {
  const baseLogger = getLogger();

  return {
    debug: (message: string, context?: LogContext) => {
      const enhancedContext = { ...context, source };
      baseLogger.debug(message, enhancedContext);
    },

    info: (message: string, context?: LogContext) => {
      const enhancedContext = { ...context, source };
      baseLogger.info(message, enhancedContext);
    },

    warn: (message: string, context?: LogContext) => {
      const enhancedContext = { ...context, source };
      baseLogger.warn(message, enhancedContext);
    },

    error: (message: string, error?: Error, context?: LogContext) => {
      const enhancedContext = { ...context, source };
      baseLogger.error(message, error, enhancedContext);
    },

    setLevel: baseLogger.setLevel,
    setConfig: baseLogger.setConfig,
  };
};

// Utilitaires de logging spécialisés
export const loggerUtils = {
  /**
   * Log les performances d'une fonction
   */
  logPerformance: async <T>(
    operation: string,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const logger = getLogger();
    const startTime = Date.now();

    logger.debug(`Début de l'opération: ${operation}`);

    try {
      const result = await fn();
      const duration = Date.now() - startTime;

      logger.debug(`Opération terminée: ${operation}`, {
        duration_ms: duration,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error(`Échec de l'opération: ${operation}`, error as Error, {
        duration_ms: duration,
      });

      throw error;
    }
  },

  /**
   * Log l'état d'un acteur
   */
  logActorState: (actorId: string, state: unknown, action?: string): void => {
    const logger = getLogger();
    const sanitizedState = logging.sanitize(state);
    logger.debug(`Actor [${actorId}] ${action ? `${action}: ` : ""}`, {
      actorId,
      action,
      state: sanitizedState,
      timestamp: new Date().toISOString(),
    });
  },

  /**
   * Log une transaction de trading
   */
  logTrade: (
    action:
      | "order_placed"
      | "order_filled"
      | "order_cancelled"
      | "position_opened"
      | "position_closed",
    details: any,
  ): void => {
    const logger = getLogger();
    const sanitizedDetails = logging.sanitize(details);

    logger.info(`Action de trading: ${action}`, sanitizedDetails);
  },
};
