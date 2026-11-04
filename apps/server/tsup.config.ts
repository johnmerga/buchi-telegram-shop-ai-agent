import { cp } from 'node:fs/promises';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', migrate: 'src/db/migrate-cli.ts' },
  format: 'esm',
  target: 'node22',
  clean: true,
  onSuccess: () => cp('src/db/migrations', 'dist/migrations', { recursive: true }),
});
