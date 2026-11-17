# Expected failures are returned as one Result type, and n8n answers are parsed once

An expected failure (missing configuration, an invalid workflow file, an n8n call that fails, an answer that is not the n8n public API) is returned, never thrown. Every such function returns the one `Result<T, E>` of `src/core/result/result.ts`, built with `ok` and `err`, and its error objects are tagged by `kind`. The caller must check it before it can read the value, and a `switch` over the kind must handle every case, so the compiler names each place a new failure has to be handled. A throw is left for a bug or a broken environment: it reaches `bin.ts`, which prints the stack and exits 1. The n8n client parses every body it receives once (`src/core/n8n/n8n-response.ts`); a body that does not match is an `invalid-response` failure, and past the client the types are trusted.

## Considered options

- Exceptions for failures, caught where they are handled: the signature does not say what can fail, a missed `catch` turns an n8n error into a crash with a stack, and `applyPlan` had to catch its own `Stop` error to report the workflows it had not processed.
- One result shape per module (`LoadResult`, `ApiResult`, `ProbeResult`, `ConfigResult` each with its own fields): five ways to check the same thing, which this change replaced with the one type.

## Consequences

- Wrapping each fallible call in `if (!result.ok) return …` makes the code longer than with exceptions.
- An answer from an instance that is not n8n, or from an n8n version with another shape, stops deploy with exit 3 instead of failing deep inside it.
