import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup-behavior.ts'],
    include: ['./tests/**/*.behavior.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
