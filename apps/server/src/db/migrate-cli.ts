import { fileURLToPath } from 'node:url';
import { loadDatabaseUrl } from '../config/env';
import { runMigrations } from './migrate';

// The build copies the migrations next to this file, so the same path works from src and dist.
const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

await runMigrations(loadDatabaseUrl(process.env), migrationsFolder);
