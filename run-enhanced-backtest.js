// run-enhanced-backtest.js - Version simplifiée du script de backtest avancé
const fs = require('fs');
const path = require('path');
const csvParse = require('csv-parse/sync');

// Constantes pour la configuration
const CONFIG = {
    startDate: new Date('2023-01-01T00:00:00.000Z'),
    endDate: new Date('2023-02-01T00:00:00.000Z'),
    initialBalance: 10000,
    tradingFees: 0.1, // percent
    slippage: 0.05,    // percent
    dataPath: './data',
    symbols: ['BTC_USD', 'ETH_USD']
};

// Structure pour stocker les indicateurs techniques
class TechnicalIndicators {
    constructor() {
        this.prices = [];
    }
    
    addPrice(price) {
        this.prices.push(price);
        // Limiter la taille du tableau pour éviter de consommer trop de mémoire
        if (this.prices.length > 100) {
            this.prices = this.prices.slice(-100);
        }
    }
    
    sma(period) {
        if (this.prices.length < period) return null;
        const slice = this.prices.slice(-period);
        return slice.reduce((sum, price) => sum + price, 0) / period;
    }
    
    ema(period) {
        if (this.prices.length < period) return null;
        const k = 2 / (period + 1);
        let ema = this.prices[0];
        for (let i = 1; i < this.prices.length; i++) {
            ema = this.prices[i] * k + ema * (1 - k);
        }
        return ema;
    }
    
    rsi(period) {
        if (this.prices.length < period + 1) return 50; // valeur neutre par défaut
        
        let gains = 0;
        let losses = 0;
        
        for (let i = 1; i < this.prices.length; i++) {
            const change = this.prices[i] - this.prices[i - 1];
            if (change > 0) {
                gains += change;
            } else {
                losses -= change;
            }
        }
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        
        if (avgLoss === 0) return 100;
        
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }
    
    macd(fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        if (this.prices.length < Math.max(fastPeriod, slowPeriod, signalPeriod)) return null;
        
        // Calculer les EMA rapide et lente
        const fastEma = this.ema(fastPeriod);
        const slowEma = this.ema(slowPeriod);
        
        // MACD Line = Fast EMA - Slow EMA
        const macdLine = fastEma - slowEma;
        
        // Signal Line = 9-day EMA of MACD Line
        // Note: pour un calcul plus précis, nous devrions stocker l'historique des MACD
        // et calculer l'EMA sur ces valeurs, mais cette approximation est suffisante pour notre exemple
        const signalLine = this.ema(signalPeriod);
        
        // Histogramme MACD = MACD Line - Signal Line
        const histogram = macdLine - signalLine;
        
        return {
            macd: macdLine,
            signal: signalLine,
            histogram: histogram
        };
    }
    
    bollinger(period = 20, stdDev = 2) {
        if (this.prices.length < period) return null;
        
        const sma = this.sma(period);
        
        // Calculer la déviation standard
        let sumSquares = 0;
        const slice = this.prices.slice(-period);
        slice.forEach(price => {
            sumSquares += Math.pow(price - sma, 2);
        });
        
        const std = Math.sqrt(sumSquares / period);
        
        return {
            middle: sma,
            upper: sma + (stdDev * std),
            lower: sma - (stdDev * std)
        };
    }
}

