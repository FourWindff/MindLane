import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['vitest.setup.ts'],
    // Test layout: a test lives next to the module it covers (`store.ts` + `store.test.ts`
    // in the same directory). Test-only helpers use the `.testutil.ts` suffix, integration
    // tests keep `*.integration.test.ts`. No `__test__/` directories remain anywhere.
    include: [
      'electron/**/*.test.ts',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'contracts/**/*.test.ts',
    ],
    testTimeout: 120000,
    hookTimeout: 60000,
    // Run test files one at a time (single worker) to avoid memory spikes with large PDFs
    fileParallelism: false,
  },
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@': '/src',
      '@contracts': '/contracts',
    },
  },
})
