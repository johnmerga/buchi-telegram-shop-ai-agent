/** Drizzle wraps driver errors, so the Postgres SQLSTATE sits on the error's cause. */
function sqlState(err: unknown): unknown {
  if (!(err instanceof Error)) return undefined;
  const cause: unknown = err.cause;
  return typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined;
}

export const isUniqueViolation = (err: unknown): boolean => sqlState(err) === '23505';

export const isCheckViolation = (err: unknown): boolean => sqlState(err) === '23514';

export const isQueryTimeout = (err: unknown): boolean => sqlState(err) === '57014';

/**
 * Postgres's message for a mistake in the query itself: SQLSTATE class 42 (syntax or a name that
 * does not exist) or 22 (bad data, such as a division by zero). It names only the query's parts.
 */
export function queryMistake(err: unknown): string | undefined {
  const state = sqlState(err);
  if (typeof state !== 'string' || !/^(42|22)/.test(state)) return undefined;
  return err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
}
