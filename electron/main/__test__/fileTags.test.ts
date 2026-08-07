import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { readFileTags } from '../fileTags.js'

describe('readFileTags', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-main-tags-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reads metadata.tags from a valid MindLane file', async () => {
    const file = path.join(tmpDir, 'a.mindmap.json')
    fs.writeFileSync(
      file,
      JSON.stringify({ metadata: { fileUuid: 'u', title: 't', tags: ['工作', '学习'] } }),
      'utf-8',
    )

    await expect(readFileTags(file)).resolves.toEqual(['工作', '学习'])
  })

  it('returns undefined when the file has no tags field', async () => {
    const file = path.join(tmpDir, 'b.mindmap.json')
    fs.writeFileSync(file, JSON.stringify({ metadata: { fileUuid: 'u', title: 't' } }), 'utf-8')

    await expect(readFileTags(file)).resolves.toBeUndefined()
  })

  it('returns undefined when the file does not exist', async () => {
    await expect(readFileTags(path.join(tmpDir, 'missing.json'))).resolves.toBeUndefined()
  })

  it('returns undefined when the file is not valid JSON', async () => {
    const file = path.join(tmpDir, 'c.mindmap.json')
    fs.writeFileSync(file, 'not json', 'utf-8')

    await expect(readFileTags(file)).resolves.toBeUndefined()
  })
})
