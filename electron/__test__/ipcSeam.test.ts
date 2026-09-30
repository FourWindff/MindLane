import { describe, expect, expectTypeOf, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC } from '../ipc.js'
import type { MindLaneBridge, McpConnectPayload } from '../ipc.js'
import type { McpCredentialField, McpServerStatusInfo } from '../mcp/types.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Walk every .ts/.tsx file under `dir`, skipping node_modules/dist and test files. */
function walkSourceFiles(dir: string): string[] {
  const out: string[] = []
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Main-process fixtures still live under `__test__`; the renderer has none.
      if (entry.name === '__test__') continue
      out.push(...walkSourceFiles(full))
    } else if (isSourceFile(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** Tests sit next to the module they cover; the boundary scans only see production code. */
function isSourceFile(name: string): boolean {
  if (!name.endsWith('.ts') && !name.endsWith('.tsx')) return false
  return !(name.endsWith('.test.ts') || name.endsWith('.test.tsx') || name.endsWith('.testutil.ts'))
}

const IMPORT_SPECIFIER = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g

function importsIn(source: string): string[] {
  return [...source.matchAll(IMPORT_SPECIFIER)].map((match) => match[1]!)
}

/** Resolve an import specifier to a repo-relative path; bare packages return null. */
function resolveImport(fromFile: string, specifier: string): string | null {
  if (specifier === 'electron' || specifier.startsWith('electron/')) return specifier
  if (specifier.startsWith('@contracts/'))
    return `contracts/${specifier.slice('@contracts/'.length)}`
  if (specifier.startsWith('@/')) return `src/${specifier.slice('@/'.length)}`
  if (specifier.startsWith('.')) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))
  }
  return null
}

const FEATURE_LAYERS = ['settings', 'mindmap', 'workspace', 'chat'] as const

type ModuleLayer = 'app' | 'shared' | 'contracts' | 'electron' | `features/${string}`

function moduleLayer(relativePath: string): ModuleLayer | null {
  const scoped = relativePath.startsWith('src/') ? relativePath.slice('src/'.length) : relativePath
  const [head, second] = scoped.split('/')
  if (head === 'features' && second) return `features/${second}`
  if (head === 'app') return 'app'
  if (head === 'shared') return 'shared'
  if (head === 'contracts') return 'contracts'
  if (head === 'electron') return 'electron'
  return null
}

const enumMembers = new Set<string>(Object.keys(IPC))

/** Channel expressions passed to invoke/send/handle/on across the main process. */
function collectChannels(files: string[]): Array<{ file: string; token: string }> {
  const channels: Array<{ file: string; token: string }> = []
  const re =
    /(?:ipcMain\.(?:handle|on)|ipcRenderer\.(?:invoke|send|on|off)|webContents\.send)\(\s*([^,\s)]+)/g
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf-8')
    for (const match of source.matchAll(re)) {
      channels.push({ file: path.relative(repoRoot, file), token: match[1]! })
    }
  }
  return channels
}

/** Collect IPC member names passed to a specific channel API across `files`. */
function collectApiMembers(files: string[], re: RegExp): string[] {
  const members: string[] = []
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf-8')
    for (const match of source.matchAll(re)) {
      members.push(match[1]!)
    }
  }
  return members
}

function collectEnumUsages(files: string[]): Set<string> {
  const usages = new Set<string>()
  const re = /IPC\.([A-Za-z0-9_]+)/g
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf-8')
    for (const match of source.matchAll(re)) {
      usages.add(match[1]!)
    }
  }
  return usages
}

/** 7 个 handler 模块的文件清单（注册完整性的守卫对象）。 */
const handlerModuleFiles = [
  'electron/main/handlers/fs.ts',
  'electron/main/handlers/ai.ts',
  'electron/main/handlers/chat.ts',
  'electron/main/handlers/settings.ts',
  'electron/main/handlers/mcp.ts',
  'electron/main/handlers/shell.ts',
  'electron/main/handlers/window.ts',
].map((f) => path.join(repoRoot, f))

