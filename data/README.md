# Données historiques pour le backtesting

Ce répertoire contient les données historiques utilisées pour le backtesting du bot de trading Lukaya.

## Format des fichiers

Les fichiers de données doivent être au format CSV avec les colonnes suivantes:

```
timestamp,open,high,low,close,volume
```

## Nomenclature des fichiers

Les fichiers doivent être nommés selon le format suivant:

```
{SYMBOL}_{TIMEFRAME}.csv
```

Exemples:
- BTC_USD_1h.csv
- ETH_USD_1h.csv

## Sources de données

Vous pouvez obtenir des données historiques pour le backtesting à partir des sources suivantes:

1. **CryptoDataDownload**: https://www.cryptodatadownload.com/data/
2. **Kaggle**: https://www.kaggle.com/datasets (recherchez "crypto historical data")
3. **dYdX API**: https://docs.dydx.exchange/

## Préparation des données

Si les données ne sont pas au bon format, vous pouvez utiliser des outils comme pandas (Python) pour les convertir:

```python
import pandas as pd

# Charger les données
df = pd.read_csv('source_data.csv')

# Restructurer si nécessaire
df = df[['timestamp', 'open', 'high', 'low', 'close', 'volume']]

# Sauvegarder au format attendu
df.to_csv('BTC_USD_1h.csv', index=False)
```

## Format de date

Les timestamps doivent être en format ISO 8601 ou en timestamps Unix (millisecondes).

Exemple ISO 8601: `2023-01-01T00:00:00.000Z`
Exemple timestamp Unix: `1672531200000`
