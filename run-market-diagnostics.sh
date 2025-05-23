#!/bin/bash

# Script pour lancer l'outil de diagnostic des souscriptions aux marchés

echo "Démarrage de l'outil de diagnostic des souscriptions aux marchés..."
echo "Les résultats seront enregistrés dans ./logs/market-diagnostics.log"

# Créer le répertoire des logs s'il n'existe pas
mkdir -p ./logs

# Exécuter l'outil de diagnostic
LOG_LEVEL=debug bun run ./src/tools/market-subscription-diagnostics.ts | tee ./logs/market-diagnostics.log

echo "Diagnostic terminé. Consultez ./logs/market-diagnostics.log pour les résultats."
