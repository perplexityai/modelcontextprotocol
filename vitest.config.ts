import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
    env: {
      OPENROUTER_API_KEY: 'test-api-key',
      PERPLEXITY_API_KEY: 'test-perplexity-key', // For search API tests
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.test.ts',
        '**/*.config.ts',
      ],
    },
  },
})
