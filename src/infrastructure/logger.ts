import { ConfigType } from "../config/config";
import * as fs from "fs";
import * as path from "path";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LoggerOptions {
  level: LogLevel;
  fileOutput: boolean;
  logFilePath?: string;
}

interface Logger {
  debug: (message: string, context?: Record<string, any>) => void;
  info: (message: string, context?: Record<string, any>) => void;
  warn: (message: string, context?: Record<string, any>) => void;
  error: (message: string, error?: Error, context?: Record<string, any>) => void;
}

// Configuration state for the logger
let loggerConfig: LoggerOptions = {
  level: "info",
  fileOutput: false,
};

// Level priority mapping
const levelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Helper functions
const shouldLog = (messageLevel: LogLevel): boolean => {
  return levelPriority[messageLevel] >= levelPriority[loggerConfig.level];
};

const formatMessage = (level: LogLevel, message: string, context?: Record<string, any>): string => {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(context)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}]: ${message}${contextStr}`;
};

const writeToFile = (message: string): void => {
  if (loggerConfig.fileOutput && loggerConfig.logFilePath) {
    fs.appendFileSync(loggerConfig.logFilePath, message + "\n");
  }
};

// Logger implementation
export const createLogger = (): Logger => {
  return {
    debug: (message: string, context?: Record<string, any>): void => {
      if (shouldLog("debug")) {
        const formattedMessage = formatMessage("debug", message, context);
        console.debug(formattedMessage);
        writeToFile(formattedMessage);
      }
    },
    
    info: (message: string, context?: Record<string, any>): void => {
      if (shouldLog("info")) {
        const formattedMessage = formatMessage("info", message, context);
        console.info(formattedMessage);
        writeToFile(formattedMessage);
      }
    },
    
    warn: (message: string, context?: Record<string, any>): void => {
      if (shouldLog("warn")) {
        const formattedMessage = formatMessage("warn", message, context);
        console.warn(formattedMessage);
        writeToFile(formattedMessage);
      }
    },
    
    error: (message: string, error?: Error, context?: Record<string, any>): void => {
      if (shouldLog("error")) {
        const errorContext = error 
          ? { ...context, errorMessage: error.message, stack: error.stack }
          : context;
        
        const formattedMessage = formatMessage("error", message, errorContext);
        console.error(formattedMessage);
        writeToFile(formattedMessage);
      }
    }
  };
};

// Singleton instance
let logger: Logger;

export const initializeLogger = (config: ConfigType): void => {
  // Ensure log directory exists if file output is enabled
  if (config.logging.fileOutput && config.logging.logFilePath) {
    const logDir = path.dirname(config.logging.logFilePath);
    if (!fs.existsSync(logDir)) {
      // @ts-ignore - TypeScript ne reconnaît pas l'option recursive dans cette version
      fs.mkdirSync(logDir, { recursive: true });
    }
  }
  
  // Update logger configuration
  loggerConfig = {
    level: config.logging.level as LogLevel,
    fileOutput: config.logging.fileOutput,
    logFilePath: config.logging.logFilePath,
  };
  
  // Create a new logger instance
  logger = createLogger();
};

export const getLogger = (): Logger => {
  if (!logger) {
    // Create default logger if not initialized
    logger = createLogger();
  }
  return logger;
};