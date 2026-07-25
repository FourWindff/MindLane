import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { EditLogStore, EDITLOG_MAX_ENTRIES, type EditLogEntry } from '../editLogStore.js'

function makeEntry(i: number): EditLogEntry {
  return { ts: 1000 + i, nodeId: `node-${i}`, before: `before-${i}`, after: `after-${i}` }
}

describe('EditLogStore', () => {
  let tempDir: string
  let store: EditLogStore
  const workspaceUuid = 'workspace-1'
  const fileUuid = 'file-1'

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-editlog-'))
    store = new EditLogStore(tempDir)
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('append creates the file and read returns the entry', async () => {
    await store.append(workspaceUuid, fileUuid, makeEntry(1))

    const entries = await store.read(workspaceUuid, fileUuid)
    expect(entries).toEqual([makeEntry(1)])

    const filePath = path.join(tempDir, 'memory', 'editlog', workspaceUuid, `${fileUuid}.jsonl`)
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('append appends entries in order', async () => {
    await store.append(workspaceUuid, fileUuid, makeEntry(1))
    await store.append(workspaceUuid, fileUuid, makeEntry(2))

    expect(await store.read(workspaceUuid, fileUuid)).toEqual([makeEntry(1), makeEntry(2)])
  })

  it('read returns [] when no file exists', async () => {
    expect(await store.read(workspaceUuid, 'missing')).toEqual([])
  })

  it('drops the oldest entry once the ring cap is reached', async () => {
    for (let i = 0; i < EDITLOG_MAX_ENTRIES; i++) {
      await store.append(workspaceUuid, fileUuid, makeEntry(i))
    }
    await store.append(workspaceUuid, fileUuid, makeEntry(EDITLOG_MAX_ENTRIES))

    const entries = await store.read(workspaceUuid, fileUuid)
    expect(entries).toHaveLength(EDITLOG_MAX_ENTRIES)
    expect(entries[0]).toEqual(makeEntry(1))
    expect(entries[entries.length - 1]).toEqual(makeEntry(EDITLOG_MAX_ENTRIES))
  })

  it('serializes concurrent appends without losing entries', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.append(workspaceUuid, fileUuid, makeEntry(i))),
    )

    const entries = await store.read(workspaceUuid, fileUuid)
    expect(entries).toHaveLength(20)
  })

  it('delete removes the file and is idempotent', async () => {
    await store.append(workspaceUuid, fileUuid, makeEntry(1))
    await store.delete(workspaceUuid, fileUuid)

    expect(await store.read(workspaceUuid, fileUuid)).toEqual([])
    await store.delete(workspaceUuid, fileUuid)
  })
})