describe('IPC seam contract', () => {
  const mainProcessFiles = walkSourceFiles(path.join(repoRoot, 'electron')).filter(
    (f) => !f.endsWith('ipc.ts'),
  )
  const rendererFiles = walkSourceFiles(path.join(repoRoot, 'src'))

  it('keeps every invoke/send/handle/on channel on an IPC enum member', () => {
    const channels = collectChannels(mainProcessFiles)
    expect(channels.length).toBeGreaterThan(0)
    for (const { file, token } of channels) {
      const member = token.match(/^IPC\.([A-Za-z0-9_]+)$/)?.[1]
      expect(member, `${file}: channel must be an IPC enum member, got \`${token}\``).toBeTruthy()
      expect(enumMembers.has(member!), `${file}: IPC.${member} is not a declared enum member`).toBe(
        true,
      )
    }
  })

  it('leaves the renderer with zero ipcRenderer references and zero electron imports', () => {
    expect(rendererFiles.length).toBeGreaterThan(0)
    const offenders = rendererFiles
      .map((f) => {
        const source = fs.readFileSync(f, 'utf-8')
        const relative = path.relative(repoRoot, f).split(path.sep).join('/')
        const hits = [
          ...(source.includes('ipcRenderer') ? ['ipcRenderer'] : []),
          ...(/require\(['"]electron['"]\)/.test(source) ? ['electron require'] : []),
          ...importsIn(source).flatMap((specifier) => {
            const target = resolveImport(relative, specifier)
            return target === 'electron' || target?.startsWith('electron/')
              ? [`electron import (${specifier})`]
              : []
          }),
        ]
        return hits.length > 0 ? { file: relative, hits: [...new Set(hits)] } : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    expect(offenders).toEqual([])
  })

  it('does not re-expose the raw ipcRenderer through the bridge', () => {
    const preload = fs.readFileSync(path.join(repoRoot, 'electron', 'preload.ts'), 'utf-8')
    expect(preload).not.toContain("exposeInMainWorld('ipcRenderer'")
    expect(preload).not.toContain('window.ipcRenderer')
  })

  it('has no orphan IPC enum members', () => {
    const usages = collectEnumUsages(mainProcessFiles)
    const orphans = [...enumMembers].filter((m) => !usages.has(m))
    expect(orphans).toEqual([])
  })

  it('registers each IPC channel exactly once across the 7 handler modules', () => {
    const registered = collectApiMembers(
      handlerModuleFiles,
      /ipcMain\.(?:handle|on)\(\s*IPC\.([A-Za-z0-9_]+)/g,
    )
    expect(registered.length).toBeGreaterThan(0)
    const duplicates = registered.filter((m, i) => registered.indexOf(m) !== i)
    expect(duplicates).toEqual([])
  })

  it('maps handler-registered channels one-to-one with preload request channels', () => {
    // 预加载桥实际使用的主→渲 channel（invoke/send 请求侧）必须全部在主进程注册，且每个恰好一次。
    const registered = new Set(
      collectApiMembers(handlerModuleFiles, /ipcMain\.(?:handle|on)\(\s*IPC\.([A-Za-z0-9_]+)/g),
    )
    const preload = fs.readFileSync(path.join(repoRoot, 'electron', 'preload.ts'), 'utf-8')
    const requested = new Set(
      [...preload.matchAll(/ipcRenderer\.(?:invoke|send)\(\s*IPC\.([A-Za-z0-9_]+)/g)].map(
        (m) => m[1]!,
      ),
    )

    // 防漏注册：渲染层调用的 channel 必须有主进程 handler。
    const missing = [...requested].filter((m) => !registered.has(m))
    expect(missing).toEqual([])

    // 防幽灵注册：主进程注册的 channel 必须被 preload 请求使用。
    const mainOnly = [...registered].filter((m) => !requested.has(m))
    expect(mainOnly).toEqual([])
  })

  it('pairs webContents.send push channels with preload on-channels', () => {
    const pushed = collectApiMembers(
      mainProcessFiles,
      /webContents\.send\(\s*IPC\.([A-Za-z0-9_]+)/g,
    )
    const preload = fs.readFileSync(path.join(repoRoot, 'electron', 'preload.ts'), 'utf-8')
    const listened = [...preload.matchAll(/ipcRenderer\.on\(\s*IPC\.([A-Za-z0-9_]+)/g)].map(
      (m) => m[1]!,
    )
    expect(pushed.sort()).toEqual(listened.sort())
  })

  it('declares Window.mindlane as the same type as MindLaneBridge', () => {
    expectTypeOf<Window['mindlane']>().toMatchTypeOf<MindLaneBridge>()
    expectTypeOf<MindLaneBridge>().toMatchTypeOf<Window['mindlane']>()
  })

  it('McpConnect 契约：payload 支持携带凭据，状态信息携带表单字段元数据与失败指引', () => {
    // payload：非 OAuth server 可通过 credentials 附带表单凭据（OAuth server 省略）
    expectTypeOf<McpConnectPayload>().toMatchTypeOf<{
      serverId: string
      credentials?: Record<string, string>
    }>()
    const withCredentials: McpConnectPayload = {
      serverId: 'obsidian',
      credentials: { apiKey: 'k' },
    }
    expectTypeOf(withCredentials).toMatchTypeOf<McpConnectPayload>()
    // 状态信息：非 OAuth server 暴露 credentialFields / failureHint 给渲染层画表单、显示指引
    expectTypeOf<McpServerStatusInfo>().toMatchTypeOf<{
      credentialFields?: McpCredentialField[]
      failureHint?: string
    }>()
    expectTypeOf<McpCredentialField>().toMatchTypeOf<{
      id: string
      label: string
      required?: boolean
      secret?: boolean
    }>()
  })
})

// ---- 渲染层模块边界（ADR-0024 / ADR-0025） ----
// 静态断言，不是行为测试：层级表是防复发的唯一守卫。

describe('renderer module boundaries', () => {
  const sourceFiles = [
    ...walkSourceFiles(path.join(repoRoot, 'src')),
    ...walkSourceFiles(path.join(repoRoot, 'contracts')),
  ].map((f) => path.relative(repoRoot, f).split(path.sep).join('/'))

  /** Imports of one source file, resolved to repo-relative module paths. */
  function resolvedImports(file: string): Array<{ specifier: string; target: string }> {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf-8')
    const out: Array<{ specifier: string; target: string }> = []
    for (const specifier of importsIn(source)) {
      const target = resolveImport(file, specifier)
      if (target) out.push({ specifier, target })
    }
    return out
  }

  it('keeps the feature set closed', () => {
    const featureDirs = new Set(
      sourceFiles
        .map((file) => moduleLayer(file))
        .filter((layer): layer is `features/${string}` => Boolean(layer?.startsWith('features/'))),
    )
    expect([...featureDirs].sort()).toEqual(
      FEATURE_LAYERS.map((layer) => `features/${layer}`).sort(),
    )
  })

  it('keeps feature imports one-way: settings < mindmap < workspace < chat < app', () => {
    const offenders: string[] = []
    for (const file of sourceFiles) {
      const from = moduleLayer(file)
      if (!from || !from.startsWith('features/')) continue
      for (const { specifier, target } of resolvedImports(file)) {
        const to = moduleLayer(target)
        if (!to) continue
        if (to === from) continue
        if (to === 'app') {
          offenders.push(`${file}: ${from} must not import the composition root (${specifier})`)
          continue
        }
        if (!to.startsWith('features/')) continue
        const fromIndex = FEATURE_LAYERS.indexOf(from.slice('features/'.length) as never)
        const toIndex = FEATURE_LAYERS.indexOf(to.slice('features/'.length) as never)
        if (toIndex > fromIndex) {
          offenders.push(`${file}: ${from} must not import upper layer ${to} (${specifier})`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps shared free of app and feature knowledge', () => {
    const offenders: string[] = []
    for (const file of sourceFiles) {
      if (moduleLayer(file) !== 'shared') continue
      for (const { specifier, target } of resolvedImports(file)) {
        const to = moduleLayer(target)
        if (to === 'app' || to?.startsWith('features/')) {
          offenders.push(`${file}: shared must not import ${to} (${specifier})`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps contracts a leaf: no src/ or electron/ imports', () => {
    const offenders: string[] = []
    for (const file of sourceFiles) {
      if (moduleLayer(file) !== 'contracts') continue
      for (const { specifier, target } of resolvedImports(file)) {
        const to = moduleLayer(target)
        if (to && to !== 'contracts') {
          offenders.push(`${file}: contracts must not import ${to} (${specifier})`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
