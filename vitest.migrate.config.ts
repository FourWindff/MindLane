import { defineConfig } from 'vitest/config'
import baseConfig from './vitest.config'

/**
 * 一次性迁移 runner 专用配置：把 scripts/ 加入 include。
 * 运行：MIGRATE_WORKSPACE=/path npm test -- run --config vitest.migrate.config.ts scripts/migrate-mindlane-json-to-xml.test.ts
 * 常规 `npm test` 不包含 scripts/，迁移不会意外执行。
 */
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: [
      'electron/**/*/__test__/**/*.test.ts',
      'src/**/__test__/**/*.test.ts',
      'src/**/__test__/**/*.test.tsx',
      'scripts/**/*.test.ts',
    ],
  },
})
