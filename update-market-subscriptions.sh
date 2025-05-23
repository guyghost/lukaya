#!/bin/bash

# Script de mise à jour pour Lukaya Trading Bot
# Corrige le problème de souscription aux marchés

echo "=================================================================="
echo "MISE À JOUR DU BOT DE TRADING LUKAYA - CORRECTION DES SOUSCRIPTIONS"
echo "=================================================================="

# Sauvegarder les fichiers importants
echo "[1/5] Sauvegarde des fichiers modifiés..."
NOW=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="./backups/$NOW"
mkdir -p $BACKUP_DIR

cp ./src/adapters/secondary/dydx-client.adapter.ts $BACKUP_DIR/
cp ./src/application/actors/market.actor.ts $BACKUP_DIR/
cp ./src/application/actors/market-supervisor/market-supervisor.actor.ts $BACKUP_DIR/
cp ./src/application/services/trading-bot-v2.service.ts $BACKUP_DIR/

# Vérifier le dépôt git
if [ -d ".git" ]; then
  echo "Sauvegarde git des modifications..."
  git add .
  git stash save "Backup avant correction des souscriptions - $NOW"
  echo "Modifications sauvegardées dans git stash"
fi

# Arrêter le bot s'il est en cours d'exécution
echo "[2/5] Arrêt des processus en cours..."
if [ -f "./lukaya.pid" ]; then
  echo "Arrêt du bot de trading..."
  kill $(cat ./lukaya.pid) 2>/dev/null || true
  rm ./lukaya.pid
fi

# Installer les dépendances mises à jour si nécessaire
echo "[3/5] Mise à jour des dépendances..."
bun install

# Diagnostic initial (optionnel)
echo "[4/5] Exécution du diagnostic initial..."
read -p "Voulez-vous exécuter un diagnostic initial? (o/N): " run_diag
if [[ $run_diag == "o" || $run_diag == "O" ]]; then
  echo "Exécution du diagnostic initial..."
  ./run-market-diagnostics.sh
fi

# Redémarrer le bot
echo "[5/5] Redémarrage du bot de trading..."
read -p "Voulez-vous redémarrer le bot maintenant? (o/N): " restart
if [[ $restart == "o" || $restart == "O" ]]; then
  echo "Redémarrage du bot..."
  bun run ./src/main.ts > ./logs/lukaya.log 2>&1 &
  echo $! > ./lukaya.pid
  echo "Bot redémarré avec PID $(cat ./lukaya.pid)"
  echo "Les logs sont disponibles dans ./logs/lukaya.log"
else
  echo "Le bot n'a pas été redémarré."
  echo "Pour le démarrer manuellement, exécutez: bun run ./src/main.ts"
fi

echo ""
echo "=================================================================="
echo "MISE À JOUR TERMINÉE"
echo ""
echo "Outils disponibles:"
echo "- ./run-market-diagnostics.sh : Diagnostic des souscriptions"
echo "- ./run-market-watchdog.sh    : Surveillance et auto-correction"
echo "=================================================================="
