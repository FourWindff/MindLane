import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { _normalize_tool_result, cleanupToolResultOffloads } from './toolResultNormalizer.js'
import { AGENT_LIMITS } from '../config.js'
import { GENERATE_MINDMAP_FRAGMENT_TOOL, GENERATE_PALACE_TOOL } from '../subgraphRouter.js'

describe('ToolResultNormalizer', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-result-normalizer-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns the fallback notice for an empty string', async () => {
    const result = await _normalize_tool_result('searchTool', '', 'call-1')
    expect(result).toContain('Tool searchTool returned no content')
  })

  it('returns the fallback notice for a whitespace-only result', async () => {
    const result = await _normalize_tool_result('searchTool', '   \n\t  ', 'call-1')
    expect(result).toContain('Tool searchTool returned no content')
  })

  it('returns the fallback notice for a null result', async () => {
    const result = await _normalize_tool_result('searchTool', null, 'call-1')
    expect(result).toContain('Tool searchTool returned no content')
  })

  it('returns the fallback notice for an undefined result', async () => {
    const result = await _normalize_tool_result('searchTool', undefined, 'call-1')
    expect(result).toContain('Tool searchTool returned no content')
  })

  it('returns the fallback notice for an object array with no text', async () => {
    const result = await _normalize_tool_result(
      'searchTool',
      [{ type: 'image_url', image_url: 'https://example.com/img.png' }],
      'call-1',
    )
    expect(result).toContain('Tool searchTool returned no content')
  })

  it('returns normal content unchanged', async () => {
    const content = 'This is a normal search result.'
    const result = await _normalize_tool_result('searchTool', content, 'call-1')
    expect(result).toBe(content)
  })

  it('normalizes object array content to string', async () => {
    const result = await _normalize_tool_result(
      'searchTool',
      [{ type: 'text', text: 'hello' }, { text: ' world' }],
      'call-1',
    )
    expect(result).toBe('hello world')
  })

  it('offloads oversized content and returns summary with path', async () => {
    const content = 'a'.repeat(AGENT_LIMITS.toolResultOffloadChars + 100)
    const result = await _normalize_tool_result('searchTool', content, 'call-oversized', tmpDir)

    expect(result).toContain('[Tool result too long; offloaded to a local file]')
    expect(result).toContain('Full result path:')
    expect(result.length).toBeLessThanOrEqual(AGENT_LIMITS.toolResultSummaryChars + 300)

    const offloadDir = path.join(tmpDir, AGENT_LIMITS.toolResultOffloadDirName)
    const files = await fs.promises.readdir(offloadDir)
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/^call-oversized-searchTool\.txt$/)

    const saved = await fs.promises.readFile(path.join(offloadDir, files[0]!), 'utf8')
    expect(saved).toBe(content)
  })

  it('truncates content exceeding max chars when no userDataDir', async () => {
    const content = 'a'.repeat(AGENT_LIMITS.toolResultMaxChars + 100)
    const result = await _normalize_tool_result('searchTool', content, 'call-trunc')

    expect(result.length).toBeLessThanOrEqual(AGENT_LIMITS.toolResultMaxChars)
    expect(result).toContain('[Content exceeded')
    expect(result).toContain('char limit and was truncated.]')
  })

  it('keeps exempt tools unchanged and does not offload', async () => {
    const content = 'a'.repeat(AGENT_LIMITS.toolResultMaxChars + 100)

    const mindmapResult = await _normalize_tool_result(
      GENERATE_MINDMAP_FRAGMENT_TOOL,
      content,
      'call-exempt-1',
      tmpDir,
    )
    expect(mindmapResult).toBe(content)

    const palaceResult = await _normalize_tool_result(
      GENERATE_PALACE_TOOL,
      content,
      'call-exempt-2',
      tmpDir,
    )
    expect(palaceResult).toBe(content)

    const offloadDir = path.join(tmpDir, AGENT_LIMITS.toolResultOffloadDirName)
    expect(fs.existsSync(offloadDir)).toBe(false)
  })

  it('does not apply empty fallback to exempt tools', async () => {
    const result = await _normalize_tool_result(
      GENERATE_MINDMAP_FRAGMENT_TOOL,
      '',
      'call-empty-exempt',
      tmpDir,
    )
    expect(result).toContain('Tool generateMindmapFragment returned no content')
  })

  it('truncates without file reference when userDataDir is missing', async () => {
    const content = 'b'.repeat(AGENT_LIMITS.toolResultOffloadChars + 50)
    const result = await _normalize_tool_result('searchTool', content, 'call-nodir')

    expect(result).toContain('[Content exceeded')
    expect(result).not.toContain('Full result path:')
  })

  it('sanitizes file names with special characters', async () => {
    const content = 'c'.repeat(AGENT_LIMITS.toolResultOffloadChars + 50)
    await _normalize_tool_result('tool/with\\special:chars', content, 'call-id/with:chars', tmpDir)

    const offloadDir = path.join(tmpDir, AGENT_LIMITS.toolResultOffloadDirName)
    const files = await fs.promises.readdir(offloadDir)
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/^call-id_with_chars-tool_with_special_chars\.txt$/)
  })

  it('cleans up stale offloaded tool result files', async () => {
    const offloadDir = path.join(tmpDir, AGENT_LIMITS.toolResultOffloadDirName)
    fs.mkdirSync(offloadDir, { recursive: true })
    const staleFile = path.join(offloadDir, 'stale.txt')
    const recentFile = path.join(offloadDir, 'recent.txt')
    const nestedDir = path.join(offloadDir, 'nested')
    fs.writeFileSync(staleFile, 'old', 'utf8')
    fs.writeFileSync(recentFile, 'new', 'utf8')
    fs.mkdirSync(nestedDir)

    const now = new Date()
    const stale = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000)
    fs.utimesSync(staleFile, stale, stale)
    fs.utimesSync(recentFile, now, now)

    const removed = await cleanupToolResultOffloads(tmpDir, {
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
      now: now.getTime(),
    })

    expect(removed).toBe(1)
    expect(fs.existsSync(staleFile)).toBe(false)
    expect(fs.existsSync(recentFile)).toBe(true)
    expect(fs.existsSync(nestedDir)).toBe(true)
  })
})
