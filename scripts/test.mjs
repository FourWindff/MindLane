/* eslint-env node */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const electronPath = path.join(rootDir, 'node_modules', '.bin', 'electron')
const vitestPath = path.join(rootDir, 'node_modules', 'vitest', 'vitest.mjs')

const args = [vitestPath, ...process.argv.slice(2)]

const result = spawnSync(electronPath, args, {
  stdio: 'inherit',
  cwd: rootDir,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  },
})

process.exit(result.status ?? 0)
