import { BacktestCli } from './backtest-cli';
import { createStrategyService } from '../../domain/services/strategy.service';

// Initialiser les services
const strategyService = createStrategyService();

// Initialiser le CLI
const cli = new BacktestCli(strategyService);

// Exécuter la commande avec les arguments
cli.execute(process.argv.slice(2));
