import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { BacktestConfig } from './backtest-models';
import { BacktestEngine } from './backtest-engine';
import { getLogger } from '../logger';
import { createSimpleMAStrategy } from '../../adapters/primary/simple-ma.strategy';
import { Strategy } from '../../domain/models/strategy.model';

const logger = getLogger();

/**
 * CLI pour exécuter les backtests
 */
export const createBacktestCLI = () => {
  const program = new Command();
  
  program
    .name('lukaya-backtest')
    .description('Système de backtesting pour le bot de trading Lukaya')
    .version('1.0.0');
  
  program
    .command('run')
    .description('Exécute un backtest avec la configuration spécifiée')
    .option('-c, --config <path>', 'Chemin vers le fichier de configuration JSON')
    .option('-s, --start-date <date>', 'Date de début (YYYY-MM-DD)')
    .option('-e, --end-date <date>', 'Date de fin (YYYY-MM-DD)')
    .option('-b, --balance <number>', 'Solde initial')
    .option('-o, --output <path>', 'Chemin de sortie pour les résultats')
    .option('-m, --high-risk', 'Activer le mode à haut risque')
    .option('-r, --report-only', 'Générer uniquement un rapport (nécessite des résultats sauvegardés)')
    .action(async (options: {
      reportOnly?: boolean;
      config?: string;
      startDate?: string;
      endDate?: string;
      balance?: string;
      output?: string;
      highRisk?: boolean;
    }) => {
      try {
        if (options.reportOnly) {
          return await generateReportOnly(options);
        }
        
        // Charger la configuration
        let config: BacktestConfig;
        
        if (options.config) {
          // Charger depuis un fichier JSON
          const configPath = path.resolve(process.cwd(), options.config);
          if (!fs.existsSync(configPath)) {
            logger.error(`Le fichier de configuration n'existe pas: ${configPath}`);
            process.exit(1);
          }
          
          const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          config = {
            ...rawConfig,
            startDate: new Date(rawConfig.startDate),
            endDate: new Date(rawConfig.endDate)
          };
        } else {
          // Utiliser les options de ligne de commande ou des dates fixes pour s'assurer qu'elles correspondent aux données CSV (2023)
          const defaultStartDate = new Date('2023-01-01T00:00:00.000Z');
          const defaultEndDate = new Date('2023-02-01T00:00:00.000Z');
          
          const startDate = options.startDate ? new Date(options.startDate) : defaultStartDate;
          const endDate = options.endDate ? new Date(options.endDate) : defaultEndDate;
          
          config = {
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            highRiskMode: options.highRisk || false,
            dataOptions: {
              dataSource: 'csv',
              dataPath: path.resolve(process.cwd(), 'data'),
              timeframe: '1h',
            },
            tradingOptions: {
              initialBalance: options.balance ? parseFloat(options.balance) : 10000,
              tradingFees: 0.1,
              slippage: 0.05,
              maxFundsPerOrder: 0.1,
            },
            riskConfig: {
              maxRiskPerTrade: options.highRisk ? 0.03 : 0.01,
              maxOpenPositions: 5,
              maxPositionSize: 5,
              maxDrawdownPercent: options.highRisk ? 25.0 : 10.0,
              maxLeverage: options.highRisk ? 2.0 : 1.0,
              stopLossPercent: options.highRisk ? 5.0 : 2.0,
              takeProfitPercent: options.highRisk ? 10.0 : 5.0,
              accountSize: options.balance ? parseFloat(options.balance) : 10000,
              maxDailyLoss: options.highRisk ? 500 : 200,
              diversificationWeight: 0.5,
              volatilityAdjustment: true
            },
            takeProfitConfig: {
              enabled: true,
              trailingMode: true,
              cooldownPeriod: 60000,
              priceTolerance: 0.1,
              minOrderSizePercent: 5.0,
              profitTiers: [
                { profitPercentage: 1.0, closePercentage: 25 },
                { profitPercentage: 2.0, closePercentage: 25 },
                { profitPercentage: 5.0, closePercentage: 25 },
                { profitPercentage: 10.0, closePercentage: 25 },
              ]
            }
          };
        }
        
        // Exécuter le backtest
        logger.info(`Démarrage du backtest du ${config.startDate.toISOString()} au ${config.endDate.toISOString()}`);
        
        const engine = new BacktestEngine(config);
        
        // Configuration de stratégies avec davantage de paramètres d'entrée pour une plus grande sensibilité
        const strategies = [
          createSimpleMAStrategy({
            symbol: 'BTC_USD', // Utiliser le format exact du fichier CSV
            shortPeriod: 8,
            longPeriod: 21,
            positionSize: 0.1,
            useBollinger: true,
            bollingerPeriod: 20,
            bollingerStdDev: 2,
            useMACD: true,
            macdFastPeriod: 8,
            macdSlowPeriod: 21,
            macdSignalPeriod: 5,
            // Paramètres RSI moins restrictifs pour générer plus de signaux
            useRSI: true,
            rsiPeriod: 14,
            rsiOversold: 45,  // Moins restrictif (normalement 30)
            rsiOverbought: 55 // Moins restrictif (normalement 70)
          }),
          createSimpleMAStrategy({
            symbol: 'ETH_USD', // Utiliser le format exact du fichier CSV
            shortPeriod: 8,
            longPeriod: 21,
            positionSize: 0.1,
            useBollinger: true,
            bollingerPeriod: 20,
            bollingerStdDev: 2,
            useMACD: true,
            macdFastPeriod: 8,
            macdSlowPeriod: 21,
            macdSignalPeriod: 5,
            // Paramètres RSI moins restrictifs pour générer plus de signaux
            useRSI: true,
            rsiPeriod: 14,
            rsiOversold: 45,  // Moins restrictif (normalement 30)
            rsiOverbought: 55 // Moins restrictif (normalement 70)
          }),
        ];
        
        // Exécuter le backtest
        const results = await engine.run(strategies);
        
        // Générer un rapport
        const report = await engine.generateReport();
        logger.info(report);
        
        // Sauvegarder les résultats si un chemin de sortie est spécifié
        if (options.output) {
          const outputPath = path.resolve(process.cwd(), options.output);
          fs.writeFileSync(outputPath, JSON.stringify({
            config,
            results,
            report
          }, null, 2));
          
          logger.info(`Résultats sauvegardés dans: ${outputPath}`);
        }
        
      } catch (error) {
        logger.error('Erreur lors du backtest', error instanceof Error ? error : String(error));
        process.exit(1);
      }
    });
    
  program
    .command('compare')
    .description('Compare les résultats de plusieurs configurations de backtest')
    .option('-d, --directory <path>', 'Répertoire contenant les fichiers de configuration de backtest')
    .option('-o, --output <path>', 'Chemin de sortie pour le rapport de comparaison')
    .action(async (options: {
      directory?: string;
      output?: string;
    }) => {
      try {
        const directory = path.resolve(process.cwd(), options.directory || 'backtest-configs');
        
        if (!fs.existsSync(directory)) {
          logger.error(`Le répertoire n'existe pas: ${directory}`);
          process.exit(1);
        }
        
        const configFiles = fs.readdirSync(directory)
          .filter(file => file.endsWith('.json'))
          .map(file => path.join(directory, file));
          
        if (configFiles.length === 0) {
          logger.error(`Aucun fichier de configuration trouvé dans ${directory}`);
          process.exit(1);
        }
        
        logger.info(`Comparaison de ${configFiles.length} configurations de backtest...`);
        
        // Résultats de toutes les simulations
        const allResults: Array<{
          configName: string;
          config: BacktestConfig;
          results: any;
          report: string;
        }> = [];
        
        // Exécuter chaque backtest
        for (const configFile of configFiles) {
          const configName = path.basename(configFile, '.json');
          logger.info(`Exécution du backtest pour ${configName}...`);
          
          const rawConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
          const config: BacktestConfig = {
            ...rawConfig,
            startDate: new Date(rawConfig.startDate),
            endDate: new Date(rawConfig.endDate)
          };
          const engine = new BacktestEngine(config);
          
          // Créer des instances de stratégies pour le backtest (les mêmes pour tous)
          const strategies = [
            createSimpleMAStrategy({
              symbol: 'BTC-USD',
              shortPeriod: 8,
              longPeriod: 21,
              positionSize: 0.1,
              useBollinger: true,
              bollingerPeriod: 20,
              bollingerStdDev: 2,
              useMACD: true,
              macdFastPeriod: 8,
              macdSlowPeriod: 21,
              macdSignalPeriod: 5
            }),
            // Utiliser les mêmes stratégies pour tous les tests de comparaison
          ];
          
          // Exécuter le backtest
          const results = await engine.run(strategies);
          const report = await engine.generateReport();
          
          allResults.push({
            configName,
            config,
            results,
            report
          });
        }
        
        // Générer un rapport de comparaison
        let comparisonReport = "=== RAPPORT DE COMPARAISON DES BACKTESTS ===\n\n";
        
        // Tableau de comparaison des métriques clés
        comparisonReport += "| Configuration | Profit (%) | Profit ($) | Win Rate | Profit Factor | Drawdown Max (%) | Exposition (%)\n";
        comparisonReport += "|--------------|-----------|-----------|---------|--------------|-----------------|-------------|\n";
        
        allResults.sort((a, b) => b.results.profitPercentage - a.results.profitPercentage);
        
        for (const result of allResults) {
          comparisonReport += `| ${result.configName} | ${result.results.profitPercentage.toFixed(2)}% | $${result.results.profit.toFixed(2)} | ${result.results.winRate.toFixed(2)}% | ${result.results.profitFactor.toFixed(2)} | ${result.results.maxDrawdownPercentage.toFixed(2)}% | ${result.results.averageExposure.toFixed(2)}% |\n`;
        }
        
        comparisonReport += "\n=== ANALYSE DÉTAILLÉE ===\n\n";
        
        for (const result of allResults) {
          comparisonReport += `=== ${result.configName} ===\n`;
          comparisonReport += `Période: ${result.config.startDate.toISOString()} à ${result.config.endDate.toISOString()}\n`;
          comparisonReport += `Mode haut risque: ${result.config.highRiskMode ? 'Activé' : 'Désactivé'}\n`;
          comparisonReport += `Solde initial: $${result.config.tradingOptions.initialBalance}\n`;
          comparisonReport += `Solde final: $${result.results.finalBalance.toFixed(2)}\n`;
          comparisonReport += `Trades: ${result.results.trades.length} (${result.results.winningTrades} gagnants, ${result.results.losingTrades} perdants)\n`;
          comparisonReport += `Win Rate: ${result.results.winRate.toFixed(2)}%\n`;
          comparisonReport += `Profit Factor: ${result.results.profitFactor.toFixed(2)}\n\n`;
        }
        
        logger.info(comparisonReport);
        
        // Sauvegarder le rapport de comparaison si un chemin de sortie est spécifié
        if (options.output) {
          const outputPath = path.resolve(process.cwd(), options.output);
          fs.writeFileSync(outputPath, comparisonReport);
          logger.info(`Rapport de comparaison sauvegardé dans: ${outputPath}`);
          
          // Sauvegarder les données brutes pour référence
          const dataOutputPath = outputPath.replace(/\.[^/.]+$/, '') + '-data.json';
          fs.writeFileSync(dataOutputPath, JSON.stringify(allResults, null, 2));
          logger.info(`Données de comparaison sauvegardées dans: ${dataOutputPath}`);
        }
        
      } catch (error) {
        logger.error('Erreur lors de la comparaison des backtests', error instanceof Error ? error : String(error));
        process.exit(1);
      }
    });
    
  program
    .command('optimize')
    .description('Optimise les paramètres de stratégie avec backtesting')
    .option('-c, --config <path>', 'Chemin vers le fichier de configuration de base JSON')
    .option('-s, --strategy <name>', 'Nom de la stratégie à optimiser (simple_ma)', 'simple_ma')
    .option('-o, --output <path>', 'Chemin de sortie pour les résultats d\'optimisation')
    .action(async (options: {
      config?: string;
      strategy?: string;
      output?: string;
    }) => {
      try {
        // Charger la configuration de base
        const configPath = path.resolve(process.cwd(), options.config || 'backtest-config.json');
        
        if (!fs.existsSync(configPath)) {
          logger.error(`Le fichier de configuration n'existe pas: ${configPath}`);
          process.exit(1);
        }
        
        const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const baseConfig: BacktestConfig = {
          ...rawConfig,
          startDate: new Date(rawConfig.startDate),
          endDate: new Date(rawConfig.endDate)
        };
        
        // Générer des combinaisons de paramètres
        const paramCombinations = [];
        
        // Pour SimpleMA, optimiser les périodes MA et Bollinger
        if (options.strategy === 'simple_ma') {
          // Valeurs à tester pour chaque paramètre
          const shortPeriodValues = [5, 8, 13, 21];
          const longPeriodValues = [13, 21, 34, 55];
          const signalLineValues = [3, 5, 8, 13];
          const bollingerPeriodValues = [14, 20, 30];
          const bollingerStdDevValues = [1.5, 2, 2.5, 3];
          
          // Générer toutes les combinaisons possibles (attention: ça peut faire beaucoup de tests)
          for (const shortPeriod of shortPeriodValues) {
            for (const longPeriod of longPeriodValues) {
              // Éviter les combinaisons illogiques
              if (shortPeriod >= longPeriod) continue;
              
              for (const signalLine of signalLineValues) {
                for (const bollingerPeriod of bollingerPeriodValues) {
                  for (const bollingerStdDev of bollingerStdDevValues) {
                    paramCombinations.push({
                      shortPeriod,
                      longPeriod,
                      signalLine,
                      bollingerPeriod,
                      bollingerStdDev
                    });
                  }
                }
              }
            }
          }
        }
        
        logger.info(`Début de l'optimisation avec ${paramCombinations.length} combinaisons de paramètres...`);
        
        const optimizationResults = [];
        
        // Exécuter un backtest pour chaque combinaison
        for (let i = 0; i < paramCombinations.length; i++) {
          const params = paramCombinations[i];
          logger.info(`Test de la combinaison ${i+1}/${paramCombinations.length}: ${JSON.stringify(params)}`);
          
          // Créer une stratégie avec ces paramètres
          const strategy = createSimpleMAStrategy({
            symbol: 'BTC-USD',
            shortPeriod: params.shortPeriod,
            longPeriod: params.longPeriod,
            positionSize: 0.1,
            useBollinger: true,
            bollingerPeriod: params.bollingerPeriod,
            bollingerStdDev: params.bollingerStdDev,
            useMACD: true,
            macdFastPeriod: params.shortPeriod,
            macdSlowPeriod: params.longPeriod,
            macdSignalPeriod: params.signalLine
          });
          
          // Configurer et exécuter le backtest
          const engine = new BacktestEngine(baseConfig);
          const results = await engine.run([strategy]);
          
          optimizationResults.push({
            params,
            results: {
              profit: results.profit,
              profitPercentage: results.profitPercentage,
              winRate: results.winRate,
              profitFactor: results.profitFactor,
              maxDrawdownPercentage: results.maxDrawdownPercentage,
            }
          });
        }
        
        // Trier par profit décroissant
        optimizationResults.sort((a, b) => b.results.profitPercentage - a.results.profitPercentage);
        
        // Afficher les meilleurs résultats
        logger.info("=== TOP 10 COMBINAISONS DE PARAMÈTRES ===");
        
        for (let i = 0; i < Math.min(10, optimizationResults.length); i++) {
          const result = optimizationResults[i];
          logger.info(`#${i+1}: ${JSON.stringify(result.params)} - Profit: ${result.results.profitPercentage.toFixed(2)}%, Win Rate: ${result.results.winRate.toFixed(2)}%, PF: ${result.results.profitFactor.toFixed(2)}`);
        }
        
        // Sauvegarder les résultats si un chemin de sortie est spécifié
        if (options.output) {
          const outputPath = path.resolve(process.cwd(), options.output);
          fs.writeFileSync(outputPath, JSON.stringify({
            strategy: options.strategy,
            baseConfig,
            results: optimizationResults,
            bestParams: optimizationResults.length > 0 ? optimizationResults[0].params : null
          }, null, 2));
          
          logger.info(`Résultats d'optimisation sauvegardés dans: ${outputPath}`);
        }
        
      } catch (error) {
        logger.error('Erreur lors de l\'optimisation', error instanceof Error ? error : String(error));
        process.exit(1);
      }
    });
  
  return program;
};

/**
 * Génère uniquement un rapport à partir de résultats sauvegardés
 */
async function generateReportOnly(options: {
  output?: string;
  [key: string]: any;
}) {
  if (!options.output) {
    logger.error('Chemin de sortie non spécifié');
    process.exit(1);
  }
  
  const outputPath = path.resolve(process.cwd(), options.output);
  
  if (!fs.existsSync(outputPath)) {
    logger.error(`Le fichier de résultats n'existe pas: ${outputPath}`);
    process.exit(1);
  }
  
  const savedData = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  
  if (!savedData.results) {
    logger.error(`Le fichier ne contient pas de résultats de backtest valides`);
    process.exit(1);
  }
  
  // Reconstruire l'environnement de backtest pour générer un nouveau rapport
  const engine = new BacktestEngine(savedData.config);
  
  // Hack pour injecter les résultats sauvegardés (ceci dépend de l'implémentation interne)
  (engine as any).results = savedData.results;
  
  const report = await engine.generateReport();
  logger.info(report);
  
  // Sauvegarder le rapport mis à jour
  savedData.report = report;
  fs.writeFileSync(outputPath, JSON.stringify(savedData, null, 2));
  
  logger.info(`Rapport mis à jour dans: ${outputPath}`);
}
