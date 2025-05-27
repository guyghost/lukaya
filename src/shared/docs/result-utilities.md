# Result Utilities for Lukaya Trading Bot

This documentation explains the enhanced Result pattern implementation and how to use it in the Lukaya Trading Bot codebase to improve error handling and asynchronous operations.

## Overview

The Result pattern is a functional programming approach to error handling that makes error cases explicit in the type system. 
The new utilities we've added enhance this pattern with functional programming concepts and better async support.

## Available Modules

### `result-utils.ts`

Core utilities for the Result pattern:

- `map` - Transform successful results
- `flatMap` - Chain operations
- `fromPromise` - Convert promises to Results
- `withFallback` - Apply fallback values
- `combine` - Merge multiple results
- `tap` - Execute side effects
- `filter` - Apply predicates

### `async-result.ts`

Utilities for handling asynchronous operations:

- `wrapAsync` - Wrap async functions to return Results
- `executeAsync` - Execute async operations with Result handling
- `chainAsync` - Chain multiple async operations
- `executeIfAsync` - Conditionally execute async operations
- `executeAllAsync` - Execute multiple operations in parallel
- `executeAllOrFailAsync` - Execute all or fail if any fails
- `withTimeout` - Add timeout to async operations
- `tapAsync` - Async version of tap for side effects

### `result-transforms.ts`

Advanced transformations for Result objects:

- `fromNullable` - Convert nullable values to Results
- `validate` - Validate values with predicates
- `transform` - Transform both success and error cases
- `join` - Join two Results together
- `partition` - Separate successes and errors
- `fromCondition` - Create Results from conditions
- `fold` - Pattern matching on Results
- `liftFunction` - Convert normal functions to Result functions

### `parallel-execution-result.ts`

Enhanced parallel execution utilities:

- `executeWithConcurrencyLimitResult` - Run tasks with concurrency limits
- `processBatchesWithResults` - Process batches with Result handling
- `collectSuccessfulResults` - Filter and collect successful results
- `retryWithBackoff` - Retry operations with exponential backoff
- `raceWithErrorCollection` - Race promises with error collection

## Usage Examples

### Basic Result Handling

```typescript
import { result } from '../shared/utils';
import { resultUtils } from '../shared/utils/result-index';

// Create a Result
const successResult = result.success(42);
const errorResult = result.error(new Error("Something went wrong"));

// Transform a successful Result
const doubled = resultUtils.map(successResult, x => x * 2);
// doubled = { success: true, data: 84 }

// Chain operations
const chained = resultUtils.flatMap(successResult, x => 
  x > 0 ? result.success(x + 10) : result.error(new Error("Must be positive"))
);
// chained = { success: true, data: 52 }
```

### Async Operations

```typescript
import { executeAsync, chainAsync } from '../shared/utils/async-result';

async function fetchUserData(userId: string) {
  const result = await executeAsync(
    () => api.fetchUser(userId),
    `Failed to fetch user ${userId}`
  );
  
  return result;
}

// Chain multiple async operations
async function processUserData(userId: string) {
  const initialResult = await fetchUserData(userId);
  
  return chainAsync(
    initialResult.data!, // Initial value if successful
    [
      user => validateUser(user),
      user => enrichUserData(user),
      user => saveUserToDatabase(user)
    ]
  );
}
```

### Parallel Execution

```typescript
import { 
  processBatchesWithResults,
  collectSuccessfulResults 
} from '../shared/utils/parallel-execution-result';

// Process items in batches and get Results for each item
async function processUserBatch(userIds: string[]) {
  const results = await processBatchesWithResults(
    userIds,
    id => api.fetchUser(id),
    10,  // batch size
    3    // concurrency limit
  );
  
  // Get only successful results
  const users = results
    .filter(res => res.success)
    .map(res => res.data!);
    
  console.log(`Successfully processed ${users.length} of ${userIds.length} users`);
  
  return users;
}

// Alternative using collectSuccessfulResults
async function getOnlySuccessfulUsers(userIds: string[]) {
  return await collectSuccessfulResults(
    userIds,
    id => api.fetchUser(id),
    5  // concurrency limit
  );
}
```

### Error Handling and Retries

```typescript
import { retryWithBackoff } from '../shared/utils/parallel-execution-result';

async function fetchWithRetry(url: string) {
  return await retryWithBackoff(
    () => fetch(url).then(res => res.json()),
    3,     // max retries
    1000,  // initial delay in ms
    2      // backoff factor
  );
}
```

## Best Practices

1. **Use `fromPromise` for async operations**: Convert all promises to Results for consistent error handling.

2. **Chain operations with `flatMap`**: Use this for operations that depend on the result of previous operations.

3. **Use `withFallback` for graceful degradation**: Provide fallback values when operations fail.

4. **Prefer `executeAsync` over try/catch**: For better readability and consistency.

5. **Use `retryWithBackoff` for network operations**: Make external API calls more resilient.

6. **Use `processBatchesWithResults` for batch operations**: Better control and error handling for parallel processing.

7. **Apply `tap` for logging without breaking chains**: Perfect for adding logging without affecting the result flow.

## Migration Guide

When refactoring existing code to use the new Result utilities, follow these steps:

1. Replace `try/catch` blocks with `executeAsync` or `fromPromise`
2. Replace conditional error checking with `flatMap` or `filter`
3. Use `tapAsync` for side effects like logging
4. Replace parallel processing with the enhanced parallel execution utilities
5. Add retry logic with `retryWithBackoff` for network calls

## Example Refactoring

Before:
```typescript
async function fetchData(id: string) {
  try {
    const response = await api.fetch(id);
    if (!response) {
      return { success: false, error: new Error("No data") };
    }
    return { success: true, data: response };
  } catch (error) {
    console.error("Error fetching data:", error);
    return { success: false, error };
  }
}
```

After:
```typescript
import { resultUtils } from '../shared/utils/result-index';
import { executeAsync } from '../shared/utils/async-result';

async function fetchData(id: string) {
  const result = await executeAsync(() => api.fetch(id));
  
  return resultUtils
    .filter(
      result, 
      data => !!data, 
      "No data received"
    )
    .tap(data => console.log(`Successfully fetched data for ID ${id}`));
}
```
