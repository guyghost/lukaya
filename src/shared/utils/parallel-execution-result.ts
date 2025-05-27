/**
 * Enhanced parallel execution utilities with Result pattern integration
 */

import { Result } from '../types';
import { result } from './index';
import { resultUtils } from './result-utils';
import { errorHandler } from '../errors/error-handler';

/**
 * Executes tasks in parallel with a concurrency limit and returns Results
 * @param tasks List of functions that return Promises
 * @param concurrencyLimit Maximum number of promises to execute in parallel
 * @returns Array of Results in the same order as the tasks
 */
export async function executeWithConcurrencyLimitResult<T>(
  tasks: (() => Promise<T>)[],
  concurrencyLimit: number = 5
): Promise<Result<T>[]> {
  const results: Result<T>[] = [];
  let currentIndex = 0;

  // Function to execute a task at the given index
  const executeTask = async (index: number): Promise<void> => {
    if (index >= tasks.length) return;
    
    try {
      const taskResult = await resultUtils.fromPromise(tasks[index]());
      results[index] = taskResult;
    } catch (error) {
      // This catch block should rarely be hit since fromPromise handles errors
      results[index] = errorHandler.handleError<T>(error, `Task ${index} failed unexpectedly`);
    }
    
    // Execute the next task
    await executeTask(currentIndex++);
  };

  // Start the initial tasks in parallel
  const initialWorkers = Math.min(concurrencyLimit, tasks.length);
  const workers = Array(initialWorkers)
    .fill(0)
    .map((_, index) => executeTask(index));
  
  currentIndex = initialWorkers;

  // Wait for all tasks to complete
  await Promise.all(workers);

  return results;
}

/**
 * Groups items into batches for parallel processing
 * @param items Items to group
 * @param batchSize Size of each batch
 * @returns Array of batches
 */
export function batchItems<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Process batches in parallel with Result handling
 * 
 * @param items Items to process
 * @param processor Function that processes each item and returns a Promise
 * @param batchSize Size of each batch
 * @param concurrencyLimit Maximum number of batches to process in parallel
 * @returns Array of Results in the same order as the items
 */
export async function processBatchesWithResults<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  batchSize: number = 5,
  concurrencyLimit: number = 3
): Promise<Result<R>[]> {
  // Group items into batches
  const batches = batchItems(items, batchSize);
  
  // Create tasks for each batch
  const batchTasks = batches.map(batch => async () => {
    const batchPromises = batch.map(item => resultUtils.fromPromise(processor(item)));
    return await Promise.all(batchPromises);
  });
  
  // Execute batches in parallel with concurrency limit
  const batchResultsOfResults = await executeWithConcurrencyLimitResult(batchTasks, concurrencyLimit);
  
  // Extract successful batch results and flatten them
  const results: Result<R>[] = [];
  
  for (const batchResult of batchResultsOfResults) {
    if (batchResult.success && batchResult.data) {
      results.push(...batchResult.data);
    } else {
      // If a batch failed, create placeholder error results
      const errorResults = Array(batchSize).fill(null).map(() => 
        result.error<R>(batchResult.error || new Error('Batch processing failed'), batchResult.message)
      );
      results.push(...errorResults);
    }
  }
  
  // Trim to the original item count (last batch might be partial)
  return results.slice(0, items.length);
}

/**
 * Process items in parallel and collect all successful results
 * Errors are filtered out
 * 
 * @param items Items to process
 * @param processor Function that processes each item and returns a Promise
 * @param concurrencyLimit Maximum number of items to process in parallel
 * @returns Array of successful results only
 */
export async function collectSuccessfulResults<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrencyLimit: number = 5
): Promise<R[]> {
  const processorTasks = items.map(item => () => processor(item));
  const results = await executeWithConcurrencyLimitResult(processorTasks, concurrencyLimit);
  
  // Filter and extract successful results
  return results
    .filter(res => res.success)
    .map(res => res.data!) as R[];
}

/**
 * Retry a function with exponential backoff until it succeeds or max retries is reached
 * 
 * @param fn Function to retry
 * @param maxRetries Maximum number of retry attempts
 * @param initialDelay Initial delay in milliseconds
 * @param backoffFactor Factor to multiply delay by on each retry
 * @returns A Result with the successful value or the last error
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000,
  backoffFactor: number = 2
): Promise<Result<T>> {
  let currentDelay = initialDelay;
  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // If this is a retry, wait before attempting
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, currentDelay));
        currentDelay *= backoffFactor;
      }
      
      const value = await fn();
      return result.success(value);
    } catch (error) {
      lastError = error as Error;
    }
  }
  
  return result.error<T>(
    lastError || new Error('Operation failed after maximum retries'),
    `Failed after ${maxRetries} attempts`
  );
}

/**
 * Race multiple promises and return the first successful result or all errors
 * 
 * @param promises Array of promises to race
 * @param timeout Optional timeout in milliseconds
 * @returns The first successful result or an error with all error messages
 */
export async function raceWithErrorCollection<T>(
  promises: Promise<T>[],
  timeout?: number
): Promise<Result<T>> {
  // Add timeout promise if specified
  if (timeout) {
    const timeoutPromise = new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Operation timed out after ${timeout}ms`)), timeout);
    });
    promises = [...promises, timeoutPromise];
  }
  
  // Convert promises to Results that never throw
  const safePromises = promises.map(p => 
    p.then(
      value => ({ success: true as const, value }), 
      error => ({ success: false as const, error })
    )
  );
  
  // Race the safe promises
  const results = await Promise.all(safePromises);
  
  // Find the first success
  const firstSuccess = results.find(r => r.success);
  if (firstSuccess) {
    return result.success(firstSuccess.value);
  }
  
  // Collect all error messages
  const errorMessages = results
    .filter(r => !r.success)
    .map(r => (r as any).error?.message || 'Unknown error')
    .join('; ');
  
  return result.error<T>(
    new Error(errorMessages || 'All operations failed'),
    'All operations failed'
  );
}
