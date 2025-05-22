// debug-backtest-data.mjs - Script simplifié pour tester le chargement des données (ESM)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';

// Get directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fonction pour charger les données de marché depuis les fichiers CSV
function loadMarketData(symbol, startDate, endDate) {
    console.log(`Loading market data for ${symbol} from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    try {
        // Construire le chemin du fichier
        const filePath = path.join('./data', `${symbol}_1h.csv`);
        console.log(`Looking for file at: ${filePath}`);
        
        if (!fs.existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            return [];
        }
        
        // Lire le fichier CSV
        const fileContent = fs.readFileSync(filePath, 'utf8');
        console.log(`Read ${fileContent.length} bytes from file`);
        
        // Analyser le CSV
        const records = parse(fileContent, {
            columns: true,
            skip_empty_lines: true
        });
        console.log(`Parsed ${records.length} records from CSV`);
        
        // Filtrer et transformer les données
        return records
            .map(record => ({
                symbol: symbol,
                timestamp: new Date(record.timestamp).getTime(),
                price: parseFloat(record.close),
                open: parseFloat(record.open),
                high: parseFloat(record.high),
                low: parseFloat(record.low),
                close: parseFloat(record.close),
                volume: parseFloat(record.volume)
            }))
            .filter(record => {
                const recordTime = record.timestamp;
                return recordTime >= startDate.getTime() && recordTime <= endDate.getTime();
            });
    } catch (error) {
        console.error(`Error loading market data for ${symbol}:`, error);
        return [];
    }
}

// Tester le chargement des données
const startDate = new Date('2023-01-01T00:00:00.000Z');
const endDate = new Date('2023-01-31T23:59:59.000Z');

console.log("=== TESTING DATA LOADING ===");

// Charger les données BTC
const btcData = loadMarketData('BTC_USD', startDate, endDate);
console.log(`Loaded ${btcData.length} BTC records after filtering`);
if (btcData.length > 0) {
    console.log("First record:", JSON.stringify(btcData[0]));
    console.log("Last record:", JSON.stringify(btcData[btcData.length-1]));
}

// Charger les données ETH
const ethData = loadMarketData('ETH_USD', startDate, endDate);
console.log(`Loaded ${ethData.length} ETH records after filtering`);
if (ethData.length > 0) {
    console.log("First record:", JSON.stringify(ethData[0]));
    console.log("Last record:", JSON.stringify(ethData[ethData.length-1]));
}

console.log("=== DATA LOADING TEST COMPLETE ===");
