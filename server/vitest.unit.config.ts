import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    pool: 'forks',
    fileParallelism: false,
    env: {
      DB_PATH: ':memory:',
    },
    setupFiles: ['./src/__tests__/integration-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
