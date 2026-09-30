import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['vitest.setup.ts'],
    // Test layout: a test lives next to the module it covers (`store.ts` + `store.test.ts`
    // in the same directory). Test-only helpers use the `.testutil.ts` suffix, integration
    // tests keep `*.integration.test.ts`. The renderer has no `__test__/` directories left;
    // the main process still does (out of scope, not scanned here).
    include: [
      'electron/**/*.test.ts',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'contracts/**/*.test.ts',
    ],
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
    tsconfigPaths: true,
    alias: {
      '@': '/src',
      '@contracts': '/contracts',
    },
  },
})
