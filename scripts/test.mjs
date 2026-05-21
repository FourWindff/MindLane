/* eslint-env node */

/**
 * Test runner script that uses Electron as the Node.js runtime to execute Vitest.
 *
 * Background: better-sqlite3 is a native C++ module that must be compiled for a
 * specific Node.js ABI version. The local development machine runs Node.js v22,
 * which uses ABI 127, while Electron 30.5.1 uses ABI 123. A single
 * build/Release/better_sqlite3.node binary cannot be compatible with both ABIs
 * at the same time. This ABI mismatch only affects this specific local setup.
 *
 * This script runs with ELECTRON_RUN_AS_NODE=1, so Electron acts as a Node.js
 * runtime. When `npm run test` is executed, if better-sqlite3 is currently compiled
 * for Electron ABI (123), the build system automatically recompiles it for Node.js
 * ABI (127). Conversely, when `npm run dev` starts the Electron app, if the module
 * is compiled for Node.js ABI (127), it gets recompiled for Electron ABI (123).
 */
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
