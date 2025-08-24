import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 85,
        branches: 55,
        functions: 75,
        statements: 85,
      },
    },
  },
});
