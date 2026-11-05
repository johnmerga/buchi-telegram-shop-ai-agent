import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** The API server, which the dev server forwards API calls to. */
const apiServer = 'http://localhost:3000';
const apiPaths = ['/auth', '/shops', '/driver', '/customer'];

export default defineConfig({
  // The server serves the pages under /app, apart from the API's paths.
  base: '/app/',
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      input: {
        owner: 'owner/index.html',
        driver: 'driver/index.html',
        customer: 'customer/index.html',
      },
    },
  },
  server: {
    proxy: Object.fromEntries(apiPaths.map((path) => [path, apiServer])),
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
