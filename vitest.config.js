import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['index.js', 'index.cjs', 'src/**/*.js'],
      thresholds: {
        lines: 85,
        branches: 55,
        functions: 75,
        statements: 85,
      },
    },
  },
});
