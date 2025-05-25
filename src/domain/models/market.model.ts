export enum OrderSide {
  BUY = "BUY",
  SELL = "SELL",
}

export enum OrderType {
  MARKET = "MARKET",
  LIMIT = "LIMIT",
  STOP = "STOP",
  STOP_LIMIT = "STOP_LIMIT",
  TRAILING_STOP = "TRAILING_STOP",
}

export enum TimeInForce {
  GOOD_TIL_CANCEL = "GOOD_TIL_CANCEL",
  FILL_OR_KILL = "FILL_OR_KILL",
  IMMEDIATE_OR_CANCEL = "IMMEDIATE_OR_CANCEL",
  GOOD_TILL_TIME = "GOOD_TILL_TIME",
  GTT = "GTT",
}

export interface MarketData {
  symbol: string;
  price: number;
  timestamp: number;
  volume: number;
  bid: number;
  ask: number;
  indicators?: Record<string, any>;
}

export interface OrderParams {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  size: number;
  price?: number;
  timeInForce?: TimeInForce;
  reduceOnly?: boolean;
  postOnly?: boolean;
  clientId?: number;
}

export interface Order extends OrderParams {
  id: string;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  filledSize: number;
  avgFillPrice?: number;
}

export enum OrderStatus {
  OPEN = "OPEN",
  FILLED = "FILLED",
  CANCELED = "CANCELED",
  EXPIRED = "EXPIRED",
  REJECTED = "REJECTED",
}
