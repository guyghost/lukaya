import { executeWithConcurrencyLimit, batchItems, processBatchesInParallel } from '../../shared/utils/parallel-execution';

/**
 * Tests d'intégration pour les fonctionnalités d'exécution parallèle
 */
describe('Parallel Execution Integration Tests', () => {
  
  test('executeWithConcurrencyLimit should process all tasks with concurrency limit', async () => {
    // Créer un ensemble de tâches avec un délai aléatoire
    const taskCount = 20;
    const executionOrder: number[] = [];
    const results: number[] = [];
    
    const tasks = Array.from({ length: taskCount }, (_, i) => async () => {
      const delay = Math.floor(Math.random() * 50) + 10; // 10-60ms de délai
      await new Promise(resolve => setTimeout(resolve, delay));
      executionOrder.push(i);
      return i * 10;
    });
    
    // Exécuter avec une limite de concurrence de 3
    const concurrencyLimit = 3;
    const output = await executeWithConcurrencyLimit(tasks, concurrencyLimit);
    
    // Vérifier que tous les résultats sont présents et dans le bon ordre
    expect(output).toHaveLength(taskCount);
    expect(output).toEqual(Array.from({ length: taskCount }, (_, i) => i * 10));
    
    // L'ordre d'exécution ne devrait pas correspondre à l'ordre des indices
    // car les tâches sont exécutées en parallèle
    expect(executionOrder).not.toEqual(Array.from({ length: taskCount }, (_, i) => i));
    
    // Cependant, la longueur devrait être la même
    expect(executionOrder).toHaveLength(taskCount);
    
    // Et tous les indices devraient être présents
    const sortedExecutionOrder = [...executionOrder].sort((a, b) => a - b);
    expect(sortedExecutionOrder).toEqual(Array.from({ length: taskCount }, (_, i) => i));
  });
  
  test('batchItems should correctly group items', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    
    // Grouper par lots de 3
    const batches = batchItems(items, 3);
    
    expect(batches).toHaveLength(4);
    expect(batches[0]).toEqual([1, 2, 3]);
    expect(batches[1]).toEqual([4, 5, 6]);
    expect(batches[2]).toEqual([7, 8, 9]);
    expect(batches[3]).toEqual([10]);
  });
  
  test('processBatchesInParallel should process all items in batches', async () => {
    // Créer un ensemble d'éléments
    const items = Array.from({ length: 50 }, (_, i) => i);
    
    // Fonction de traitement qui multiplie par 2 avec un délai aléatoire
    const processor = async (item: number) => {
      const delay = Math.floor(Math.random() * 20) + 5; // 5-25ms de délai
      await new Promise(resolve => setTimeout(resolve, delay));
      return item * 2;
    };
    
    // Traiter avec des lots de 10 et une concurrence de 2
    const results = await processBatchesInParallel(items, processor, 10, 2);
    
    // Vérifier les résultats
    expect(results).toHaveLength(items.length);
    expect(results).toEqual(items.map(i => i * 2));
  });
  
  test('processBatchesInParallel should handle errors gracefully', async () => {
    // Créer un ensemble d'éléments
    const items = Array.from({ length: 20 }, (_, i) => i);
    
    // Fonction de traitement qui échoue pour certains éléments
    const processor = async (item: number) => {
      if (item % 5 === 0) {
        throw new Error(`Erreur pour l'élément ${item}`);
      }
      return item * 2;
    };
    
    // Capturer les erreurs console pour ce test
    const originalError = console.error;
    console.error = jest.fn();
    
    try {
      // Traiter avec des lots de 4 et une concurrence de 2
      const results = await processBatchesInParallel(items, processor, 4, 2);
      
      // Vérifier que nous avons toujours 20 résultats (malgré les erreurs)
      expect(results).toHaveLength(items.length);
      
      // Les éléments qui ont échoué devraient être null
      items.forEach((item, index) => {
        if (item % 5 === 0) {
          expect(results[index]).toBeNull();
        } else {
          expect(results[index]).toBe(item * 2);
        }
      });
      
      // Vérifier que console.error a été appelé pour les erreurs
      expect(console.error).toHaveBeenCalledTimes(4); // Pour les éléments 0, 5, 10, 15
    } finally {
      // Restaurer console.error
      console.error = originalError;
    }
  });
  
  test('parallel execution should be faster than sequential for slow operations', async () => {
    // Créer une tâche artificielle lente
    const slowTask = async (item: number) => {
      await new Promise(resolve => setTimeout(resolve, 50)); // 50ms par tâche
      return item;
    };
    
    // Créer un ensemble d'éléments
    const items = Array.from({ length: 20 }, (_, i) => i);
    
    // Mesurer le temps d'exécution séquentiel
    const startSeq = Date.now();
    const resultsSeq = [];
    for (const item of items) {
      resultsSeq.push(await slowTask(item));
    }
    const endSeq = Date.now();
    const timeSeq = endSeq - startSeq;
    
    // Mesurer le temps d'exécution parallèle
    const startPar = Date.now();
    const resultsPar = await processBatchesInParallel(items, slowTask, 5, 4);
    const endPar = Date.now();
    const timePar = endPar - startPar;
    
    // Le traitement parallèle devrait être significativement plus rapide
    // Avec 4 tâches en parallèle, il devrait être environ 4 fois plus rapide
    // Mais pour tenir compte de la variabilité, nous vérifions qu'il est au moins 2 fois plus rapide
    expect(timeSeq).toBeGreaterThan(timePar * 2);
    
    // Les résultats devraient être identiques
    expect(resultsPar).toEqual(resultsSeq);
  });
});
