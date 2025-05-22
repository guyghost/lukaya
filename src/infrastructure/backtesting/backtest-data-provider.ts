import { MarketDataPort } from "../../application/ports/market-data.port";
import { MarketData } from "../../domain/models/market.model";
import { getLogger } from "../logger";
import { BacktestDataOptions } from "./backtest-models";
import * as fs from 'fs';
import * as path from 'path';
import csvParser from 'csv-parser';

/**
 * Fournisseur de données historiques pour le backtesting
 */
export class BacktestDataProvider {
  private logger = getLogger();
  private marketDataEvents: MarketData[] = [];
  private latestDataBySymbol: Map<string, MarketData> = new Map();
  private marketDataListeners: ((data: MarketData) => void)[] = [];
  private config: BacktestDataOptions;
  
  constructor(config: BacktestDataOptions) {
    this.config = config;
  }
  
  /**
   * Charge les données historiques à partir de la source configurée
   */
  public async loadHistoricalData(symbols: string[], startDate: Date, endDate: Date): Promise<void> {
    this.logger.info(`[BACKTEST] Loading historical data for ${symbols.join(', ')} from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    switch (this.config.dataSource) {
      case 'csv':
        await this.loadFromCSV(symbols, startDate, endDate);
        break;
      case 'api':
        await this.loadFromAPI(symbols, startDate, endDate);
        break;
      case 'database':
        await this.loadFromDatabase(symbols, startDate, endDate);
        break;
      default:
        throw new Error(`Unsupported data source: ${this.config.dataSource}`);
    }
    
    // Trier les événements par horodatage
    this.marketDataEvents.sort((a, b) => a.timestamp - b.timestamp);
    
    this.logger.info(`[BACKTEST] Loaded ${this.marketDataEvents.length} market data events`);
  }
  
  /**
   * Charge les données depuis des fichiers CSV
   */
  private async loadFromCSV(symbols: string[], startDate: Date, endDate: Date): Promise<void> {
    if (!this.config.dataPath) {
      throw new Error("Data path not specified for CSV data source");
    }
    
    this.logger.info(`[BACKTEST] Loading CSV data for symbols: ${symbols.join(', ')}`);
    
    // List files in directory for debugging
    const availableFiles = fs.readdirSync(this.config.dataPath).filter(f => f.endsWith('.csv'));
    this.logger.info(`[BACKTEST] Available CSV files: ${availableFiles.join(', ')}`);
    
    for (const symbol of symbols) {
      // Normaliser le symbole pour la compatibilité (convertir les tirets en underscores s'ils existent)
      const normalizedSymbol = symbol.replace('-', '_');
      const filePath = path.join(this.config.dataPath, `${normalizedSymbol}_${this.config.timeframe}.csv`);
      
      if (!fs.existsSync(filePath)) {
        this.logger.warn(`[BACKTEST] CSV file not found for ${symbol}: ${filePath}`);
        this.logger.warn(`[BACKTEST] Will try alternative formats...`);
        
        // Essayer d'autres formats de noms de fichiers
        const alternativeFormats = [
          `${symbol}_${this.config.timeframe}.csv`,
          `${symbol.replace('_', '-')}_${this.config.timeframe}.csv`,
          `${symbol.replace('_', '')}_${this.config.timeframe}.csv`,
          `${symbol.split(/[-_]/)[0]}_${this.config.timeframe}.csv`
        ];
        
        let found = false;
        for (const altPath of alternativeFormats) {
          const fullAltPath = path.join(this.config.dataPath, altPath);
          if (fs.existsSync(fullAltPath)) {
            this.logger.info(`[BACKTEST] Found alternative file: ${fullAltPath}`);
            found = true;
            // Continuer avec ce fichier
            await this.loadCSVFile(symbol, fullAltPath, startDate, endDate);
            break;
          }
        }
        
        if (!found) {
          this.logger.error(`[BACKTEST] No data file found for symbol ${symbol}`);
        }
        
        continue;
      }
      
      await this.loadCSVFile(symbol, filePath, startDate, endDate);
    }
  }
  
  /**
   * Charge un fichier CSV spécifique
   */
  private async loadCSVFile(symbol: string, filePath: string, startDate: Date, endDate: Date): Promise<void> {
    const startTimestamp = startDate.getTime();
    const endTimestamp = endDate.getTime();
    
    this.logger.info(`[BACKTEST] Reading CSV file: ${filePath} for symbol ${symbol}`);
    
    // Lire les données CSV
    const rows: any[] = [];
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (data) => rows.push(data))
        .on('end', () => resolve())
        .on('error', (error) => reject(error));
    });
    
    this.logger.info(`[BACKTEST] Loaded ${rows.length} raw rows from CSV`);
    
    if (rows.length === 0) {
      this.logger.error(`[BACKTEST] No data found in file: ${filePath}`);
      return;
    }
    
    // Debug: afficher les premières lignes pour vérifier la structure
    this.logger.debug(`[BACKTEST] Sample data structure: ${JSON.stringify(rows[0])}`);
    this.logger.debug(`[BACKTEST] Start timestamp: ${startTimestamp}, End timestamp: ${endTimestamp}`);
    this.logger.debug(`[BACKTEST] Start date: ${startDate.toISOString()}, End date: ${endDate.toISOString()}`);
    
    let dataInRange = false;
    
    // Traiter les données
    const parsedData: MarketData[] = [];
    
    for (const row of rows) {
      try {
        const timestamp = new Date(row.timestamp).getTime();
        
        if (isNaN(timestamp)) {
          this.logger.error(`[BACKTEST] Invalid timestamp format in CSV: ${row.timestamp}`);
          continue;
        }
        
        // Pour les données de backtest, accepter toutes les données disponibles
        // même si elles ne sont pas exactement dans la plage demandée
        try {
          const price = parseFloat(row.close);
          const volume = parseFloat(row.volume);
          
          if (isNaN(price) || isNaN(volume)) {
            this.logger.error(`[BACKTEST] Invalid numeric value in CSV - price: ${row.close}, volume: ${row.volume}`);
            continue;
          }
          
          dataInRange = true;
          const marketData: MarketData = {
            symbol,
            price,
            timestamp,
            volume,
            bid: price * 0.9999, // Approximation pour le backtest
            ask: price * 1.0001, // Approximation pour le backtest
          };
          
          parsedData.push(marketData);
        } catch (error) {
          this.logger.error(`[BACKTEST] Error parsing row: ${JSON.stringify(row)} - ${error instanceof Error ? error.message : String(error)}`);
        }
      } catch (error) {
        this.logger.error(`[BACKTEST] Error processing row: ${JSON.stringify(row)} - ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Si nous avons trop peu de données, générer des données synthétiques
    if (parsedData.length < 50 && this.config.interpolateData && parsedData.length > 0) {
      this.logger.info(`[BACKTEST] Not enough data points (${parsedData.length}) for ${symbol}, generating synthetic data...`);
      
      // Trier les données par timestamp pour s'assurer qu'elles sont dans l'ordre
      parsedData.sort((a, b) => a.timestamp - b.timestamp);
      
      const extraData: MarketData[] = [];
      const lastData = parsedData[parsedData.length - 1];
      let lastPrice = lastData.price;
      let lastTimestamp = lastData.timestamp;
      
      // Créer des données supplémentaires pour avoir un total de 100 points
      for (let i = 0; i < Math.max(100 - parsedData.length, 0); i++) {
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
      
      this.logger.info(`[BACKTEST] Generated ${extraData.length} synthetic data points for ${symbol}`);
      
      // Ajouter les données synthétiques aux données réelles
      parsedData.push(...extraData);
    }
    }
    
    // Ajouter les données parsées
    this.marketDataEvents.push(...parsedData);
    
    this.logger.info(`[BACKTEST] Loaded ${parsedData.length} valid market data events for ${symbol}`);
  }
  
  /**
   * Charge les données depuis une API
   */
  private async loadFromAPI(symbols: string[], startDate: Date, endDate: Date): Promise<void> {
    if (!this.config.apiUrl) {
      throw new Error("API URL not specified for API data source");
    }
    
    this.logger.warn("[BACKTEST] API data loading not fully implemented");
    
    // TODO: Implémenter le chargement depuis une API externe
    // Cette partie nécessiterait une mise en œuvre spécifique à l'API utilisée
  }
  
  /**
   * Charge les données depuis une base de données
   */
  private async loadFromDatabase(symbols: string[], startDate: Date, endDate: Date): Promise<void> {
    if (!this.config.dbConnection) {
      throw new Error("Database connection not specified for database data source");
    }
    
    this.logger.warn("[BACKTEST] Database data loading not fully implemented");
    
    // TODO: Implémenter le chargement depuis une base de données
    // Cette partie nécessiterait une mise en œuvre spécifique à la base de données utilisée
  }
  
  /**
   * Obtient tous les événements de données de marché chargés
   */
  public getMarketDataEvents(): MarketData[] {
    return this.marketDataEvents;
  }
  
  /**
   * Crée et retourne un port de données de marché pour le backtesting
   */
  public getMarketDataPort(): MarketDataPort {
    return {
      subscribeToMarketData: async (symbol: string): Promise<void> => {
        this.logger.debug(`[BACKTEST] Subscribed to symbol: ${symbol}`);
        // Dans le backtesting, nous n'avons pas besoin de faire quoi que ce soit ici
        // car les données sont déjà chargées et seront injectées manuellement
        return Promise.resolve();
      },
      
      unsubscribeFromMarketData: async (symbol: string): Promise<void> => {
        this.logger.debug(`[BACKTEST] Unsubscribed from symbol: ${symbol}`);
        // Dans le backtesting, nous n'avons pas besoin de faire quoi que ce soit ici
        return Promise.resolve();
      },
      
      getLatestMarketData: async (symbol: string): Promise<MarketData> => {
        const data = this.latestDataBySymbol.get(symbol);
        if (!data) {
          throw new Error(`No market data available for symbol: ${symbol}`);
        }
        return data;
      }
    };
  }
  
  /**
   * Émet un événement de données de marché dans le système
   */
  public async emitMarketDataEvent(data: MarketData): Promise<void> {
    // Mettre à jour les dernières données connues pour ce symbole
    this.latestDataBySymbol.set(data.symbol, data);
    
    // Notifier les écouteurs
    this.marketDataListeners.forEach(listener => {
      try {
        listener(data);
      } catch (error) {
        this.logger.error(`[BACKTEST] Error in market data listener: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
  
  /**
   * Ajoute un écouteur pour les événements de données de marché
   */
  public addMarketDataListener(listener: (data: MarketData) => void): void {
    this.marketDataListeners.push(listener);
  }
}
