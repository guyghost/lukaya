import { OrderSide } from '../../../domain/models/market.model';
import { PositionRisk } from '../risk-manager/risk-manager.model';

/**
 * Configuration pour un niveau de prise de profit
 */
export interface ProfitTier {
  // Pourcentage de profit auquel ce niveau est déclenché
  profitPercentage: number;
  // Pourcentage de la position à fermer à ce niveau
  closePercentage: number;
}

/**
 * Configuration pour le gestionnaire de prise de profit
 */
export interface TakeProfitConfig {
  // Activer/désactiver le gestionnaire
  enabled: boolean;
  // Niveaux de prise de profit configurés
  profitTiers: ProfitTier[];
  // Temps de pause minimum (ms) entre deux prises de profit
  cooldownPeriod: number;
  // Tolérance en pourcentage pour éviter les déclenchements multiples à cause de volatilité
  priceTolerance: number;
  // Activer le mode trailing pour les prises de profit
  trailingMode: boolean;
  // Limiter la taille minimale des ordres de prise de profit 
  // (en pourcentage de la taille initiale de la position)
  minOrderSizePercent: number;
}

/**
 * État d'une position pour la prise de profit
 */
export interface PositionProfitState {
  // Symbole du marché
  symbol: string;
  // L'entrée était-elle long ou short
  direction: 'long' | 'short';
  // Taille initiale de la position
  initialSize: number;
  // Taille actuelle de la position
  currentSize: number;
  // Prix d'entrée moyen
  entryPrice: number;
  // Niveaux de prise de profit déjà déclenchés
  triggeredTiers: number[];
  // Prix le plus favorable atteint (utilisé pour le trailing take profit)
  highWatermark: number;
  // Horodatage de la dernière prise de profit
  lastTakeProfit: number;
}

/**
 * État global du gestionnaire de prise de profit
 */
export interface TakeProfitState {
  config: TakeProfitConfig;
  positions: Record<string, PositionProfitState>;
}

/**
 * Résultat d'une analyse de prise de profit
 */
export interface TakeProfitAnalysisResult {
  // Indique si une action de prise de profit doit être exécutée
  shouldTakeProfit: boolean;
  // Niveau de prise de profit déclenché
  triggerTier?: number;
  // Taille de l'ordre à exécuter
  orderSize?: number;
  // Symbole de la position
  symbol: string;
  // Direction de l'ordre (inverse de la position)
  orderSide?: OrderSide;
  // Raison de la décision
  reason: string;
  // Prix cible pour l'ordre
  targetPrice?: number;
  // Pourcentage de profit actuel
  currentProfitPercentage?: number;
}

/**
 * Messages pour le gestionnaire de prise de profit
 */
export type TakeProfitMessage =
  | { type: 'UPDATE_CONFIG'; config: Partial<TakeProfitConfig> }
  | { type: 'POSITION_OPENED'; position: PositionRisk }
  | { type: 'POSITION_UPDATED'; position: PositionRisk }
  | { type: 'POSITION_CLOSED'; symbol: string }
  | { type: 'MARKET_UPDATE'; symbol: string; price: number }
  | { type: 'ANALYZE_POSITION'; symbol: string; currentPrice: number }
  | { type: 'GET_POSITION_STATE'; symbol: string }
  | { type: 'GET_ALL_POSITIONS' };

/**
 * Port pour le gestionnaire de prise de profit
 */
export interface TakeProfitPort {
  updateConfig(config: Partial<TakeProfitConfig>): Promise<void>;
  positionOpened(position: PositionRisk): Promise<void>;
  positionUpdated(position: PositionRisk): Promise<void>;
  positionClosed(symbol: string): Promise<void>;
  analyzePosition(symbol: string, currentPrice: number): Promise<TakeProfitAnalysisResult>;
  getPositionState(symbol: string): Promise<PositionProfitState | null>;
  getAllPositions(): Promise<Record<string, PositionProfitState>>;
}