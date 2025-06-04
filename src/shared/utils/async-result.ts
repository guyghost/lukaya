/**
 * Async utilities for Result pattern
 * Provides enhanced tools for handling asynchronous operations with the Result pattern
 */

import { Result } from '../types';
import { result } from './index';
import { resultUtils } from './result-utils';
import { errorHandler } from '../errors/error-handler';

/**
 * Wrapper for async functions that need to return a Result
 * More specialized than the generic fromPromise
 * 
 * @param asyncFn Async function to wrap
 * @param errorContext Optional context message for errors
 * @returns A function that returns a Promise<Result<T>>
 */
export function wrapAsync<T, Args extends any[]>(
  asyncFn: (...args: Args) => Promise<T>,
  errorContext?: string
): (...args: Args) => Promise<Result<T>> {
  return async (...args: Args): Promise<Result<T>> => {
    try {
      const result = await asyncFn(...args);
      return { success: true, data: result };
    } catch (error) {
      return errorHandler.handleError<T>(error, errorContext);
    }
  };
}

/**
 * Execute an async function and handle any errors
 * Similar to handleAsync but with better naming
 * 
 * @param fn Async function to execute
 * @param errorContext Optional context message for errors
 * @returns Promise<Result<T>>
 */
export async function executeAsync<T>(
  fn: () => Promise<T>, 
  errorContext?: string
): Promise<Result<T>> {
  try {
    const data = await fn();
    return result.success(data);
  } catch (error) {
    return errorHandler.handleError<T>(error, errorContext);
  }
}

/**
 * Chain multiple async operations that return Results
 * Stops execution on the first error
 * 
 * @param initialValue Initial value to start the chain with
 * @param operations Array of operations to execute in sequence
 * @returns Promise<Result<T>> with the final result or the first error
 */
export async function chainAsync<T>(
  initialValue: T,
  operations: ((value: T) => Promise<Result<T>>)[]
): Promise<Result<T>> {
  let currentValue = initialValue;
  
  for (const operation of operations) {
    const operationResult = await operation(currentValue);
    
    if (!operationResult.success) {
      return operationResult;
    }
    
    currentValue = operationResult.data!;
  }
  
  return result.success(currentValue);
}

/**
 * Conditionally execute an async operation if the condition is true
 * 
 * @param condition Boolean condition to check
 * @param fn Async function to execute if condition is true
 * @param defaultValue Default value to return if condition is false
 * @returns Promise<Result<T>> with the operation result or success with default value
 */
export async function executeIfAsync<T>(
  condition: boolean,
  fn: () => Promise<Result<T>>,
  defaultValue: T
): Promise<Result<T>> {
  if (condition) {
    return await fn();
  }
  return result.success(defaultValue);
}

/**
 * Safely executes a list of async operations, collecting all results
 * Unlike Promise.all, this won't fail if one operation fails
 * 
 * @param operations Array of async operations
 * @returns Promise with array of Results
 */
export async function executeAllAsync<T>(
  operations: (() => Promise<T>)[]
): Promise<Result<T>[]> {
  const results = await Promise.all(
    operations.map(operation => 
      resultUtils.fromPromise(operation())
    )
  );
  
  return results;
}

/**
 * Execute all operations and return success only if all succeed
 * 
 * @param operations Array of async operations
 * @returns Promise<Result<T[]>> with array of all results or first error
 */
export async function executeAllOrFailAsync<T>(
  operations: (() => Promise<T>)[]
): Promise<Result<T[]>> {
  const results = await executeAllAsync(operations);
  
  // Check if any operation failed
  const firstFailure = results.find(res => !res.success);
  if (firstFailure) {
    return firstFailure as unknown as Result<T[]>;
  }
  
  // Extract all successful data
  const data = results.map(res => res.data!);
  return result.success(data);
}

/**
 * Timeout wrapper for async operations
 * 
 * @param promise Promise to wrap with timeout
 * @param timeoutMs Timeout in milliseconds
 * @param timeoutMessage Optional message for timeout error
 * @returns Promise<Result<T>> that resolves to success or timeout error
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage?: string
): Promise<Result<T>> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(timeoutMessage || `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  
  return Promise.race([
    resultUtils.fromPromise(promise),
    resultUtils.fromPromise(timeoutPromise) as Promise<Result<T>>
  ]);
}

/**
 * Async version of tap that awaits the side effect function
 * 
 * @param res Result to tap
 * @param fn Async side effect function
 * @returns Promise resolving to the original Result
 */
export async function tapAsync<T>(
  res: Result<T>,
  fn: (data: T) => Promise<void>
): Promise<Result<T>> {
  if (res.success) {
    try {
      await fn(res.data!);
    } catch (error) {
      // Intentionally ignore errors in tap functions
      console.error("Error in async tap function:", error);
    }
  }
  return res;
}
