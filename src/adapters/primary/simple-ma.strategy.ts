import { 
  MarketData, 
  OrderParams,
  OrderSide,
  OrderType,
  TimeInForce 
} from "../../domain/models/market.model";
import { 
  Strategy,
  StrategyConfig,
  StrategySignal 
} from "../../domain/models/strategy.model";

interface SimpleMAConfig {
  shortPeriod: number;
  longPeriod: number;
  symbol: string;
  positionSize: number;
}

export class SimpleMAStrategy implements Strategy {
  private id: string;
  private name: string;
  private config: SimpleMAConfig;
  private priceHistory: number[] = [];
  private position: "none" | "long" | "short" = "none";

  constructor(config: SimpleMAConfig) {
    this.id = `simple-ma-${config.shortPeriod}-${config.longPeriod}-${config.symbol}`;
    this.name = `Simple Moving Average (${config.shortPeriod}/${config.longPeriod})`;
    this.config = config;
  }

  getId(): string {
    return this.id;
  }

  getName(): string {
    return this.name;
  }

  getConfig(): StrategyConfig {
    return {
      id: this.id,
      name: this.name,
      description: `Simple moving average crossover strategy using ${this.config.shortPeriod} and ${this.config.longPeriod} periods`,
      parameters: this.config as unknown as Record<string, unknown>,
    };
  }

  async processMarketData(data: MarketData): Promise<StrategySignal | null> {
    if (data.symbol !== this.config.symbol) return null;

    // Add price to history
    this.priceHistory.push(data.price);

    // Keep only the required data points
    const requiredLength = Math.max(this.config.shortPeriod, this.config.longPeriod);
    if (this.priceHistory.length > requiredLength) {
      this.priceHistory = this.priceHistory.slice(-requiredLength);
    }

    // Not enough data yet
    if (this.priceHistory.length < requiredLength) {
      return null;
    }

    // Calculate moving averages
    const shortMA = this.calculateMA(this.config.shortPeriod);
    const longMA = this.calculateMA(this.config.longPeriod);

    // Previous moving averages (from one data point ago)
    const prevShortMA = this.calculateMA(this.config.shortPeriod, 1);
    const prevLongMA = this.calculateMA(this.config.longPeriod, 1);

    // Check for crossovers
    if (shortMA > longMA && prevShortMA <= prevLongMA) {
      // Bullish crossover
      if (this.position === "short") {
        // Close short position first
        const exitSignal: StrategySignal = {
          type: "exit",
          direction: "short",
          price: data.price,
          reason: "Moving average bullish crossover",
        };
        this.position = "none";
        return exitSignal;
      } else if (this.position === "none") {
        // Enter long position
        const entrySignal: StrategySignal = {
          type: "entry",
          direction: "long",
          price: data.price,
          reason: "Moving average bullish crossover",
        };
        this.position = "long";
        return entrySignal;
      }
    } else if (shortMA < longMA && prevShortMA >= prevLongMA) {
      // Bearish crossover
      if (this.position === "long") {
        // Close long position first
        const exitSignal: StrategySignal = {
          type: "exit",
          direction: "long",
          price: data.price,
          reason: "Moving average bearish crossover",
        };
        this.position = "none";
        return exitSignal;
      } else if (this.position === "none") {
        // Enter short position
        const entrySignal: StrategySignal = {
          type: "entry",
          direction: "short",
          price: data.price,
          reason: "Moving average bearish crossover",
        };
        this.position = "short";
        return entrySignal;
      }
    }

    return null;
  }

  generateOrder(signal: StrategySignal, marketData: MarketData): OrderParams | null {
    if (marketData.symbol !== this.config.symbol) return null;

    const orderSide = 
      (signal.type === "entry" && signal.direction === "long") || 
      (signal.type === "exit" && signal.direction === "short") 
        ? OrderSide.BUY 
        : OrderSide.SELL;

    return {
      symbol: this.config.symbol,
      side: orderSide,
      type: OrderType.MARKET,
      size: this.config.positionSize,
      timeInForce: TimeInForce.IMMEDIATE_OR_CANCEL,
    };
  }

  private calculateMA(period: number, offset: number = 0): number {
    if (this.priceHistory.length < period + offset) return 0;

    const relevantPrices = this.priceHistory
      .slice(-(period + offset), this.priceHistory.length - offset);

    const sum = relevantPrices.reduce((acc, price) => acc + price, 0);
    return sum / period;
  }
}
