import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { runMigrations } from '../../src/db/migrate';
import { testDatabaseUrl } from './test-database';

const migrationsFolder = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

export default async function setup(): Promise<void> {
  const target = new URL(testDatabaseUrl);
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
  await runMigrations(testDatabaseUrl, migrationsFolder);
}
