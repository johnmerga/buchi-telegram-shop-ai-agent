import { fileURLToPath } from 'node:url';
import { loadEnv } from '../config/env';
import { runMigrations } from './migrate';

// The build copies the migrations next to this file, so the same path works from src and dist.
const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

await runMigrations(loadEnv(process.env).DATABASE_URL, migrationsFolder);
