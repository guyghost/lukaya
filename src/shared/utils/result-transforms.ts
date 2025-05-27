/**
 * Result pattern transformations and common operations
 * Provides utilities for working with Result objects beyond the basic operations
 */

import { Result } from '../types';
import { result } from './index';
import { resultUtils } from './result-utils';

/**
 * Advanced transformation and utility functions for the Result pattern
 */
export const resultTransforms = {
  /**
   * Convert a nullable value to a Result
   * If the value is null or undefined, returns an error Result
   * 
   * @param value Value to convert
   * @param errorMessage Error message if value is null/undefined
   * @returns Result with the value or an error
   */
  fromNullable<T>(value: T | null | undefined, errorMessage: string): Result<T> {
    if (value === null || value === undefined) {
      return result.error(new Error(errorMessage));
    }
    return result.success(value);
  },

  /**
   * Validate a value with a predicate function
   * If the predicate returns false, returns an error Result
   * 
   * @param value Value to validate
   * @param predicate Validation function
   * @param errorMessage Error message if validation fails
   * @returns Result with the value or an error
   */
  validate<T>(value: T, predicate: (value: T) => boolean, errorMessage: string): Result<T> {
    if (!predicate(value)) {
      return result.error(new Error(errorMessage));
    }
    return result.success(value);
  },

  /**
   * Convert a Result to a different type using a transformation function for both success and error cases
   * 
   * @param res Result to transform
   * @param successFn Function to transform successful data
   * @param errorFn Function to transform error
   * @returns Transformed Result
   */
  transform<T, U, E = Error, F = Error>(
    res: Result<T, E>,
    successFn: (data: T) => U,
    errorFn: (error: E) => F
  ): Result<U, F> {
    if (res.success) {
      try {
        return {
          success: true,
          data: successFn(res.data!),
          message: res.message
        };
      } catch (error) {
        return {
          success: false,
          error: error as F,
          message: `Error during success transformation: ${(error as Error).message}`
        };
      }
    } else {
      try {
        return {
          success: false,
          error: errorFn(res.error!),
          message: res.message
        };
      } catch (error) {
        return {
          success: false,
          error: error as F,
          message: `Error during error transformation: ${(error as Error).message}`
        };
      }
    }
  },

  /**
   * Join two Results together, succeeding only if both succeed
   * The second function receives the result of the first function
   * 
   * @param res First Result
   * @param fn Function that takes the first Result's data and returns a second Result
   * @returns Combined Result
   */
  join<T, U>(res: Result<T>, fn: (data: T) => Result<U>): Result<[T, U]> {
    return resultUtils.flatMap(res, (data) => {
      const secondResult = fn(data);
      if (secondResult.success) {
        return result.success([data, secondResult.data!]);
      }
      return secondResult as unknown as Result<[T, U]>;
    });
  },

  /**
   * Partition an array of Results into successful and error Results
   * 
   * @param results Array of Results to partition
   * @returns Object with arrays of successful and error Results
   */
  partition<T>(results: Result<T>[]): { 
    successes: { data: T, message?: string }[]; 
    errors: { error: Error, message?: string }[];
  } {
    const successes: { data: T, message?: string }[] = [];
    const errors: { error: Error, message?: string }[] = [];
    
    for (const res of results) {
      if (res.success) {
        successes.push({
          data: res.data!,
          message: res.message
        });
      } else {
        errors.push({
          error: res.error!,
          message: res.message
        });
      }
    }
    
    return { successes, errors };
  },

  /**
   * Create a Result based on a condition
   * 
   * @param condition Boolean condition
   * @param successValue Value to use if condition is true
   * @param errorMessage Error message if condition is false
   * @returns Success or error Result based on the condition
   */
  fromCondition<T>(condition: boolean, successValue: T, errorMessage: string): Result<T> {
    if (condition) {
      return result.success(successValue);
    }
    return result.error(new Error(errorMessage));
  },

  /**
   * Convert a Result into a different type based on whether it succeeded or failed
   * 
   * @param res Result to convert
   * @param onSuccess Function to call with data if Result succeeded
   * @param onError Function to call with error if Result failed
   * @returns Value from either onSuccess or onError
   */
  fold<T, U>(res: Result<T>, onSuccess: (data: T) => U, onError: (error: Error) => U): U {
    if (res.success) {
      return onSuccess(res.data!);
    } else {
      return onError(res.error!);
    }
  },

  /**
   * Create a function that safely calls another function and returns a Result
   * 
   * @param fn Function to wrap
   * @returns Wrapped function that returns a Result
   */
  liftFunction<T, Args extends any[]>(fn: (...args: Args) => T): (...args: Args) => Result<T> {
    return (...args: Args): Result<T> => {
      try {
        return result.success(fn(...args));
      } catch (error) {
        return result.error(error as Error);
      }
    };
  }
};
