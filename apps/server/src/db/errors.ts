/** Drizzle wraps driver errors, so the Postgres SQLSTATE sits on the error's cause. */
function sqlState(err: unknown): unknown {
  if (!(err instanceof Error)) return undefined;
  const cause: unknown = err.cause;
  return typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined;
}

export const isUniqueViolation = (err: unknown): boolean => sqlState(err) === '23505';

export const isCheckViolation = (err: unknown): boolean => sqlState(err) === '23514';
