// test-simple.ts
console.log("Test simple des indicateurs de trading");

// Tableau de prix de test
const prices = [100, 105, 110, 115, 120, 125, 130, 135, 140, 145];

// Calculer une moyenne mobile simple
function sma(period: number, prices: number[]): number {
  if (prices.length < period) return 0;
  const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
  return sum / period;
}

// Calculer la SMA pour différentes périodes
const sma5 = sma(5, prices);
const sma10 = sma(10, prices);

console.log(`Prix: ${prices.join(', ')}`);
console.log(`SMA(5): ${sma5}`);
console.log(`SMA(10): ${sma10}`);
console.log(`Signal: ${sma5 > sma10 ? "ACHAT" : "VENTE"}`);
