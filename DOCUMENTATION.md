# Documentation Lukaya Trading Bot

Bienvenue dans la documentation complète du bot de trading Lukaya ! Ce guide vous aidera à comprendre, configurer et utiliser efficacement le système.

## 📚 Structure de la Documentation

### 🚀 Guide de Démarrage Rapide
- **[README.md](README.md)** - Guide principal d'installation et configuration
- **[CHANGELOG.md](CHANGELOG.md)** - Historique des versions et nouveautés

### 🏗️ Architecture et Fonctionnement
- **[SCHEMA_ARCHITECTURE.md](SCHEMA_ARCHITECTURE.md)** - Architecture détaillée du système
- **[SUIVI_POSITIONS_OUVERTES.md](SUIVI_POSITIONS_OUVERTES.md)** - Système de suivi des positions

### 📊 Monitoring et Performance
- **[Performance Tracker](src/application/actors/performance-tracker/README.md)** - Documentation des logs de performance
- **[Result Utilities](src/shared/docs/result-utilities.md)** - Utilitaires de gestion des résultats

## 🎯 Par Catégorie d'Utilisateur

### 👨‍💻 Développeurs
```
├── SCHEMA_ARCHITECTURE.md     # Architecture technique
├── src/shared/docs/           # Documentation des utilitaires
└── src/application/actors/    # Documentation des acteurs
```

### 📈 Traders
```
├── README.md                  # Configuration et usage
├── SUIVI_POSITIONS_OUVERTES.md # Gestion des positions
└── CHANGELOG.md               # Nouvelles fonctionnalités
```

### 🛠️ Administrateurs
```
├── README.md                  # Installation et déploiement
├── src/application/actors/performance-tracker/ # Monitoring
└── CHANGELOG.md               # Notes de migration
```

## 🎛️ Sections Principales

### Configuration
- Variables d'environnement `.env`
- Stratégies disponibles et paramètres
- Configuration de la stratégie coordonnée
- Paramètres de risque et take profit

### Stratégies de Trading
- **Coordinated Multi-Strategy** (Recommandée)
- RSI Divergence
- Volume Analysis
- Elliott Wave
- Harmonic Patterns
- Scalping Entry/Exit

### Architecture Technique
- Système d'acteurs
- Risk Manager
- Performance Tracker
- Take Profit Manager
- Flux de données et communication

### Monitoring et Logs
- Système de logs avancé avec émojis
- Métriques temps réel
- Performance par stratégie
- Analyse de viabilité des positions

### Tests et Backtesting
- Tests unitaires et d'intégration
- Système de backtesting complet
- Optimisation des paramètres
- Comparaison de stratégies

## 🔍 Navigation Rapide

| Besoin | Document | Section |
|--------|----------|---------|
| **Installer le bot** | README.md | Installation |
| **Configurer les stratégies** | README.md | Configuration des stratégies |
| **Comprendre l'architecture** | SCHEMA_ARCHITECTURE.md | Architecture Globale |
| **Suivre les positions** | SUIVI_POSITIONS_OUVERTES.md | Flux de Vie |
| **Analyser les logs** | performance-tracker/README.md | Fonctionnalités de Logging |
| **Voir les nouveautés** | CHANGELOG.md | Version 1.0.0 |

## 📋 Checklist de Mise en Route

### Configuration Initiale
- [ ] Copier et configurer le fichier `.env`
- [ ] Définir les paramètres de trading (taille position, stop loss)
- [ ] Choisir les symboles à trader
- [ ] Configurer la stratégie (coordonnée recommandée)

### Tests et Validation
- [ ] Exécuter les tests : `bun test`
- [ ] Tester en mode développement : `bun dev`
- [ ] Faire un backtest : `bun run backtest`
- [ ] Vérifier les logs de performance

### Déploiement Production
- [ ] Valider la configuration mainnet
- [ ] Configurer les alertes et monitoring
- [ ] Démarrer le bot : `bun start`
- [ ] Surveiller les premiers trades

## 💡 Conseils de Lecture

1. **Nouveaux utilisateurs** : Commencez par README.md puis CHANGELOG.md
2. **Développeurs** : Lisez SCHEMA_ARCHITECTURE.md pour comprendre le design
3. **Traders expérimentés** : Concentrez-vous sur SUIVI_POSITIONS_OUVERTES.md
4. **Monitoring** : Consultez performance-tracker/README.md pour les logs

## 🆘 Support et Aide

- **Configuration** : Voir README.md section Configuration
- **Erreurs** : Consulter les logs dans `./logs/lukaya.log`
- **Performance** : Analyser via performance-tracker
- **Architecture** : Référence complète dans SCHEMA_ARCHITECTURE.md

---

**Note** : Cette documentation reflète la version 1.0.0 de Lukaya. Pour les versions antérieures, consultez l'historique git ou CHANGELOG.md pour les notes de migration.

*Bon trading avec Lukaya ! 🚀*
