import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createReadFileTool } from '../readFile.js'

// Loose view of the tool's result union for behavioral assertions.
interface Result {
  ok: boolean
  error?: string
  path?: string
  totalLines?: number
  startLine?: number
  endLine?: number
  truncated?: boolean
  content?: string
}

describe('createReadFileTool', () => {
  let workspace: string
  let outside: string
  let readFile: ReturnType<typeof createReadFileTool>

  const run = (args: { path: string; start?: number; end?: number }): Promise<Result> =>
    readFile.invoke(args) as Promise<Result>

  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'readfile-ws-'))
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'readfile-out-'))
    readFile = createReadFileTool(() => workspace)

    fs.writeFileSync(path.join(workspace, 'notes.md'), '第一行\n第二行\n第三行')
    fs.mkdirSync(path.join(workspace, 'docs'))
    fs.writeFileSync(path.join(workspace, 'docs', 'spec.md'), 'a\nb\nc\nd\ne')
    fs.writeFileSync(path.join(workspace, 'binary.bin'), Buffer.from([0x41, 0x00, 0x42]))
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret')
  })

  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  })

  it('reads a whole file with line-number prefixes and totalLines', async () => {
    const result = await run({ path: 'notes.md' })

    expect(result).toMatchObject({
      ok: true,
      path: 'notes.md',
      totalLines: 3,
      startLine: 1,
      endLine: 3,
      truncated: false,
    })
    expect(result.content).toBe('1→第一行\n2→第二行\n3→第三行')
  })

  it('reads a start/end line range', async () => {
    const result = await run({ path: 'docs/spec.md', start: 2, end: 4 })

    expect(result).toMatchObject({ ok: true, totalLines: 5, startLine: 2, endLine: 4 })
    expect(result.content).toBe('2→b\n3→c\n4→d')
  })

  it('reads from start to EOF when end is omitted', async () => {
    const result = await run({ path: 'docs/spec.md', start: 4 })

    expect(result).toMatchObject({ ok: true, startLine: 4, endLine: 5 })
    expect(result.content).toBe('4→d\n5→e')
  })

  it('returns empty content when start exceeds total lines', async () => {
    const result = await run({ path: 'docs/spec.md', start: 99 })

    expect(result).toMatchObject({ ok: true, totalLines: 5, content: '', truncated: false })
  })

  it('rejects ../ path traversal without leaking absolute paths', async () => {
    const escape = path.relative(workspace, path.join(outside, 'secret.txt'))
    const result = await run({ path: escape })

    expect(result.ok).toBe(false)
    expect(result.error).toContain(escape)
    expect(result.error).not.toContain(outside)
  })

  it('rejects absolute paths outside the workspace', async () => {
    const abs = path.join(outside, 'secret.txt')
    const result = await run({ path: abs })

    expect(result.ok).toBe(false)
    // The error echoes only the user-supplied input, nothing resolved beyond it.
    expect(result.error).toContain(abs)
  })

  it('accepts absolute paths inside the workspace', async () => {
    const result = await run({ path: path.join(workspace, 'notes.md') })

    expect(result).toMatchObject({ ok: true, totalLines: 3 })
  })

  it('reports a missing file', async () => {
    const result = await run({ path: 'nope.md' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('nope.md')
  })

  it('reports a directory path', async () => {
    const result = await run({ path: 'docs' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('目录')
  })

  it('rejects end < start', async () => {
    const result = await run({ path: 'notes.md', start: 3, end: 1 })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('3')
    expect(result.error).toContain('1')
  })

  it('rejects start < 1', async () => {
    const result = await run({ path: 'notes.md', start: 0 })

    expect(result.ok).toBe(false)
  })

  it('rejects end < 1 when start is omitted', async () => {
    const result = await run({ path: 'notes.md', end: 0 })

    expect(result.ok).toBe(false)
  })

  it('rejects binary files containing NUL bytes', async () => {
    const result = await run({ path: 'binary.bin' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('二进制')
  })

  it('truncates files over 2000 lines and annotates totalLines', async () => {
    const big = Array.from({ length: 2100 }, (_, i) => `line${i + 1}`).join('\n')
    fs.writeFileSync(path.join(workspace, 'big.txt'), big)

    const result = await run({ path: 'big.txt' })

    expect(result).toMatchObject({ ok: true, totalLines: 2100, startLine: 1, endLine: 2000, truncated: true })
    expect(result.content).toContain('2000→line2000')
    expect(result.content).not.toContain('2001→')
    expect(result.content).toContain('2100')
    expect(result.content).toContain('start=2001')
  })

  it('truncates a single over-long line', async () => {
    fs.writeFileSync(path.join(workspace, 'minified.js'), 'x'.repeat(5000))

    const result = await run({ path: 'minified.js' })

    expect(result.ok).toBe(true)
    expect(result.content).toContain('1→' + 'x'.repeat(2000))
    expect(result.content).toContain('截断')
    expect(result.content).toContain('5000')
  })

  it('fails cleanly when no workspace is open', async () => {
    const noWorkspace = createReadFileTool(() => '')
    const result = (await noWorkspace.invoke({ path: 'notes.md' })) as Result

    expect(result.ok).toBe(false)
  })
})
