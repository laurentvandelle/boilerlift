/**
 * The outcome of an expected failure path: a value, or an error the caller must handle. Error objects are tagged by
 * `kind`. A bug or a broken environment is thrown instead, and reaches bin.ts.
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