// Fonction pour charger les données de marché depuis les fichiers CSV
function loadMarketData(symbol, startDate, endDate) {
    const filename = `${CONFIG.dataPath}/${symbol}.csv`;
    console.log(`Loading market data from ${filename}`);
    
    if (!fs.existsSync(filename)) {
        console.error(`File not found: ${filename}`);
        return [];
    }
    
    const fileContent = fs.readFileSync(filename, 'utf8');
    const records = csvParse.parse(fileContent, {
        columns: true,
        skip_empty_lines: true
    });
    
    // Convertir et filtrer les données
    const data = records
        .map(record => ({
            timestamp: new Date(record.timestamp).getTime(),
            price: parseFloat(record.price),
            volume: parseFloat(record.volume || '0'),
            symbol: symbol
        }))
        .filter(d => {
            const timestamp = d.timestamp;
            return timestamp >= startDate.getTime() && timestamp <= endDate.getTime();
        })
        .sort((a, b) => a.timestamp - b.timestamp);
    
    console.log(`Loaded ${data.length} market data points for ${symbol}`);
    
    // Générer des données synthétiques si nécessaire
    if (data.length < 50) {
        console.log(`Not enough data for ${symbol}, generating synthetic data...`);
        
        const syntheticData = [];
        let lastData = data.length > 0 ? data[data.length - 1] : {
            timestamp: startDate.getTime(),
            price: symbol === 'BTC_USD' ? 30000 : 2000, // prix par défaut
            volume: 100,
            symbol: symbol
        };
        
        // Générer des données toutes les heures
        const hourMs = 60 * 60 * 1000;
        let currentTime = startDate.getTime();
        while (currentTime <= endDate.getTime()) {
            // Si nous avons des données réelles pour ce timestamp, les utiliser
            const realData = data.find(d => Math.abs(d.timestamp - currentTime) < 1000);
            
            if (realData) {
                syntheticData.push(realData);
                lastData = realData;
            } else {
                // Générer des données synthétiques
                const priceChange = lastData.price * (Math.random() * 0.02 - 0.01); // +/- 1%
                const newPrice = lastData.price + priceChange;
                const newVolume = lastData.volume * (0.8 + Math.random() * 0.4); // +/- 20% volume
                
                syntheticData.push({
                    timestamp: currentTime,
                    price: newPrice,
                    volume: newVolume,
                    symbol: symbol,
                    synthetic: true
                });
                
                lastData = {
                    timestamp: currentTime,
                    price: newPrice,
                    volume: newVolume,
                    symbol: symbol
                };
            }
            
            currentTime += hourMs;
        }
        
        console.log(`Generated ${syntheticData.length} data points for ${symbol}`);
        return syntheticData;
    }
    
    return data;
}

// Stratégie simple de croisement de moyennes mobiles
class SimpleMAStrategy {
    constructor(config) {
        this.config = {
            symbol: 'BTC_USD',
            shortPeriod: 7,
            longPeriod: 21,
            positionSize: 0.1,
            useBollinger: true,
            bollingerPeriod: 20,
            bollingerStdDev: 2.2,
            useMACD: true,
            macdFastPeriod: 6,
            macdSlowPeriod: 19,
            macdSignalPeriod: 9,
            useRSI: true,
            rsiPeriod: 14,
            rsiOversold: 42,
            rsiOverbought: 58,
            ...config
        };
        
        this.position = 'none'; // 'none', 'long', 'short'
        this.indicators = new TechnicalIndicators();
        this.name = `SimpleMA-${this.config.shortPeriod}-${this.config.longPeriod}`;
    }
    
    processMarketData(data) {
        if (data.symbol !== this.config.symbol) return null;
        
        // Ajouter le prix aux indicateurs
        this.indicators.addPrice(data.price);
        
        // Vérifier si nous avons suffisamment de données
        if (this.indicators.prices.length < Math.max(this.config.shortPeriod, this.config.longPeriod, this.config.rsiPeriod)) {
            return null;
        }
        
        // Calculer les indicateurs
        const shortMA = this.indicators.sma(this.config.shortPeriod);
        const longMA = this.indicators.sma(this.config.longPeriod);
        
        // Vérifier si les moyennes mobiles sont disponibles
        if (shortMA === null || longMA === null) {
            return null;
        }
        
        // Calculer les indicateurs supplémentaires si nécessaire
        let rsi = 50;
        if (this.config.useRSI) {
            rsi = this.indicators.rsi(this.config.rsiPeriod);
        }
        
        let macd = null;
        if (this.config.useMACD) {
            macd = this.indicators.macd(
                this.config.macdFastPeriod,
                this.config.macdSlowPeriod,
                this.config.macdSignalPeriod
            );
        }
        
        let bollinger = null;
        if (this.config.useBollinger) {
            bollinger = this.indicators.bollinger(
                this.config.bollingerPeriod,
                this.config.bollingerStdDev
            );
        }
        
        // Vérifier les conditions d'entrée et de sortie
        // Pour l'entrée en position longue
        let longCondition = shortMA > longMA;
        if (this.config.useRSI) {
            longCondition = longCondition && rsi < this.config.rsiOversold;
        }
        if (this.config.useMACD && macd) {
            longCondition = longCondition && macd.macd > macd.signal;
        }
        if (this.config.useBollinger && bollinger) {
            longCondition = longCondition && data.price < bollinger.lower * 1.01; // 1% au-dessus de la bande inférieure
        }
        
        // Pour l'entrée en position courte
        let shortCondition = shortMA < longMA;
        if (this.config.useRSI) {
            shortCondition = shortCondition && rsi > this.config.rsiOverbought;
        }
        if (this.config.useMACD && macd) {
            shortCondition = shortCondition && macd.macd < macd.signal;
        }
        if (this.config.useBollinger && bollinger) {
            shortCondition = shortCondition && data.price > bollinger.upper * 0.99; // 1% en-dessous de la bande supérieure
        }
        
        // Générer des signaux
        if (longCondition) {
            if (this.position === 'short') {
                this.position = 'none';
                return { type: 'exit', direction: 'short', price: data.price };
            } else if (this.position === 'none') {
                this.position = 'long';
                return { type: 'entry', direction: 'long', price: data.price };
            }
        } else if (shortCondition) {
            if (this.position === 'long') {
                this.position = 'none';
                return { type: 'exit', direction: 'long', price: data.price };
            } else if (this.position === 'none') {
                this.position = 'short';
                return { type: 'entry', direction: 'short', price: data.price };
            }
        }
        
        return null;
    }
}

