#!/usr/bin/env bun

console.log("Test des fonctions d'indicateurs techniques");

// Définir un tableau de prix pour les tests
const prices = [
  16000, 16050, 16100, 16150, 16200, 
  16250, 16300, 16350, 16400, 16450, 
  16500, 16550, 16600, 16650, 16700,
  16750, 16800, 16850, 16900, 16950,
  17000, 17050, 17100, 17150, 17200
];

// Fonction pour calculer une moyenne mobile
function calculateMA(period: number, priceArray: number[]): number {
  if (priceArray.length < period) return 0;
  
  const relevantPrices = priceArray.slice(-period);
  const sum = relevantPrices.reduce((acc, price) => acc + price, 0);
  return sum / period;
}

// Fonction pour calculer le RSI
function calculateRSI(period: number, priceArray: number[]): number {
  if (priceArray.length < period + 1) return 50;
  
  let gains = 0, losses = 0;
  for (let i = priceArray.length - period; i < priceArray.length; i++) {
    const diff = priceArray[i] - priceArray[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Fonction pour calculer le MACD
function calculateMACD(
  fast: number, 
  slow: number, 
  signal: number, 
  priceArray: number[]
): { macd: number, signal: number, hist: number } {
  if (priceArray.length < slow + signal) {
    return { macd: 0, signal: 0, hist: 0 };
  }
  
  // Simple EMA calculation
  const ema = (period: number, offset = 0) => {
    const k = 2 / (period + 1);
    let emaPrev = priceArray[priceArray.length - period - offset];
    for (let i = priceArray.length - period - offset + 1; i < priceArray.length - offset; i++) {
      emaPrev = priceArray[i] * k + emaPrev * (1 - k);
    }
    return emaPrev;
  };
  
  const macdLine = ema(fast) - ema(slow);
  
  // Signal line
  let signalLine = macdLine;
  let prevMacd = macdLine;
  for (let i = 1; i < signal; i++) {
    prevMacd = ema(fast, i) - ema(slow, i);
    signalLine = prevMacd * (2 / (signal + 1)) + signalLine * (1 - 2 / (signal + 1));
  }
  
  return { macd: macdLine, signal: signalLine, hist: macdLine - signalLine };
}

// Fonction pour calculer les bandes de Bollinger
function calculateBollinger(
  period: number, 
  stdDev: number, 
  priceArray: number[]
): { upper: number, lower: number, middle: number } {
  if (priceArray.length < period) {
    return { upper: 0, lower: 0, middle: 0 };
  }
  
  const prices = priceArray.slice(-period);
  const mean = prices.reduce((a, b) => a + b, 0) / period;
  const variance = prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  const std = Math.sqrt(variance);
  
  return {
    upper: mean + stdDev * std,
    lower: mean - stdDev * std,
    middle: mean
  };
}

// Effectuer des calculs et afficher les résultats
console.log("Prix:", prices);

const shortPeriod = 8;
const longPeriod = 21;

// Moyenne mobile
const shortMA = calculateMA(shortPeriod, prices);
const longMA = calculateMA(longPeriod, prices);

console.log(`Moyenne mobile courte (${shortPeriod}): ${shortMA.toFixed(2)}`);
console.log(`Moyenne mobile longue (${longPeriod}): ${longMA.toFixed(2)}`);
console.log(`Signal de croisement: ${shortMA > longMA ? "LONG" : "SHORT"}`);

// RSI
const rsi = calculateRSI(14, prices);
console.log(`RSI (14): ${rsi.toFixed(2)}`);
console.log(`Signal RSI: ${rsi < 40 ? "SURVENDU (achat)" : rsi > 60 ? "SURACHETÉ (vente)" : "NEUTRE"}`);

// MACD
const macd = calculateMACD(12, 26, 9, prices);
console.log(`MACD: ${macd.macd.toFixed(2)}, Signal: ${macd.signal.toFixed(2)}, Histogramme: ${macd.hist.toFixed(2)}`);
console.log(`Signal MACD: ${macd.macd > macd.signal ? "HAUSSIER" : "BAISSIER"}`);

// Bollinger
const bollinger = calculateBollinger(20, 2, prices);
console.log(`Bollinger: Supérieur=${bollinger.upper.toFixed(2)}, Milieu=${bollinger.middle.toFixed(2)}, Inférieur=${bollinger.lower.toFixed(2)}`);
console.log(`Signal Bollinger: ${prices[prices.length - 1] < bollinger.lower ? "ACHAT" : prices[prices.length - 1] > bollinger.upper ? "VENTE" : "NEUTRE"}`);

// Générer un signal combiné
const crossoverSignal = shortMA > longMA;
const rsiSignal = rsi < 45; // Plus agressif: 45 au lieu de 30 pour les achats
const macdSignal = macd.macd > macd.signal;
const bollingerSignal = prices[prices.length - 1] < bollinger.lower * 1.003; // avec buffer de 0.3%

const combinedSignal = crossoverSignal && rsiSignal && macdSignal && bollingerSignal;

console.log("\nSignaux combinés:");
console.log(`- Croisement MA: ${crossoverSignal ? "POSITIF" : "NÉGATIF"}`);
console.log(`- RSI: ${rsiSignal ? "POSITIF" : "NÉGATIF"}`);
console.log(`- MACD: ${macdSignal ? "POSITIF" : "NÉGATIF"}`);
console.log(`- Bollinger: ${bollingerSignal ? "POSITIF" : "NÉGATIF"}`);
console.log(`\nSignal final: ${combinedSignal ? "ENTRER LONG" : "PAS DE SIGNAL"}`);
