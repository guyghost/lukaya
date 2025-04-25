import { Order, OrderParams } from "../../domain/models/market.model";

export interface TradingPort {
  placeOrder(orderParams: OrderParams): Promise<Order>;
  cancelOrder(orderId: string): Promise<boolean>;
  getOrder(orderId: string): Promise<Order | null>;
  getOpenOrders(symbol?: string): Promise<Order[]>;
  getAccountBalance(): Promise<Record<string, number>>;
}
