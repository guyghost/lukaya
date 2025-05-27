/**
 * Result utilities consolidated export
 * Central export for all Result pattern utilities
 */

export { resultUtils } from './result-utils';
export { resultTransforms } from './result-transforms';
export * from './async-result';
export * from './parallel-execution-result';

// Re-export enhanced parallel execution functions from original file
export { 
  batchItems,
  executeWithConcurrencyLimit,
  processBatchesInParallel,
  processBatchesWithResults
} from './parallel-execution';
