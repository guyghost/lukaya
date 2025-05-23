#!/bin/bash

# Script pour lancer le watchdog de souscription aux marchés

echo "Démarrage du watchdog de souscription aux marchés..."
echo "Les journaux seront enregistrés dans ./logs/market-watchdog.log"

# Créer le répertoire des logs s'il n'existe pas
mkdir -p ./logs

# Exécuter le watchdog en arrière-plan
LOG_LEVEL=info nohup bun run ./src/tools/market-watchdog.ts > ./logs/market-watchdog.log 2>&1 &

# Enregistrer le PID
echo $! > ./market-watchdog.pid

echo "Watchdog démarré avec PID $(cat ./market-watchdog.pid)"
echo "Pour l'arrêter, exécutez: kill $(cat ./market-watchdog.pid)"
