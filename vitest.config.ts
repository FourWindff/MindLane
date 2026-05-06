import { defineConfig } from 'vitest/config'
// @ts-ignore
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['electron/**/*/__test__/**/*.test.ts', 'src/**/__test__/**/*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 60000,
    // Use single thread to avoid memory issues with large PDF
    pool: 'forks',
    // @ts-ignore poolOptions requires vitest v2, remove after upgrade
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Reduce memory usage
    maxConcurrency: 1,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
