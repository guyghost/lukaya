/**
 * Types d'erreurs métier pour standardiser la gestion d'erreurs
 */

// Erreur de base pour les erreurs métier de l'application
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppError';
  }
}

// Erreur de validation (paramètres incorrects, configuration invalide, etc.)
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Erreur d'authentification (clés API invalides, etc.)
export class AuthenticationError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

// Erreur de trading (ordre rejeté par l'exchange, etc.)
export class TradingError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = 'TradingError';
  }
}

// Erreur de marché (symbole non supporté, données manquantes, etc.)
export class MarketError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = 'MarketError';
  }
}

// Erreur de stratégie (paramètres invalides, calculs impossibles, etc.)
export class StrategyError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = 'StrategyError';
  }
}

// Erreur technique (IO, réseau, etc.)
export class TechnicalError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = 'TechnicalError';
  }
}

// Erreur non gérée/inattendue
export class UnexpectedError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = 'UnexpectedError';
  }
}
