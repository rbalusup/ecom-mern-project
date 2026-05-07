import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['src/generated/**', 'tests/**', '**/*.d.ts'],
      thresholds: { lines: 80, functions: 80, branches: 75 },
    },
    poolOptions: {
      forks: { singleFork: true }, // integration tests need shared containers
    },
  },
});
