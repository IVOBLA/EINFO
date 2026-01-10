// vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'client/**',
        'knowledge/**',
        'knowledge_index/**',
        'logs/**',
        'test/**',
        '*.config.js'
      ]
    },
    include: ['server/**/*.test.js', 'test/**/*.test.js'],
    exclude: ['node_modules', 'client'],
    testTimeout: 10000,
    hookTimeout: 10000
  }
});
