describe('Reliability Improvements Validation', () => {
  test('should detect fully filled error patterns', () => {
    const isFullyFilledError = (error: string): boolean => {
      const patterns = [
        /order is fully filled/i,
        /remaining amount.*0/i,
        /order remaining amount is less than minorderbasequantums/i
      ];
      return patterns.some(pattern => pattern.test(error));
    };

    expect(isFullyFilledError('Order is fully filled')).toBe(true);
    expect(isFullyFilledError('Order remaining amount is less than MinOrderBaseQuantums')).toBe(true);
    expect(isFullyFilledError('Remaining amount: 0')).toBe(true);
    expect(isFullyFilledError('Insufficient funds')).toBe(false);
    expect(isFullyFilledError('Invalid order size')).toBe(false);
  });

  test('should identify duplicate orders', () => {
    const areOrdersDuplicates = (o1: any, o2: any): boolean => {
      return o1.symbol === o2.symbol &&
             o1.side === o2.side &&
             o1.type === o2.type &&
             o1.size === o2.size &&
             o1.price === o2.price;
    };

    const order1 = { symbol: 'BTC-USD', side: 'BUY', type: 'MARKET', size: '0.001', price: undefined };
    const order2 = { symbol: 'BTC-USD', side: 'BUY', type: 'MARKET', size: '0.001', price: undefined };
    const order3 = { symbol: 'BTC-USD', side: 'SELL', type: 'MARKET', size: '0.001', price: undefined };

    expect(areOrdersDuplicates(order1, order2)).toBe(true);
    expect(areOrdersDuplicates(order1, order3)).toBe(false);
  });

  test('should calculate health scores correctly', () => {
    const calculateHealthScore = (totalOrders: number, successfulOrders: number, consecutiveErrors: number): number => {
      if (totalOrders === 0) return 100;
      
      const successRate = successfulOrders / totalOrders;
      const consecutiveErrorPenalty = Math.min(consecutiveErrors * 10, 50);
      
      return Math.max(0, (successRate * 100) - consecutiveErrorPenalty);
    };

    expect(calculateHealthScore(10, 9, 0)).toBeGreaterThan(80);
    expect(calculateHealthScore(10, 5, 5)).toBeLessThan(50);
    expect(calculateHealthScore(0, 0, 0)).toBe(100);
  });

  test('should determine intervention needs', () => {
    const needsIntervention = (consecutiveErrors: number, errorRate: number): boolean => {
      return consecutiveErrors >= 5 || errorRate > 0.3;
    };

    expect(needsIntervention(0, 0.1)).toBe(false);
    expect(needsIntervention(3, 0.2)).toBe(false);
    expect(needsIntervention(5, 0.1)).toBe(true);
    expect(needsIntervention(2, 0.4)).toBe(true);
  });

  test('should create synthetic orders for fully filled errors', () => {
    const createSyntheticFilledOrder = (originalOrder: any, error: string) => {
      const isFullyFilled = /order is fully filled|remaining amount.*0|order remaining amount is less than minorderbasequantums/i.test(error);
      
      if (!isFullyFilled) {
        return null;
      }
      
      return {
        id: `synthetic-${Date.now()}`,
        clientId: originalOrder.clientId,
        symbol: originalOrder.symbol,
        side: originalOrder.side,
        size: originalOrder.size,
        status: 'FILLED',
        filledSize: originalOrder.size,
        averagePrice: originalOrder.price || 50000,
        synthetic: true
      };
    };

    const order = { clientId: 12345, symbol: 'BTC-USD', side: 'BUY', size: '0.001', price: 50000 };
    
    const syntheticOrder = createSyntheticFilledOrder(order, 'Order is fully filled');
    const noSynthetic = createSyntheticFilledOrder(order, 'Insufficient funds');

    expect(syntheticOrder).not.toBeNull();
    expect(syntheticOrder?.status).toBe('FILLED');
    expect(syntheticOrder?.synthetic).toBe(true);
    expect(noSynthetic).toBeNull();
  });

  test('should handle error recovery flow correctly', () => {
    let strategiesActive = true;
    let orderProcessed = false;
    let syntheticOrderCreated = false;
    
    const processOrderError = (error: string, order: any) => {
      const isFullyFilled = /order is fully filled/i.test(error);
      
      if (isFullyFilled) {
        syntheticOrderCreated = true;
        orderProcessed = true;
        strategiesActive = true;
      } else {
        strategiesActive = false;
        orderProcessed = false;
      }
    };

    const order = { symbol: 'BTC-USD', side: 'BUY', size: '0.001' };
    
    // Test fully filled error
    processOrderError('Order is fully filled', order);
    expect(strategiesActive).toBe(true);
    expect(orderProcessed).toBe(true);
    expect(syntheticOrderCreated).toBe(true);
    
    // Reset
    strategiesActive = true;
    orderProcessed = false;
    syntheticOrderCreated = false;
    
    // Test real error
    processOrderError('Insufficient funds', order);
    expect(strategiesActive).toBe(false);
    expect(orderProcessed).toBe(false);
    expect(syntheticOrderCreated).toBe(false);
  });
});
