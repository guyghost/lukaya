/**
 * Utilitaire pour exécuter des tâches en parallèle avec limitation
 */
import { Result } from '../types';
import { result } from './index';
import { resultUtils } from './result-utils';

/**
 * Exécute des promesses en parallèle avec une limite de concurrence
 * @param tasks Liste des fonctions qui retournent des promesses
 * @param concurrencyLimit Nombre maximum de promesses exécutées en parallèle
 * @returns Résultats des promesses dans le même ordre que les tâches
 */
export async function executeWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  concurrencyLimit: number = 5
): Promise<T[]> {
  const results: T[] = [];
  let currentIndex = 0;

  // Fonction pour exécuter une tâche à l'index donné
  const executeTask = async (index: number): Promise<void> => {
    if (index >= tasks.length) return;
    
    try {
      const result = await tasks[index]();
      results[index] = result;
    } catch (error) {
      results[index] = null as unknown as T;
      console.error(`Task ${index} failed:`, error);
    }
    
    // Exécuter la tâche suivante
    await executeTask(currentIndex++);
  };

  // Démarrer les premières tâches en parallèle
  const initialWorkers = Math.min(concurrencyLimit, tasks.length);
  const workers = Array(initialWorkers)
    .fill(0)
    .map((_, index) => executeTask(index));
  
  currentIndex = initialWorkers;

  // Attendre que toutes les tâches soient terminées
  await Promise.all(workers);

  return results;
}

/**
 * Groupe les éléments d'un tableau par lot pour traitement en parallèle
 * @param items Éléments à grouper
 * @param batchSize Taille de chaque lot
 * @returns Tableau de lots
 */
export function batchItems<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Exécute des promesses en lots parallèles
 * @param items Éléments à traiter
 * @param processor Fonction qui traite chaque élément et retourne une promesse
 * @param batchSize Taille de chaque lot
 * @param concurrencyLimit Nombre maximum de lots exécutés en parallèle
 * @returns Résultats des promesses dans le même ordre que les éléments
 */
export async function processBatchesInParallel<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  batchSize: number = 5,
  concurrencyLimit: number = 3
): Promise<R[]> {
  // Grouper les éléments par lot
  const batches = batchItems(items, batchSize);
  
  // Créer des tâches pour chaque lot
  const batchTasks = batches.map(batch => async () => {
    const batchResults = await Promise.all(
      batch.map(item => processor(item))
    );
    return batchResults;
  });
  
  // Exécuter les lots en parallèle avec limite
  const batchResults = await executeWithConcurrencyLimit(batchTasks, concurrencyLimit);
  
  // Aplatir les résultats
  return batchResults.flat();
}

/**
 * Version améliorée qui utilise le pattern Result
 * Exécute des promesses en lots parallèles et renvoie des Results
 * @param items Éléments à traiter
 * @param processor Fonction qui traite chaque élément et retourne une promesse
 * @param batchSize Taille de chaque lot
 * @param concurrencyLimit Nombre maximum de lots exécutés en parallèle
 * @returns Résultats des promesses encapsulés dans des Results
 */
export async function processBatchesWithResults<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  batchSize: number = 5,
  concurrencyLimit: number = 3
): Promise<Result<R>[]> {
  // Grouper les éléments par lot
  const batches = batchItems(items, batchSize);
  
  // Créer des tâches pour chaque lot
  const batchTasks = batches.map(batch => async () => {
    const batchPromises = batch.map(item => 
      resultUtils.fromPromise(processor(item))
    );
    return await Promise.all(batchPromises);
  });
  
  // Exécuter les lots en parallèle avec limite
  const batchResults = await executeWithConcurrencyLimit(batchTasks, concurrencyLimit);
  
  // Aplatir les résultats
  return batchResults.flat();
}