// Simulateur de backtest
class BacktestSimulator {
    constructor(config) {
        this.config = config;
        this.balance = config.initialBalance;
        this.positions = [];
        this.trades = [];
        this.equity = [{ timestamp: config.startDate.getTime(), value: this.balance }];
    }
    
    // Placer un ordre
    placeOrder(symbol, side, size, price, strategy) {
        // Calcul des frais
        const fee = price * size * (this.config.tradingFees / 100);
        
        // Appliquer le slippage (en prix)
        const slippageAmount = price * (this.config.slippage / 100);
        const executionPrice = side === 'buy' ? price + slippageAmount : price - slippageAmount;
        
        // Calculer la valeur du trade
        const value = executionPrice * size;
        
        // Vérifier si nous avons assez de balance pour couvrir le trade et les frais
        if (side === 'buy' && value + fee > this.balance) {
            console.log(`Ordre rejeté: fonds insuffisants. Requis: ${value + fee}, disponible: ${this.balance}`);
            return false;
        }
        
        // Exécuter l'ordre
        if (side === 'buy') {
            this.balance -= value + fee;
            this.positions.push({
                symbol: symbol,
                side: 'long',
                size: size,
                entryPrice: executionPrice,
                entryTime: Date.now(),
                fee: fee,
                strategyId: strategy.name
            });
        } else {
            // Trouver une position ouverte à fermer
            const posIndex = this.positions.findIndex(p => p.symbol === symbol);
            if (posIndex >= 0) {
                const position = this.positions[posIndex];
                const profit = position.side === 'long' 
                    ? (executionPrice - position.entryPrice) * position.size 
                    : (position.entryPrice - executionPrice) * position.size;
                
                this.balance += value - fee;
                
                // Enregistrer le trade complet
                this.trades.push({
                    symbol: symbol,
                    direction: position.side,
                    size: position.size,
                    entryPrice: position.entryPrice,
                    exitPrice: executionPrice,
                    entryTime: position.entryTime,
                    exitTime: Date.now(),
                    profit: profit,
                    profitPercentage: (profit / (position.entryPrice * position.size)) * 100,
                    fees: position.fee + fee,
                    strategyId: position.strategyId
                });
                
                // Retirer la position
                this.positions.splice(posIndex, 1);
            }
        }
        
        return true;
    }
    
    // Mettre à jour l'équité à un moment donné
    updateEquity(timestamp) {
        this.equity.push({
            timestamp: timestamp,
            value: this.getEquity()
        });
    }
    
    // Calculer l'équité totale (balance + valeur des positions ouvertes)
    getEquity() {
        return this.balance + this.positions.reduce((sum, pos) => sum + pos.size * pos.entryPrice, 0);
    }
    
