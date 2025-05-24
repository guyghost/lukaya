import { ActorSystem } from "../../actor/models/actor.model";
import { RiskManagerPort } from "../actors/risk-manager/risk-manager.model";
import { TakeProfitPort } from "../actors/take-profit-manager/take-profit-manager.model";
import { createTakeProfitManagerActorDefinition } from "../actors/take-profit-manager/take-profit-manager.actor";
import { TradingPort } from "../ports/trading.port";
import { MarketDataPort } from "../ports/market-data.port";
import { getLogger } from "../../infrastructure/logger";

/**
 * Configuration pour l'intégrateur de prise de profits
 */
export interface TakeProfitIntegratorConfig {
  // Intervalle (en ms) pour vérifier les mises à jour de prix
  priceCheckInterval: number;
  // Intervalle (en ms) pour vérifier les positions ouvertes
  positionCheckInterval: number;
  // Symboles de marché à surveiller (si vide, tous les symboles avec positions seront surveillés)
  watchedSymbols?: string[];
}

export const createTakeProfitIntegrator = (
  actorSystem: ActorSystem,
  tradingPort: TradingPort,
  marketDataPort: MarketDataPort,
  riskManagerPort: RiskManagerPort,
  config?: Partial<TakeProfitIntegratorConfig>
) => {
  const logger = getLogger();
  
  // Configuration par défaut
  const defaultConfig: TakeProfitIntegratorConfig = {
    priceCheckInterval: 30 * 1000, // 30 secondes
    positionCheckInterval: 2 * 60 * 1000, // 2 minutes
  };
  
  // Fusionner avec la configuration fournie
  const mergedConfig: TakeProfitIntegratorConfig = {
    ...defaultConfig,
    ...config,
  };
  
  // Créer l'acteur de gestion de prise de profits
  const takeProfitManagerActor = actorSystem.createActor(
    createTakeProfitManagerActorDefinition(tradingPort)
  );
  
  // Créer un proxy pour interagir avec l'acteur
  const takeProfitManager: TakeProfitPort = {
    updateConfig: async (config) => {
      actorSystem.send(takeProfitManagerActor, { type: "UPDATE_CONFIG", config });
    },
    positionOpened: async (position) => {
      actorSystem.send(takeProfitManagerActor, { type: "POSITION_OPENED", position });
    },
    positionUpdated: async (position) => {
      actorSystem.send(takeProfitManagerActor, { type: "POSITION_UPDATED", position });
    },
    positionClosed: async (symbol) => {
      actorSystem.send(takeProfitManagerActor, { type: "POSITION_CLOSED", symbol });
    },
    analyzePosition: async (symbol, currentPrice) => {
      // Ceci est une simplification car nous n'avons pas d'API "ask" dans notre actorSystem
      // Dans un cas réel, nous devrions attendre une réponse
      actorSystem.send(takeProfitManagerActor, { type: "ANALYZE_POSITION", symbol, currentPrice });
      return { shouldTakeProfit: false, symbol, reason: "Analyse non implémentée" };
    },
    getPositionState: async (symbol) => {
      // Simplification
      return null;
    },
    getAllPositions: async () => {
      // Simplification
      return {};
    },
    getTakeProfitStatus: async (symbol) => {
      // Simplification - dans une implémentation réelle, nous ferions un appel à l'acteur
      return {
        symbol,
        status: [
          { level: 1, percentage: 3, triggered: false, currentProfit: null },
          { level: 2, percentage: 5, triggered: false, currentProfit: null },
          { level: 3, percentage: 7, triggered: false, currentProfit: null },
        ],
        enabled: true,
        trailingMode: false
      };
    }
  };
  
  // Map pour suivre les symboles surveillés
  const watchedSymbols = new Set<string>(mergedConfig.watchedSymbols || []);
  
  // Interval IDs pour les vérifications périodiques
  let priceCheckIntervalId: any = null;
  let positionCheckIntervalId: any = null;
  
  // Mettre à jour les positions depuis le gestionnaire de risque
  const updatePositionsFromRiskManager = async () => {
    try {
      const accountRisk = await riskManagerPort.getAccountRisk();
      
      // Mettre à jour chaque position
      for (const position of accountRisk.positions) {
        // Ajouter à la liste des symboles surveillés
        watchedSymbols.add(position.symbol);
        
        // Notifier le gestionnaire de prise de profits
        await takeProfitManager.positionUpdated(position);
      }
      
      // Récupérer toutes les positions connues du gestionnaire de prise de profits
      const knownPositions = await takeProfitManager.getAllPositions();
      
      // Vérifier si des positions ont été fermées
      for (const symbol in knownPositions) {
        const isStillOpen = accountRisk.positions.some(p => p.symbol === symbol);
        if (!isStillOpen) {
          // Position fermée, notifier le gestionnaire
          await takeProfitManager.positionClosed(symbol);
          
          // Si ce n'est pas dans la liste watchedSymbols spécifiée par l'utilisateur, le retirer
          if (!mergedConfig.watchedSymbols?.includes(symbol)) {
            watchedSymbols.delete(symbol);
          }
        }
      }
    } catch (error) {
      logger.error("Erreur lors de la mise à jour des positions:", error as Error);
    }
  };
  
  // Vérifier les mises à jour de prix pour les symboles surveillés
  const checkPriceUpdates = async () => {
    for (const symbol of watchedSymbols) {
      try {
        // Obtenir le dernier prix du marché
        const marketData = await marketDataPort.getLatestMarketData(symbol);
        
        // Notifier le gestionnaire de prise de profits
        await takeProfitManager.analyzePosition(symbol, marketData.price);
      } catch (error) {
        logger.error(`Erreur lors de la vérification du prix pour ${symbol}:`, error as Error);
      }
    }
  };
  
  // Démarrer la surveillance
  const start = () => {
    // Initialiser les positions
    updatePositionsFromRiskManager();
    
    // Démarrer les vérifications périodiques
    if (!priceCheckIntervalId) {
      priceCheckIntervalId = setInterval(checkPriceUpdates, mergedConfig.priceCheckInterval);
    }
    
    if (!positionCheckIntervalId) {
      positionCheckIntervalId = setInterval(
        updatePositionsFromRiskManager,
        mergedConfig.positionCheckInterval
      );
    }
    
    logger.info("Intégrateur de prise de profits démarré");
  };
  
  // Arrêter la surveillance
  const stop = () => {
    if (priceCheckIntervalId) {
      clearInterval(priceCheckIntervalId);
      priceCheckIntervalId = null;
    }
    
    if (positionCheckIntervalId) {
      clearInterval(positionCheckIntervalId);
      positionCheckIntervalId = null;
    }
    
    logger.info("Intégrateur de prise de profits arrêté");
  };
  
  // Surveiller un symbole spécifique
  const watchSymbol = (symbol: string) => {
    watchedSymbols.add(symbol);
  };
  
  // Arrêter la surveillance d'un symbole
  const unwatchSymbol = (symbol: string) => {
    watchedSymbols.delete(symbol);
  };
  
  return {
    start,
    stop,
    watchSymbol,
    unwatchSymbol,
    takeProfitManager,
  };
};