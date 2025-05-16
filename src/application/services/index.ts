
// Exporter l'ancien service trading bot pour la rétrocompatibilité
export { createTradingBotService as createLegacyTradingBotService } from './trading-bot.service';

// Exporter le nouveau service trading bot avec architecture d'acteurs spécialisés
export { createTradingBotService } from './trading-bot-v2.service';