    // Calculer les métriques de performance
    calculatePerformance() {
        const initialBalance = this.config.initialBalance;
        const finalBalance = this.balance;
        const profit = finalBalance - initialBalance;
        const profitPercentage = (profit / initialBalance) * 100;
        
        const winningTrades = this.trades.filter(t => t.profit > 0);
        const losingTrades = this.trades.filter(t => t.profit <= 0);
        
        const winRate = winningTrades.length / this.trades.length || 0;
        
        const totalWinning = winningTrades.reduce((sum, t) => sum + t.profit, 0);
        const totalLosing = losingTrades.reduce((sum, t) => sum + t.profit, 0);
        
        const profitFactor = Math.abs(totalLosing) > 0 ? Math.abs(totalWinning / totalLosing) : totalWinning > 0 ? Infinity : 0;
        
        // Calculer le drawdown maximum
        let peak = initialBalance;
        let maxDrawdown = 0;
        let maxDrawdownPercentage = 0;
        
        this.equity.forEach(e => {
            if (e.value > peak) {
                peak = e.value;
            }
            
            const drawdown = peak - e.value;
            const drawdownPercentage = (drawdown / peak) * 100;
            
            if (drawdownPercentage > maxDrawdownPercentage) {
                maxDrawdown = drawdown;
                maxDrawdownPercentage = drawdownPercentage;
            }
        });
        
        return {
            initialBalance,
            finalBalance,
            profit,
            profitPercentage,
            trades: this.trades,
            totalTrades: this.trades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate,
            profitFactor,
            maxDrawdown,
            maxDrawdownPercentage,
            equity: this.equity
        };
    }
    
    // Générer un rapport textuel
    generateReport() {
        const perf = this.calculatePerformance();
        
        let report = "=== RAPPORT DE BACKTEST ===\n\n";
        report += `Solde initial: $${perf.initialBalance.toFixed(2)}\n`;
        report += `Solde final: $${perf.finalBalance.toFixed(2)}\n`;
        report += `Profit: $${perf.profit.toFixed(2)} (${perf.profitPercentage.toFixed(2)}%)\n`;
        report += `Nombre total de trades: ${perf.totalTrades}\n`;
        report += `Trades gagnants: ${perf.winningTrades}\n`;
        report += `Trades perdants: ${perf.losingTrades}\n`;
        report += `Taux de réussite: ${(perf.winRate * 100).toFixed(2)}%\n`;
        report += `Facteur de profit: ${perf.profitFactor.toFixed(2)}\n`;
        report += `Drawdown maximum: ${perf.maxDrawdownPercentage.toFixed(2)}% ($${perf.maxDrawdown.toFixed(2)})\n\n`;
        
        // Analyse par symbole
        const tradesBySymbol = new Map();
        perf.trades.forEach(trade => {
            const trades = tradesBySymbol.get(trade.symbol) || [];
            trades.push(trade);
            tradesBySymbol.set(trade.symbol, trades);
        });
        
        report += "=== RÉSULTATS PAR SYMBOLE ===\n\n";
        
        tradesBySymbol.forEach((trades, symbol) => {
            const winningTrades = trades.filter(t => t.profit > 0);
            const totalProfit = trades.reduce((sum, t) => sum + t.profit, 0);
            const winRate = winningTrades.length / trades.length;
            
            report += `${symbol} (${trades.length} trades):\n`;
            report += `  Profit: $${totalProfit.toFixed(2)}\n`;
            report += `  Taux de réussite: ${(winRate * 100).toFixed(2)}%\n`;
            report += `  Trades gagnants: ${winningTrades.length}\n`;
            report += `  Trades perdants: ${trades.length - winningTrades.length}\n\n`;
        });
        
        return report;
    }
    
    // Sauvegarder les résultats
    saveResults(filename) {
        const perf = this.calculatePerformance();
        fs.writeFileSync(filename, JSON.stringify(perf, null, 2));
        console.log(`Results saved to ${filename}`);
    }
    
    // Sauvegarder le rapport
    saveReport(filename) {
        const report = this.generateReport();
        fs.writeFileSync(filename, report);
        console.log(`Report saved to ${filename}`);
    }
    
