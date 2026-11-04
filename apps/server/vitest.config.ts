import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server:unit',
          include: ['src/**/*.test.ts', 'test/*.test.ts'],
        },
      },
      {
        test: {
          name: 'server:integration',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          fileParallelism: false,
        },
      },
    ],
  },
});
