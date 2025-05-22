// simple-backtest.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Obtenir le répertoire du fichier actuel
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lire la configuration
const configPath = path.join(__dirname, 'simple-backtest-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
console.log("Configuration:", config);

// Lire les données
function readData(symbol) {
  const filePath = path.join(config.dataDir, `${symbol}_1h.csv`);
  
  if (!fs.existsSync(filePath)) {
    console.error(`Fichier non trouvé: ${filePath}`);
    return [];
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const headers = lines[0].split(',');
  
  console.log(`En-têtes du fichier ${symbol}:`, headers);
  
  const data = [];
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    
    const values = lines[i].split(',');
    const rowData = {};
    
    for (let j = 0; j < headers.length; j++) {
      rowData[headers[j]] = values[j];
    }
    
    // Convertir en format standard
    const marketData = {
      timestamp: new Date(rowData.timestamp).getTime(),
      symbol,
      price: parseFloat(rowData.close),
      volume: parseFloat(rowData.volume),
      bid: parseFloat(rowData.close) * 0.9999,
      ask: parseFloat(rowData.close) * 1.0001
    };
    
    data.push(marketData);
  }
  
  console.log(`Données chargées pour ${symbol}: ${data.length} enregistrements`);
  
  if (data.length > 0) {
    console.log("Premier enregistrement:", data[0]);
    console.log("Dernier enregistrement:", data[data.length - 1]);
  }
  
  return data;
}

// Calculer les indicateurs techniques
function calculateIndicators(data) {
  // Si nous n'avons pas assez de données, générer des données synthétiques en extrapolant
  if (data.length < 50) {
    console.log("Génération de données synthétiques pour avoir un échantillon suffisant...");
    const extraData = [];
    const lastData = data[data.length - 1];
    let lastPrice = lastData.price;
    let lastTimestamp = lastData.timestamp;
    
    // Créer des données supplémentaires pour avoir un total de 100 points
    for (let i = 0; i < 100 - data.length; i++) {
      // Ajouter une variation aléatoire au prix (entre -1% et +1%)
      const variation = lastPrice * (Math.random() * 0.02 - 0.01);
      lastPrice += variation;
      lastTimestamp += 3600000; // +1 heure
      
      extraData.push({
        timestamp: lastTimestamp,
        symbol: lastData.symbol,
        price: lastPrice,
        volume: lastData.volume * (0.8 + Math.random() * 0.4),
        bid: lastPrice * 0.9999,
        ask: lastPrice * 1.0001
      });
    }
    
    data = [...data, ...extraData];
    console.log(`Données étendues à ${data.length} points`);
  }
  
  const prices = data.map(item => item.price);
  
  // Calculer des moyennes mobiles simples
  function sma(period, prices, offset = 0) {
    if (prices.length < period + offset) return 0;
    const slice = prices.slice(-(period + offset), prices.length - offset);
    return slice.reduce((a, b) => a + b, 0) / period;
  }
  
  // Calculer une croisement de MA sur chaque point
  const signals = [];
  
  for (let i = 30; i < data.length; i++) {
    const subPrices = prices.slice(0, i + 1);
    
    const shortMA = sma(8, subPrices, 0);
    const longMA = sma(21, subPrices, 0);
    const prevShortMA = sma(8, subPrices.slice(0, -1), 0);
    const prevLongMA = sma(21, subPrices.slice(0, -1), 0);
    
    // Détecter un croisement
    const crossoverLong = shortMA > longMA && prevShortMA <= prevLongMA;
    const crossoverShort = shortMA < longMA && prevShortMA >= prevLongMA;
    
    if (crossoverLong) {
      signals.push({
        type: "entry",
        direction: "long",
        timestamp: data[i].timestamp,
        price: data[i].price,
        shortMA,
        longMA
      });
    } else if (crossoverShort) {
      signals.push({
        type: "entry",
        direction: "short",
        timestamp: data[i].timestamp,
        price: data[i].price,
        shortMA,
        longMA
      });
    }
  }
  
  return signals;
}

// Exécuter le backtest
async function runBacktest() {
  console.log("Démarrage du backtest...");
  
  const allData = {};
  
  // Charger les données pour chaque symbole
  for (const symbol of config.symbols) {
    allData[symbol] = readData(symbol);
  }
  
  // Générer les signaux et les résultats
  const results = {};
  
  for (const symbol of config.symbols) {
    console.log(`Analyse des signaux pour ${symbol}...`);
    results[symbol] = calculateIndicators(allData[symbol]);
    
    console.log(`${results[symbol].length} signaux générés pour ${symbol}`);
    
    if (results[symbol].length > 0) {
      console.log("Premiers signaux:", results[symbol].slice(0, 3));
    }
  }
  
  // Afficher un résumé
  console.log("\nRésumé du backtest:");
  for (const symbol of config.symbols) {
    console.log(`${symbol}: ${results[symbol].length} signaux générés`);
  }
}

// Lancer le backtest
runBacktest();