    // Générer une page HTML avec des graphiques
    generateHtmlReport(filename) {
        const perf = this.calculatePerformance();
        
        // Créer des données pour les graphiques
        const equityData = perf.equity.map(e => ({
            x: new Date(e.timestamp).toISOString().split('T')[0],
            y: e.value
        }));
        
        // Créer la page HTML
        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Lukaya Backtest Report</title>
            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .container { max-width: 1200px; margin: 0 auto; }
                .summary { background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
                .chart-container { margin: 20px 0; }
                .positive { color: green; }
                .negative { color: red; }
                table { width: 100%; border-collapse: collapse; }
                th, td { padding: 8px; border: 1px solid #ddd; }
                th { background-color: #f2f2f2; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Lukaya Backtest Report</h1>
                
                <div class="summary">
                    <h2>Summary</h2>
                    <p>Initial Balance: <strong>$${perf.initialBalance.toFixed(2)}</strong></p>
                    <p>Final Balance: <strong>$${perf.finalBalance.toFixed(2)}</strong></p>
                    <p>Profit: <strong class="${perf.profit >= 0 ? 'positive' : 'negative'}">$${perf.profit.toFixed(2)} (${perf.profitPercentage.toFixed(2)}%)</strong></p>
                    <p>Total Trades: <strong>${perf.totalTrades}</strong></p>
                    <p>Win Rate: <strong>${(perf.winRate * 100).toFixed(2)}%</strong></p>
                    <p>Profit Factor: <strong>${perf.profitFactor.toFixed(2)}</strong></p>
                    <p>Max Drawdown: <strong class="negative">${perf.maxDrawdownPercentage.toFixed(2)}% ($${perf.maxDrawdown.toFixed(2)})</strong></p>
                </div>
                
                <div class="chart-container">
                    <h2>Equity Curve</h2>
                    <canvas id="equityChart"></canvas>
                </div>
                
                <h2>Trades by Symbol</h2>
                <table>
                    <tr>
                        <th>Symbol</th>
                        <th>Total Trades</th>
                        <th>Winning Trades</th>
                        <th>Win Rate</th>
                        <th>Profit</th>
                    </tr>
                    ${Array.from(new Map(perf.trades.reduce((acc, trade) => {
                        const key = trade.symbol;
                        const current = acc.get(key) || { 
                            total: 0, 
                            winning: 0, 
                            profit: 0 
                        };
                        current.total++;
                        if (trade.profit > 0) current.winning++;
                        current.profit += trade.profit;
                        acc.set(key, current);
                        return acc;
                    }, new Map())).entries().map(([symbol, data]) => `
                        <tr>
                            <td>${symbol}</td>
                            <td>${data.total}</td>
                            <td>${data.winning}</td>
                            <td>${((data.winning / data.total) * 100).toFixed(2)}%</td>
                            <td class="${data.profit >= 0 ? 'positive' : 'negative'}">$${data.profit.toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </table>
                
                <h2>Latest Trades</h2>
                <table>
                    <tr>
                        <th>Symbol</th>
                        <th>Direction</th>
                        <th>Entry</th>
                        <th>Exit</th>
                        <th>Profit</th>
                    </tr>
                    ${perf.trades.slice(-10).map(trade => `
                        <tr>
                            <td>${trade.symbol}</td>
                            <td>${trade.direction}</td>
                            <td>$${trade.entryPrice.toFixed(2)} @ ${new Date(trade.entryTime).toISOString().split('T')[0]}</td>
                            <td>$${trade.exitPrice.toFixed(2)} @ ${new Date(trade.exitTime).toISOString().split('T')[0]}</td>
                            <td class="${trade.profit >= 0 ? 'positive' : 'negative'}">$${trade.profit.toFixed(2)} (${trade.profitPercentage.toFixed(2)}%)</td>
                        </tr>
                    `).join('')}
                </table>
            </div>
            
            <script>
                // Equity chart
                new Chart(document.getElementById('equityChart'), {
                    type: 'line',
                    data: {
                        labels: ${JSON.stringify(equityData.map(d => d.x))},
                        datasets: [{
                            label: 'Account Equity',
                            data: ${JSON.stringify(equityData.map(d => d.y))},
                            borderColor: 'rgb(75, 192, 192)',
                            backgroundColor: 'rgba(75, 192, 192, 0.1)',
                            tension: 0.1,
                            fill: true
                        }]
                    },
                    options: {
                        scales: {
                            y: {
                                beginAtZero: false,
                                title: {
                                    display: true,
                                    text: 'Balance ($)'
                                }
                            }
                        }
                    }
                });
            </script>
        </body>
        </html>
        `;
        
        fs.writeFileSync(filename, html);
        console.log(`HTML report saved to ${filename}`);
    }
}

// Fonction principale
async function runBacktest() {
    console.log("=== LUKAYA ENHANCED BACKTEST ===");
    console.log(`Starting backtest from ${CONFIG.startDate.toISOString()} to ${CONFIG.endDate.toISOString()}`);
    
    // Créer le simulateur de backtest
    const simulator = new BacktestSimulator(CONFIG);
    
    // Créer les stratégies
    const strategies = [
        new SimpleMAStrategy({
            symbol: 'BTC_USD',
            shortPeriod: 7,
            longPeriod: 21,
            useBollinger: true,
            bollingerPeriod: 20,
            bollingerStdDev: 2.2,
            useMACD: true,
            macdFastPeriod: 6,
            macdSlowPeriod: 19,
            macdSignalPeriod: 9,
            useRSI: true,
            rsiPeriod: 14,
            rsiOversold: 42,
            rsiOverbought: 58
        }),
        new SimpleMAStrategy({
            symbol: 'ETH_USD',
            shortPeriod: 5,
            longPeriod: 15,
            useBollinger: true,
            bollingerPeriod: 15,
            bollingerStdDev: 2.2,
            useMACD: true,
            macdFastPeriod: 7,
            macdSlowPeriod: 17,
            macdSignalPeriod: 7,
            useRSI: true,
            rsiPeriod: 10,
            rsiOversold: 40,
            rsiOverbought: 60
        })
    ];
    
    // Charger les données de marché
    const marketDataBySymbol = {};
    for (const symbol of CONFIG.symbols) {
        marketDataBySymbol[symbol] = loadMarketData(symbol, CONFIG.startDate, CONFIG.endDate);
    }
    
    // Combiner toutes les données et trier par timestamp
    let allMarketData = [];
    Object.values(marketDataBySymbol).forEach(data => {
        allMarketData = allMarketData.concat(data);
    });
    allMarketData.sort((a, b) => a.timestamp - b.timestamp);
    
    console.log(`Total market data points: ${allMarketData.length}`);
    
    // Exécuter le backtest
    let processedCount = 0;
    const totalEvents = allMarketData.length;
    
    for (const data of allMarketData) {
        // Mettre à jour l'équité
        simulator.updateEquity(data.timestamp);
        
        // Traiter les données avec chaque stratégie
        for (const strategy of strategies) {
            const signal = strategy.processMarketData(data);
            
            // Exécuter l'ordre si un signal est généré
            if (signal) {
                console.log(`${new Date(data.timestamp).toISOString()} - ${strategy.name} - Signal: ${signal.type} ${signal.direction} for ${data.symbol} at ${data.price}`);
                
                if (signal.type === 'entry') {
                    const side = signal.direction === 'long' ? 'buy' : 'sell';
                    const size = CONFIG.initialBalance * 0.1 / data.price; // Utiliser 10% du capital initial
                    simulator.placeOrder(data.symbol, side, size, data.price, strategy);
                } else if (signal.type === 'exit') {
                    const side = signal.direction === 'long' ? 'sell' : 'buy';
                    const size = CONFIG.initialBalance * 0.1 / data.price; // Utiliser la même taille que l'entrée
                    simulator.placeOrder(data.symbol, side, size, data.price, strategy);
                }
            }
        }
        
        // Afficher la progression
        processedCount++;
        if (processedCount % Math.max(1, Math.floor(totalEvents / 20)) === 0 || processedCount === totalEvents) {
            const progress = (processedCount / totalEvents * 100).toFixed(1);
            console.log(`Progress: ${progress}% (${processedCount}/${totalEvents})`);
        }
    }
    
    // Calculer les résultats
    const performance = simulator.calculatePerformance();
    
    // Afficher les résultats
    console.log("\n=== BACKTEST RESULTS ===");
    console.log(`Initial Balance: $${performance.initialBalance.toFixed(2)}`);
    console.log(`Final Balance: $${performance.finalBalance.toFixed(2)}`);
    console.log(`Profit: $${performance.profit.toFixed(2)} (${performance.profitPercentage.toFixed(2)}%)`);
    console.log(`Total Trades: ${performance.totalTrades}`);
    console.log(`Win Rate: ${(performance.winRate * 100).toFixed(2)}%`);
    console.log(`Profit Factor: ${performance.profitFactor.toFixed(2)}`);
    console.log(`Max Drawdown: ${performance.maxDrawdownPercentage.toFixed(2)}%`);
    
    // Sauvegarder les résultats
    simulator.saveResults('enhanced-backtest-results.json');
    simulator.saveReport('enhanced-backtest-report.txt');
    simulator.generateHtmlReport('enhanced-backtest-report.html');
    
    console.log("\nBacktest completed!");
}

// Exécuter le backtest
runBacktest().catch(err => {
    console.error("Error running backtest:", err);
});
