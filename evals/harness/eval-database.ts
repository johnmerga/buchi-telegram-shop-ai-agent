import { fileURLToPath } from 'node:url';
import { runMigrations } from '@buchi/server/db/migrate';
import postgres from 'postgres';

// The migrations sit next to the server's migration runner, as its CLI expects.
const migrationsFolder = fileURLToPath(
  new URL('./migrations', import.meta.resolve('@buchi/server/db/migrate')),
);

/**
 * Drops and recreates the evaluation database with the current schema, so every run starts from
 * the same empty state and never touches development or test data.
 */
export async function recreateEvalDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const databaseName = target.pathname.slice(1);
  const maintenance = new URL(target);
  maintenance.pathname = '/postgres';

  const admin = postgres(maintenance.toString(), { max: 1, onnotice: () => undefined });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }
  await runMigrations(url, migrationsFolder);
}
