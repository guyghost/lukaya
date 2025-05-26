// Configuration globale pour Jest

// Augmenter le timeout pour les tests d'intégration qui peuvent prendre plus de temps
jest.setTimeout(30000);

// Désactiver la sortie console pour les tests
// Décommentez ces lignes si vous souhaitez réduire le bruit dans la console pendant les tests
/*
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
*/
