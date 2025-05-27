/**
 * Utilities to enhance and standardize the Result<T> pattern implementation
 */
import { Result } from '../types';
import { result } from './index';

/**
 * Functional utilities for working with the Result<T> pattern
 */
export const resultUtils = {
  /**
   * Map a Result's data property to a new value if successful.
   * If the Result is an error, it will be passed through unchanged.
   *
   * @param res The Result object to map
   * @param fn The mapping function to apply to the data
   * @returns A new Result with the mapped data
   */
  map<T, U>(res: Result<T>, fn: (data: T) => U): Result<U> {
    if (!res.success) {
      return res as unknown as Result<U>;
    }
    try {
      return result.success(fn(res.data!));
    } catch (error) {
      return result.error(error as Error);
    }
  },

  /**
   * Chain multiple Result operations together.
   * If any operation in the chain fails, the error is passed through the chain.
   *
   * @param res The initial Result object
   * @param fn The function to apply to the data, which returns a new Result
   * @returns The Result from the chained function or the error Result
   */
  flatMap<T, U>(res: Result<T>, fn: (data: T) => Result<U>): Result<U> {
    if (!res.success) {
      return res as unknown as Result<U>;
    }
    try {
      return fn(res.data!);
    } catch (error) {
      return result.error(error as Error);
    }
  },

  /**
   * Convert a Promise<T> to a Promise<Result<T>>
   * Handles exceptions by converting them to Result.error
   *
   * @param promise The promise to convert
   * @returns A promise that resolves to a Result
   */
  fromPromise<T>(promise: Promise<T>): Promise<Result<T>> {
    return promise
      .then((data) => result.success(data))
      .catch((error) => result.error<T>(error));
  },

  /**
   * Apply a fallback value if the Result is an error
   *
   * @param res The Result object
   * @param fallback The fallback value to use if the Result is an error
   * @returns Either the successful Result data or the fallback value
   */
  withFallback<T>(res: Result<T>, fallback: T): T {
    return res.success ? res.data! : fallback;
  },

  /**
   * Combine multiple Results into a single Result containing an array of all values.
   * If any Result is an error, returns the first error encountered.
   *
   * @param results Array of Results to combine
   * @returns A Result containing an array of all successful values, or the first error
   */
  combine<T>(results: Result<T>[]): Result<T[]> {
    const values: T[] = [];
    for (const res of results) {
      if (!res.success) {
        return res as unknown as Result<T[]>;
      }
      values.push(res.data!);
    }
    return result.success(values);
  },

  /**
   * Execute a side effect function if the Result is successful.
   * The Result is passed through unchanged.
   *
   * @param res The Result object
   * @param fn The side effect function to execute
   * @returns The original Result unchanged
   */
  tap<T>(res: Result<T>, fn: (data: T) => void): Result<T> {
    if (res.success) {
      try {
        fn(res.data!);
      } catch (error) {
        // Intentionally ignore errors in tap functions
        console.error("Error in tap function:", error);
      }
    }
    return res;
  },

  /**
   * Apply a predicate function to filter a Result.
   * If the predicate returns false, returns an error Result.
   *
   * @param res The Result object
   * @param predicate The predicate function to apply
   * @param errorMessage Optional error message if predicate fails
   * @returns The original Result if predicate passes, or an error Result
   */
  filter<T>(res: Result<T>, predicate: (data: T) => boolean, errorMessage?: string): Result<T> {
    if (!res.success) {
      return res;
    }
    if (!predicate(res.data!)) {
      return result.error(new Error(errorMessage || "Failed predicate check"));
    }
    return res;
  }
};
