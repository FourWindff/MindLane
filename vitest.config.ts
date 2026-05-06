import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['electron/**/*/__test__/**/*.test.ts', 'src/**/__test__/**/*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 60000,
    // Use single fork sequentially to avoid memory issues with large PDF
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    // Reduce memory usage
    maxConcurrency: 1,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
