import {
  MarketData,
  OrderParams,
  OrderSide,
  OrderType,
  TimeInForce,
} from "../../domain/models/market.model";
import {
  Strategy,
  StrategyConfig,
  StrategySignal,
} from "../../domain/models/strategy.model";

interface SimpleMAConfig {
  shortPeriod: number;
  longPeriod: number;
  symbol: string;
  positionSize: number;
  maxSlippagePercent?: number;
  minLiquidityRatio?: number;
  riskPerTrade?: number;
  stopLossPercent?: number;
  accountSize?: number;
  maxCapitalPerTrade?: number;
  limitOrderBuffer?: number;
  // Nouveaux indicateurs
  useRSI?: boolean;
  rsiPeriod?: number;
  rsiOverbought?: number;
  rsiOversold?: number;
  useMACD?: boolean;
  macdFastPeriod?: number;
  macdSlowPeriod?: number;
  macdSignalPeriod?: number;
  useBollinger?: boolean;
  bollingerPeriod?: number;
  bollingerStdDev?: number;
}

interface SimpleMAState {
  priceHistory: number[];
  position: "none" | "long" | "short";
  lastEntryPrice: number | null;
  accountSize: number | null;
}

export const createSimpleMAStrategy = (config: SimpleMAConfig): Strategy => {
  // Create strategy state
  const state: SimpleMAState = {
    priceHistory: [],
    position: "none",
    lastEntryPrice: null,
    accountSize: config.accountSize || null,
  };

  // Generate unique ID and name for the strategy
  const id = `simple-ma-${config.shortPeriod}-${config.longPeriod}-${config.symbol}`;
  const name = `Simple Moving Average (${config.shortPeriod}/${config.longPeriod})`;

  // Set default values for parameters - version très agressive
  const maxSlippagePercent = config.maxSlippagePercent || 2.0;
  const minLiquidityRatio = config.minLiquidityRatio || 6.0;
  const riskPerTrade = config.riskPerTrade || 0.03;
  const stopLossPercent = config.stopLossPercent || 0.04;
  const defaultAccountSize = config.accountSize || 10000;
  const maxCapitalPerTrade = config.maxCapitalPerTrade || 0.45;
  const limitOrderBuffer = config.limitOrderBuffer || 0.002;

  // Helper function to normalize symbols for comparison
  const normalizeSymbol = (symbol: string): string => {
    // Convert all possible separators (-, _) to a standard format
    return symbol.replace(/[-_]/g, '').toUpperCase();
  };

  // Cache the normalized strategy symbol for comparison
  const normalizedStrategySymbol = normalizeSymbol(config.symbol);

  // Helper function to calculate moving average
  const calculateMA = (period: number, offset: number = 0): number => {
    if (state.priceHistory.length < period + offset) return 0;

    const relevantPrices = state.priceHistory.slice(
      -(period + offset),
      state.priceHistory.length - offset,
    );

    const sum = relevantPrices.reduce((acc, price) => acc + price, 0);
    return sum / period;
  };

  // Helper function to calculate RSI
  const calculateRSI = (period: number): number => {
    if (state.priceHistory.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = state.priceHistory.length - period; i < state.priceHistory.length; i++) {
      const diff = state.priceHistory[i] - state.priceHistory[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  };

  // Helper function to calculate MACD
  const calculateMACD = (fast: number, slow: number, signal: number): { macd: number, signal: number, hist: number } => {
    if (state.priceHistory.length < slow + signal) return { macd: 0, signal: 0, hist: 0 };
    
    // Simple EMA calculation
    const ema = (period: number, offset = 0) => {
      const k = 2 / (period + 1);
      let emaPrev = state.priceHistory[state.priceHistory.length - period - offset];
      for (let i = state.priceHistory.length - period - offset + 1; i < state.priceHistory.length - offset; i++) {
        emaPrev = state.priceHistory[i] * k + emaPrev * (1 - k);
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
  };

  // Helper function to calculate Bollinger Bands
  const calculateBollinger = (period: number, stdDev: number): { upper: number, lower: number, middle: number } => {
    if (state.priceHistory.length < period) return { upper: 0, lower: 0, middle: 0 };
    
    const prices = state.priceHistory.slice(-period);
    const mean = prices.reduce((a, b) => a + b, 0) / period;
    const variance = prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    
    return { 
      upper: mean + stdDev * std, 
      lower: mean - stdDev * std, 
      middle: mean 
    };
  };

  // Return the strategy implementation
  return {
    getId: (): string => id,

    getName: (): string => name,

    getConfig: (): StrategyConfig => {
      return {
        id,
        name,
        description: `Simple moving average crossover strategy using ${config.shortPeriod} and ${config.longPeriod} periods`,
        parameters: config as unknown as Record<string, unknown>,
      };
    },

    processMarketData: async (
      data: MarketData,
    ): Promise<StrategySignal | null> => {
      // Normalize symbols for comparison
      const configSymbolNorm = normalizeSymbol(config.symbol);
      const dataSymbolNorm = normalizeSymbol(data.symbol);
      
      console.log(`[${data.symbol}] Comparing symbols: Strategy symbol="${config.symbol}" (norm: ${configSymbolNorm}), Data symbol="${data.symbol}" (norm: ${dataSymbolNorm})`);
      
      if (configSymbolNorm !== dataSymbolNorm) {
        console.log(`[${data.symbol}] Symbol mismatch, skipping`);
        return null;
      }
      
      console.log(`[${data.symbol}] Processing market data at ${new Date(data.timestamp).toISOString()}, price: ${data.price}`);
      
      // Add current price to history
      state.priceHistory.push(data.price);
      
      // Calculate required length for all indicators
      const requiredLength = Math.max(
        config.shortPeriod,
        config.longPeriod,
        config.rsiPeriod || 14,
        config.macdSlowPeriod || 26,
        config.bollingerPeriod || 20
      ) + 5; // Add buffer for calculations
      
      // Trim history if needed but keep enough data
      if (state.priceHistory.length > requiredLength * 2) {
        state.priceHistory = state.priceHistory.slice(-requiredLength * 2);
      }
      
      // If we don't have enough data yet, wait - mais ne nécessite que 80% des données
      const minimumRequiredData = Math.floor(requiredLength * 0.8); // Réduit à 80% pour être plus réactif
      if (state.priceHistory.length < minimumRequiredData) {
        console.log(`[${data.symbol}] Building price history: ${state.priceHistory.length}/${minimumRequiredData} (min) / ${requiredLength} (optimal)`);
        return null;
      }
      // MA
      const shortMA = calculateMA(config.shortPeriod);
      const longMA = calculateMA(config.longPeriod);
      const prevShortMA = calculateMA(config.shortPeriod, 1);
      const prevLongMA = calculateMA(config.longPeriod, 1);
      // RSI
      let rsi = 50;
      if (config.useRSI) {
        rsi = calculateRSI(config.rsiPeriod || 14);
      }
      // MACD
      let macd = { macd: 0, signal: 0, hist: 0 };
      if (config.useMACD) {
        macd = calculateMACD(
          config.macdFastPeriod || 12,
          config.macdSlowPeriod || 26,
          config.macdSignalPeriod || 9
        );
      }
      // Bollinger
      let boll = { upper: 0, lower: 0, middle: 0 };
      if (config.useBollinger) {
        boll = calculateBollinger(
          config.bollingerPeriod || 20,
          config.bollingerStdDev || 2
        );
      }
      // LOGS with more details
      console.log(`[${data.symbol}] Price=${data.price.toFixed(2)} | MA: short=${shortMA.toFixed(2)}, long=${longMA.toFixed(2)} | RSI: ${rsi.toFixed(2)} | MACD: ${macd.macd.toFixed(2)}, signal=${macd.signal.toFixed(2)}, hist=${macd.hist.toFixed(2)} | Boll: upper=${boll.upper.toFixed(2)}, lower=${boll.lower.toFixed(2)}`);
      console.log(`[${data.symbol}] History length=${state.priceHistory.length}, required=${requiredLength}, price history sample=${state.priceHistory.slice(-5).map(p => p.toFixed(2)).join(', ')}...`);
      
      // Log conditions - version plus sensible avec critères de croisement élargis
      // Détection de croisement standard
      const standardCrossoverLong = shortMA > longMA && prevShortMA <= prevLongMA;
      const standardCrossoverShort = shortMA < longMA && prevShortMA >= prevLongMA;
      
      // Détection de croisement proche (presque croisement) - beaucoup plus permissif (0,5% au lieu de 0,3%)
      const closeCrossoverLong = Math.abs(shortMA - longMA) / longMA < 0.005 && shortMA > prevShortMA && longMA < prevLongMA;
      const closeCrossoverShort = Math.abs(shortMA - longMA) / longMA < 0.005 && shortMA < prevShortMA && longMA > prevLongMA;
      
      // Confirmation de tendance (pas un croisement, mais un écart croissant) - plus sensible (0,1% au lieu de 0,2%)
      const trendConfirmationLong = shortMA > longMA && (shortMA - longMA) > (prevShortMA - prevLongMA) && (shortMA - longMA) / longMA > 0.001;
      const trendConfirmationShort = shortMA < longMA && (longMA - shortMA) > (prevLongMA - prevShortMA) && (longMA - shortMA) / longMA > 0.001;
      
      // Condition ultra-sensible pour le cas où les MAs sont presque parallèles
      const ultraSensitiveLong = Math.abs(shortMA - longMA) / longMA < 0.008 && shortMA > prevShortMA && shortMA > longMA;
      const ultraSensitiveShort = Math.abs(shortMA - longMA) / longMA < 0.008 && shortMA < prevShortMA && shortMA < longMA;
      
      // Combinaison des conditions pour plus de sensibilité
      const crossoverLong = standardCrossoverLong || closeCrossoverLong || trendConfirmationLong || ultraSensitiveLong;
      const crossoverShort = standardCrossoverShort || closeCrossoverShort || trendConfirmationShort || ultraSensitiveShort;
      
      console.log(`[${data.symbol}] Crossover conditions: Long=${crossoverLong} (std=${standardCrossoverLong}, near=${closeCrossoverLong}, trend=${trendConfirmationLong}), Short=${crossoverShort} (std=${standardCrossoverShort}, near=${closeCrossoverShort}, trend=${trendConfirmationShort})`);
      
      if (config.useRSI) {
        console.log(`[${data.symbol}] RSI conditions: ${rsi} < ${config.rsiOversold || 40} (for long), ${rsi} > ${config.rsiOverbought || 60} (for short)`);
      }
      if (config.useMACD) {
        console.log(`[${data.symbol}] MACD conditions: ${macd.macd} > ${macd.signal} (for long), ${macd.macd} < ${macd.signal} (for short)`);
      }
      if (config.useBollinger) {
        const bollingerBuffer = 0.003; // 0.3% buffer
        console.log(`[${data.symbol}] Bollinger conditions: ${data.price} < ${boll.lower * (1 + bollingerBuffer)} (for long), ${data.price} > ${boll.upper * (1 - bollingerBuffer)} (for short)`);
      }
      
      // Combined signal logic
      let entryLong = crossoverLong;
      let entryShort = crossoverShort;
      
      // Évaluation des indicateurs techniques - optionnels et beaucoup plus permissifs
      // Si la condition de croisement est déjà forte, on peut ignorer certaines conditions des indicateurs
      const strongSignal = standardCrossoverLong || standardCrossoverShort;
      
      if (config.useRSI) {
        // Ultra-permissif sur le RSI - on l'utilise juste comme guide supplémentaire
        const rsiLongCondition = rsi < (config.rsiOversold || 49); // Presque neutre (49 au lieu de 30)
        const rsiShortCondition = rsi > (config.rsiOverbought || 51); // Presque neutre (51 au lieu de 70)
        
        // Si le signal de croisement est fort, on peut être plus permissif sur le RSI
        if (strongSignal) {
          entryLong = entryLong && (rsiLongCondition || rsi < 65); // Très permissif pour les signaux forts
          entryShort = entryShort && (rsiShortCondition || rsi > 35); // Très permissif pour les signaux forts
        } else {
          entryLong = entryLong && rsiLongCondition;
          entryShort = entryShort && rsiShortCondition;
        }
      }
      
      if (config.useMACD) {
        // Ultra-permissif sur le MACD - on regarde juste les tendances générales
        const macdTrendUp = macd.macd >= macd.macd - 0.0005 || macd.hist > -0.0001;
        const macdTrendDown = macd.macd <= macd.macd + 0.0005 || macd.hist < 0.0001;
        
        // Si le signal de croisement est fort, le MACD devient presque facultatif
        if (strongSignal) {
          entryLong = entryLong && (macd.macd > macd.signal - 0.0008 || macdTrendUp);
          entryShort = entryShort && (macd.macd < macd.signal + 0.0008 || macdTrendDown);
        } else {
          entryLong = entryLong && macdTrendUp;
          entryShort = entryShort && macdTrendDown;
        }
      }
      
      if (config.useBollinger) {
        // Conditions Bollinger extrêmement permissives - presque juste informatives
        const bollingerBuffer = 0.015; // 1.5% buffer (extrêmement large)
        entryLong = entryLong && data.price < (boll.lower * (1 + bollingerBuffer));
        entryShort = entryShort && data.price > (boll.upper * (1 - bollingerBuffer));
      }

      console.log(`[${data.symbol}] Final signal conditions: entryLong=${entryLong}, entryShort=${entryShort}, currentPosition=${state.position}`);
      
      // Logique de trading plus agressive avec gestion de position améliorée
      const marketTrend = shortMA > longMA ? "bullish" : "bearish";
      console.log(`[${data.symbol}] Market trend: ${marketTrend}, Position: ${state.position}`);
      
      // Forcer une sortie si le prix a trop bougé contre nous - Aligné avec notre stop loss à 3% pour la règle 3-5-7
      if (state.position === "long" && state.lastEntryPrice && data.price < state.lastEntryPrice * 0.97) {
        state.position = "none";
        state.lastEntryPrice = null;
        console.log(`[${data.symbol}] FORCE EXIT long (price dropped 3%+)`);
        return { type: "exit", direction: "long", price: data.price, reason: "Stop loss 3% (règle 3-5-7)" };
      } else if (state.position === "short" && state.lastEntryPrice && data.price > state.lastEntryPrice * 1.03) {
        state.position = "none";
        state.lastEntryPrice = null;
        console.log(`[${data.symbol}] FORCE EXIT short (price rose 3%+)`);
        return { type: "exit", direction: "short", price: data.price, reason: "Stop loss 3% (règle 3-5-7)" };
      }
      
      // Logique d'entrée et sortie principale
      if (entryLong || (marketTrend === "bullish" && rsi < 35)) { // Condition supplémentaire basée sur RSI
        if (state.position === "short") {
          state.position = "none";
          state.lastEntryPrice = null;
          console.log(`[${data.symbol}] Signal EXIT short (long combiné)`);
          return { type: "exit", direction: "short", price: data.price, reason: "Signal long combiné" };
        } else if (state.position === "none") {
          state.position = "long";
          state.lastEntryPrice = data.price;
          console.log(`[${data.symbol}] Signal ENTRY long (combiné)`);
          return { type: "entry", direction: "long", price: data.price, reason: "Signal long combiné" };
        }
      } else if (entryShort || (marketTrend === "bearish" && rsi > 65)) { // Condition supplémentaire basée sur RSI
        if (state.position === "long") {
          state.position = "none";
          state.lastEntryPrice = null;
          console.log(`[${data.symbol}] Signal EXIT long (short combiné)`);
          return { type: "exit", direction: "long", price: data.price, reason: "Signal short combiné" };
        } else if (state.position === "none") {
          state.position = "short";
          state.lastEntryPrice = data.price;
          console.log(`[${data.symbol}] Signal ENTRY short (combiné)`);
          return { type: "entry", direction: "short", price: data.price, reason: "Signal short combiné" };
        }
      }
      
      // Logique de sortie adaptée à la règle 3-5-7 avec première sortie à 3%
      if (state.position === "long" && state.lastEntryPrice && data.price > state.lastEntryPrice * 1.03) {
        state.position = "none";
        state.lastEntryPrice = null;
        console.log(`[${data.symbol}] PROFIT EXIT long (price +3% - Règle 3-5-7)`);
        return { type: "exit", direction: "long", price: data.price, reason: "Prise de profit règle 3-5-7 (3%)" };
      } else if (state.position === "short" && state.lastEntryPrice && data.price < state.lastEntryPrice * 0.97) {
        state.position = "none";
        state.lastEntryPrice = null;
        console.log(`[${data.symbol}] PROFIT EXIT short (price -3% - Règle 3-5-7)`);
        return { type: "exit", direction: "short", price: data.price, reason: "Prise de profit règle 3-5-7 (3%)" };
      }
      return null;
    },

    generateOrder: (
      signal: StrategySignal,
      marketData: MarketData,
    ): OrderParams | null => {
      // Use normalized symbol comparison for better compatibility
      if (normalizeSymbol(marketData.symbol) !== normalizeSymbol(config.symbol)) {
        return null;
      }

      // Déterminer le côté de l'ordre
      const orderSide =
        (signal.type === "entry" && signal.direction === "long") ||
        (signal.type === "exit" && signal.direction === "short")
          ? OrderSide.BUY
          : OrderSide.SELL;

      // Vérifier la liquidité disponible
      const liquidityPrice =
        orderSide === OrderSide.BUY ? marketData.ask : marketData.bid;
      const midPrice = (marketData.bid + marketData.ask) / 2;

      // Utiliser la taille de compte configurée ou par défaut
      const currentAccountSize = state.accountSize || defaultAccountSize;

      // Calculer la taille de position basée sur le risque
      let positionSize: number;

      if (signal.type === "entry") {
        // Pour les ordres d'entrée, calculer la taille en fonction du risque et du stop loss
        // Montant à risquer = taille du compte * pourcentage de risque par trade
        const reason = signal.reason || "";
        
        // Augmenter le risque si le signal est particulièrement fort
        let confidenceMultiplier = 1.0;
        if (reason.includes("combiné")) {
          confidenceMultiplier = 1.2; // Augmenter le risque de 20% pour les signaux combinés
        }
        
        // Ajuster le multiplicateur en fonction de la volatilité récente
        // (estimation simple basée sur le spread bid-ask et les niveaux de prix)
        const volatilityIndicator = (marketData.ask - marketData.bid) / marketData.price;
        if (volatilityIndicator < 0.001) { // Faible volatilité
          confidenceMultiplier *= 1.3; // Encore plus de confiance quand le marché est calme
        } else if (volatilityIndicator > 0.005) { // Forte volatilité
          confidenceMultiplier *= 0.7; // Réduire l'exposition en période volatile
        }
        
        const riskAmount = currentAccountSize * riskPerTrade * confidenceMultiplier;
        
        // Calcul du stop loss dynamique basé sur la volatilité récente (au minimum 3%)
        // Distance jusqu'au stop loss (en USD)
        const entryPrice = marketData.price;
        const dynamicStopLossPercent = Math.max(stopLossPercent, volatilityIndicator * 10);
        const stopLossDistance = entryPrice * dynamicStopLossPercent;
        
        console.log(`[${marketData.symbol}] Order sizing: confidence=${confidenceMultiplier.toFixed(2)}, volatility=${volatilityIndicator.toFixed(4)}, stopLoss=${dynamicStopLossPercent.toFixed(4)}, riskAmount=${riskAmount.toFixed(2)}`);
        
        // Taille de la position = montant à risquer / distance jusqu'au stop loss
        positionSize = stopLossDistance > 0 ? riskAmount / stopLossDistance : 0;

        // S'assurer que la taille est proportionnelle au buying power - version encore plus dynamique
        const maxPositionValue = currentAccountSize * maxCapitalPerTrade;
        const calculatedPositionValue = positionSize * entryPrice;
        
        // Implémenter une augmentation progressive de la taille des ordres en fonction de la confiance
        // On utilise un système de paliers dynamiques
        let sizeMultiplier = 1.0;
        
        // Si le signal est basé sur un croisement complet des moyennes mobiles, on augmente la confiance
        if (signal.reason && signal.reason.includes("combiné")) {
          sizeMultiplier *= 1.15;
        }
        
        // Si on commence à avoir un petit historique de performance positive, on augmente progressivement
        if (state.accountSize && state.accountSize > defaultAccountSize) {
          const performanceRatio = state.accountSize / defaultAccountSize;
          // Augmenter la taille de 2% pour chaque 1% de performance au-dessus de 100%
          sizeMultiplier *= Math.min(1.5, 1 + ((performanceRatio - 1) * 2));
        }
        
        // Bornes de sécurité: jamais plus de 40% au-dessus de la limite max de capital par trade
        const adjustedMaxPositionValue = maxPositionValue * Math.min(1.4, sizeMultiplier);
        
        if (calculatedPositionValue > adjustedMaxPositionValue) {
          positionSize = adjustedMaxPositionValue / entryPrice;
        }
        
        // Garantir une taille minimum pour éviter les positions trop petites
        const minPositionValue = currentAccountSize * 0.025; // Minimum 2.5% du capital
        if (positionSize * entryPrice < minPositionValue) {
          positionSize = minPositionValue / entryPrice;
        }
        
        console.log(`[${marketData.symbol}] Position sizing: raw=${(calculatedPositionValue).toFixed(2)}, adjusted=${(positionSize * entryPrice).toFixed(2)}, multiplier=${sizeMultiplier.toFixed(2)}`);
      } else {
        // Pour les ordres de sortie, utiliser la même taille que l'entrée ou légèrement plus agressive
        // selon le contexte (sortie en profit vs sortie en perte)
        const isProfit = signal.reason && (signal.reason.includes("profit") || signal.reason.includes("+"));
        positionSize = config.positionSize * (isProfit ? 1.0 : 1.05); // 5% plus grand pour les sorties en perte
      }

      // Vérifier que la taille n'est pas nulle ou invalide
      if (positionSize <= 0) {
        return null;
      }

      // Calculer le slippage actuel
      const currentSlippagePercent =
        Math.abs((liquidityPrice - midPrice) / midPrice) * 100;

      // Estimer la liquidité disponible à partir de l'écart entre le prix et le volume
      // Dans un cas réel, on pourrait utiliser la profondeur du carnet d'ordres
      const estimatedLiquidity = marketData.volume / 24; // Volume horaire approximatif
      const liquidityRatio = estimatedLiquidity / positionSize;

      // Ajuster la taille de la position en fonction de la liquidité
      let adjustedSize = positionSize;

      // Si le slippage est trop élevé, réduire la taille de l'ordre
      if (currentSlippagePercent > maxSlippagePercent) {
        const reductionFactor = maxSlippagePercent / currentSlippagePercent;
        adjustedSize = positionSize * reductionFactor;
      }

      // Si la liquidité est insuffisante, réduire davantage la taille
      if (liquidityRatio < minLiquidityRatio) {
        const liquidityReductionFactor = liquidityRatio / minLiquidityRatio;
        adjustedSize = adjustedSize * liquidityReductionFactor;
      }

      // Si la taille ajustée est trop petite (moins de 10% de la taille originale), ne pas passer d'ordre
      if (adjustedSize < positionSize * 0.1) {
        return null; // Liquidité insuffisante, ne pas passer d'ordre
      }

      // Arrondir la taille à 4 décimales pour éviter les erreurs de précision
      adjustedSize = Math.floor(adjustedSize * 10000) / 10000;

      // Calculer le prix limite en fonction du côté de l'ordre - version plus agressive
      // Pour les achats, on place considérablement au-dessus du bid (exécution garantie)
      // Pour les ventes, on place considérablement en-dessous du ask
      const slippageBuffer = limitOrderBuffer || 0.002; // 0.2% de buffer pour garantir l'exécution (augmenté)
      const limitPrice =
        orderSide === OrderSide.BUY
          ? Math.round(marketData.bid * (1 + slippageBuffer * 1.5) * 100) / 100 // Augmenté de 50% supplémentaires
          : Math.round(marketData.ask * (1 - slippageBuffer * 1.5) * 100) / 100;

      // Pour les ordres d'entrée - version agressive avec ordre limite plus agressif
      // Utiliser des ordres limite avec un buffer agressif pour garantir l'exécution mais obtenir un meilleur prix
      const orderParams: OrderParams = {
        symbol: marketData.symbol, // Utiliser le symbol des données de marché pour éviter les problèmes de format
        side: orderSide,
        type: OrderType.LIMIT, // Utiliser LIMIT au lieu de MARKET pour de meilleurs prix potentiels
        size: adjustedSize,
        price: limitPrice,
        timeInForce: TimeInForce.IMMEDIATE_OR_CANCEL // Exécuter immédiatement ou annuler
      };
      
      console.log(`[${marketData.symbol}] Generated order: ${orderSide} ${adjustedSize} @ ${limitPrice} (type: ${OrderType.LIMIT})`);

      return orderParams;
    },
  };
};
