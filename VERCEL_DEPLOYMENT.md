# Déploiement Lukaya Trading Bot sur Vercel

Ce guide explique comment déployer l'API du Lukaya Trading Bot sur Vercel.

## 🚀 Configuration pour Vercel

### Prérequis

1. Compte Vercel (https://vercel.com)
2. CLI Vercel installé globalement
3. Accès au repository Git

### Installation du CLI Vercel

```bash
npm install -g vercel
```

### Configuration des dépendances

```bash
# Installer les nouvelles dépendances
npm install cors @types/cors vercel

# Ou avec bun
bun add cors @types/cors vercel
```

## 📁 Structure pour Vercel

La configuration Vercel utilise les fichiers suivants :

- `vercel.json` : Configuration de déploiement
- `src/api/index.ts` : Point d'entrée API pour Vercel
- `.env.example` : Variables d'environnement de référence

## 🔧 Configuration

### 1. Variables d'environnement

Créez un fichier `.env.local` basé sur `.env.example` :

```bash
cp .env.example .env.local
```

Configurez les variables nécessaires dans Vercel Dashboard :

**Obligatoires pour le fonctionnement de base :**
- `NODE_ENV=production`
- `LOG_LEVEL=info`

**Optionnelles pour les fonctionnalités avancées :**
- `DYDX_MNEMONIC` (pour les fonctions de trading réelles)
- `DYDX_NETWORK=testnet` ou `mainnet`

### 2. Déploiement local pour test

```bash
# Démarrer l'API en local
npm run api:dev

# L'API sera disponible sur http://localhost:3000
```

### 3. Déploiement sur Vercel

#### Option A : Via le CLI

```bash
# Première fois - configuration initiale
vercel

# Déploiements suivants
vercel --prod
```

#### Option B : Via GitHub (recommandé)

1. Connectez votre repository GitHub à Vercel
2. Vercel déploiera automatiquement à chaque push sur `main`

## 🔗 Endpoints disponibles

Une fois déployé, votre API Vercel exposera :

### Routes principales

- `GET /` : Informations sur l'API
- `GET /api/health` : Statut de santé de l'API
- `GET /api/strategies` : Liste des stratégies disponibles

### Routes de backtesting

- `POST /api/backtest/run` : Exécuter un backtest
- `POST /api/backtest/compare` : Comparer plusieurs stratégies
- `POST /api/backtest/optimize` : Optimiser les paramètres d'une stratégie

## 📊 Exemples d'utilisation

### Santé de l'API

```bash
curl https://votre-app.vercel.app/api/health
```

### Lister les stratégies

```bash
curl https://votre-app.vercel.app/api/strategies
```

### Exécuter un backtest

```bash
curl -X POST https://votre-app.vercel.app/api/backtest/run \\
  -H "Content-Type: application/json" \\
  -d '{
    "strategyId": "rsi-divergence",
    "config": {
      "symbol": "BTC-USD",
      "startDate": "2024-01-01",
      "endDate": "2024-01-31",
      "initialBalance": 10000,
      "dataResolution": "1h"
    }
  }'
```

## ⚠️ Limitations Vercel

- **Timeout** : Maximum 30 secondes par requête
- **Mémoire** : 1024 MB allouée
- **Région** : Europe (fra1) configurée
- **Cold start** : Première requête peut être plus lente

## 🔒 Sécurité

### Variables sensibles

Ne jamais committer :
- `.env.local`
- Clés privées ou mnemonics
- Tokens d'API

### Configuration Vercel

Ajoutez vos variables d'environnement via :
1. Vercel Dashboard → Votre projet → Settings → Environment Variables
2. CLI : `vercel env add`

## 🐛 Dépannage

### Problèmes courants

1. **Build failed** : Vérifiez que toutes les dépendances sont installées
2. **Function timeout** : Backtests longs peuvent dépasser 30s
3. **Import errors** : Assurez-vous que tous les imports utilisent des chemins relatifs corrects

### Logs

```bash
# Voir les logs en temps réel
vercel logs votre-app

# Logs d'une fonction spécifique
vercel logs votre-app --function=api
```

## 🔄 Scripts disponibles

```bash
# Développement local de l'API
npm run api:dev

# Build pour production
npm run vercel-build

# Déploiement direct
npm run deploy
```

## 📈 Monitoring

Vercel fournit automatiquement :
- Métriques de performance
- Logs des erreurs
- Analytics d'utilisation
- Alertes de déploiement

Accédez à ces informations via le dashboard Vercel de votre projet.

## 🎯 Utilisation recommandée

Cette API Vercel est idéale pour :
- Backtesting de stratégies
- Analyse de performance historique
- Comparaison de stratégies
- Prototypage rapide
- Démos et présentations

**Note** : Pour du trading en temps réel avec positions ouvertes, utilisez plutôt l'application principale (`npm run dev`).
