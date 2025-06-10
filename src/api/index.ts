import express from 'express';
import { createBacktestApiAdapter } from '../adapters/primary/backtest-api.adapter';
import { createContextualLogger } from '../infrastructure/logging/enhanced-logger';
import { createStrategyService } from '../domain/services/strategy.service';
import cors from 'cors';

const logger = createContextualLogger('VercelAPI');

// Créer l'application Express
const app = express();

// Middleware de base
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialiser les services
const strategyService = createStrategyService();

// Initialiser quelques stratégies par défaut pour les démonstrations
try {
  // Nous utiliserons des stratégies factices pour l'API de démonstration
  // car les vraies stratégies nécessitent des configurations complexes
  const mockStrategies = [
    {
      id: 'rsi-divergence',
      name: 'RSI Divergence',
      type: 'technical',
      description: 'Stratégie basée sur les divergences RSI',
      config: { rsiPeriod: 14, divergenceWindow: 20 }
    },
    {
      id: 'volume-analysis', 
      name: 'Volume Analysis',
      type: 'volume',
      description: 'Analyse des volumes de trading',
      config: { volumeThreshold: 1.5, window: 10 }
    },
    {
      id: 'elliott-wave',
      name: 'Elliott Wave',
      type: 'pattern',
      description: 'Reconnaissance de patterns Elliott Wave',
      config: { waveLength: 50, fibonacciLevels: [0.236, 0.382, 0.618] }
    }
  ];

  // Pour l'API de démonstration, nous créons des objets mock qui implémentent l'interface Strategy
  mockStrategies.forEach(mockStrategy => {
    const strategy = {
      getId: () => mockStrategy.id,
      getName: () => mockStrategy.name,
      getType: () => mockStrategy.type,
      getConfig: () => mockStrategy.config,
      processMarketData: async () => null,
      generateOrder: () => null,
      updateConfig: () => {},
      reset: () => {},
      getPerformanceMetrics: () => ({ totalTrades: 0, winRate: 0, totalReturn: 0 })
    };
    strategyService.registerStrategy(strategy as any);
  });
  
  logger.info(`Initialized ${mockStrategies.length} demo strategies for API`);
} catch (error) {
  logger.warn('Failed to initialize demo strategies:', error as Error);
}

// Routes de base
app.get('/', (req, res) => {
  res.json({
    name: 'Lukaya Trading Bot API',
    version: '1.0.0',
    description: 'API pour le bot de trading Lukaya avec fonctionnalités de backtesting',
    status: 'running',
    endpoints: {
      health: '/api/health',
      backtest: '/api/backtest',
      strategies: '/api/strategies'
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Route pour lister les stratégies disponibles
app.get('/api/strategies', (req, res) => {
  try {
    const strategies = strategyService.getAllStrategies();
    const strategiesList = Object.values(strategies).map((strategy: any) => ({
      id: strategy.getId(),
      name: strategy.getName(),
      type: strategy.getType(),
      description: strategy.getConfig().description || 'Aucune description disponible'
    }));
    
    res.json({
      strategies: strategiesList,
      count: strategiesList.length
    });
  } catch (error) {
    logger.error('Erreur lors de la récupération des stratégies:', error as Error);
    res.status(500).json({
      error: 'Erreur lors de la récupération des stratégies',
      message: (error as Error).message
    });
  }
});

// Monter les routes de backtesting
app.use('/api/backtest', createBacktestApiAdapter(strategyService));

// Route de capture pour les erreurs 404
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route non trouvée',
    path: req.originalUrl,
    method: req.method,
    availableRoutes: [
      'GET /',
      'GET /api/health',
      'GET /api/strategies',
      'POST /api/backtest/run',
      'POST /api/backtest/compare',
      'POST /api/backtest/optimize'
    ]
  });
});

// Gestionnaire d'erreurs global
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Erreur non gérée dans l\'API:', error);
  
  if (res.headersSent) {
    return next(error);
  }
  
  res.status(500).json({
    error: 'Erreur interne du serveur',
    message: process.env.NODE_ENV === 'production' ? 'Une erreur inattendue s\'est produite' : error.message,
    timestamp: new Date().toISOString()
  });
});

// Pour le développement local
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    logger.info(`API de développement démarrée sur le port ${PORT}`);
    console.log(`🚀 API disponible sur http://localhost:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log(`🎯 Strategies: http://localhost:${PORT}/api/strategies`);
  });
}

// Export pour Vercel
export default app;
