import { describe, expect, expectTypeOf, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC } from '../../ipc.js'
import type { MindlaneBridge } from '../../ipc.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

/** Walk every .ts/.tsx file under `dir`, skipping node_modules/dist/__test__. */
function walkSourceFiles(dir: string): string[] {
  const out: string[] = []
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__test__') continue
      out.push(...walkSourceFiles(full))
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
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
        const hits = [
          ...(source.includes('ipcRenderer') ? ['ipcRenderer'] : []),
          ...(/from ['"]electron['"]/.test(source) ? ['electron import'] : []),
          ...(/require\(['"]electron['"]\)/.test(source) ? ['electron require'] : []),
        ]
        return hits.length > 0 ? { file: path.relative(repoRoot, f), hits } : null
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

  it('declares Window.mindlane as the same type as MindlaneBridge', () => {
    expectTypeOf<Window['mindlane']>().toMatchTypeOf<MindlaneBridge>()
    expectTypeOf<MindlaneBridge>().toMatchTypeOf<Window['mindlane']>()
  })
})
