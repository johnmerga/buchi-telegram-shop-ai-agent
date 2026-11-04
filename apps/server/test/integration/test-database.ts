/** Integration tests own this database: the global setup drops and recreates it on every run. */
export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://buchi:buchi@localhost:5432/buchi_test';
