import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { atomicWrite } from './atomicWrite.js'

describe('atomicWrite', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-atomic-write-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('keeps one whole write when two writes race on the same path', async () => {
    const targetPath = path.join(tmpDir, 'state.json')
    const first = 'a'.repeat(4096)
    const second = 'b'.repeat(4096)

    await Promise.all([atomicWrite(targetPath, first), atomicWrite(targetPath, second)])

    expect([first, second]).toContain(fs.readFileSync(targetPath, 'utf-8'))
    expect(fs.readdirSync(tmpDir).filter((name) => name.includes('.tmp.'))).toEqual([])
  })
})
