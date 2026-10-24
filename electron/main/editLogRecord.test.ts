import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  openInternalStore,
  EDIT_LOG_MAX_ENTRIES,
  type InternalStateStore,
} from '../store/internalStore.js'
import { recordNodeEdit, type EditLogAppendPayload } from './editLogRecord.js'
import type { Workspace } from '../fs/workspace.js'

const WORKSPACE_PATH = '/workspace'
const WORKSPACE_UUID = 'workspace-uuid'
const FILE_UUID = 'file-uuid'

function fakeWorkspace(workspaceUuid = WORKSPACE_UUID): Pick<Workspace, 'load'> {
  return {
    load: async (workspacePath: string) =>
      workspacePath === WORKSPACE_PATH
        ? {
            ok: true,
            data: {
              workspaceUuid,
              activeSessionIds: {},
              fileUuidPaths: {},
              lastOpenedFilePath: null,
            },
          }
        : { ok: false, error: `unknown workspace: ${workspacePath}` },
  } as Pick<Workspace, 'load'>
}

function validPayload(overrides: Partial<EditLogAppendPayload> = {}): EditLogAppendPayload {
  return {
    workspacePath: WORKSPACE_PATH,
    fileUuid: FILE_UUID,
    nodeId: 'node-1',
    before: 'the AI version',
    after: 'the user version',
    ...overrides,
  }
}

describe('recordNodeEdit', () => {
  let tmpDir: string
  let store: InternalStateStore

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-editlog-record-'))
    const opened = openInternalStore(path.join(tmpDir, 'state.db'))
    if (!opened.ok) throw new Error(opened.error)
    store = opened.store
  })

  afterEach(() => {
    store.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('appends one row with the original text before the edit', async () => {
    const appended = await recordNodeEdit(
      { internalStore: store, workspace: fakeWorkspace() },
      validPayload(),
      1234,
    )

    expect(appended).toBe(true)
    expect(store.readEditLog(WORKSPACE_UUID, FILE_UUID)).toEqual([
      { ts: 1234, nodeId: 'node-1', before: 'the AI version', after: 'the user version' },
    ])
  })

  it('appends one row per commit without overwriting earlier evidence', async () => {
    await recordNodeEdit(
      { internalStore: store, workspace: fakeWorkspace() },
      validPayload({ nodeId: 'node-1', before: 'a', after: 'b' }),
      1,
    )
    await recordNodeEdit(
      { internalStore: store, workspace: fakeWorkspace() },
      validPayload({ nodeId: 'node-2', before: 'c', after: 'd' }),
      2,
    )

    expect(store.readEditLog(WORKSPACE_UUID, FILE_UUID)).toEqual([
      { ts: 1, nodeId: 'node-1', before: 'a', after: 'b' },
      { ts: 2, nodeId: 'node-2', before: 'c', after: 'd' },
    ])
  })

  it('keeps the ring cap: the oldest row is dropped once the cap is reached', async () => {
    const deps = { internalStore: store, workspace: fakeWorkspace() }
    for (let i = 0; i < EDIT_LOG_MAX_ENTRIES + 1; i++) {
      await recordNodeEdit(deps, validPayload({ before: `before-${i}`, after: `after-${i}` }), i)
    }

    const entries = store.readEditLog(WORKSPACE_UUID, FILE_UUID)
    expect(entries).toHaveLength(EDIT_LOG_MAX_ENTRIES)
    expect(entries[0]!.before).toBe('before-1')
    expect(entries[entries.length - 1]!.before).toBe(`before-${EDIT_LOG_MAX_ENTRIES}`)
  })

  it('writes nothing when the document has no workspace ownership', async () => {
    const appended = await recordNodeEdit(
      { internalStore: store, workspace: fakeWorkspace() },
      validPayload({ workspacePath: undefined }),
    )

    expect(appended).toBe(false)
    expect(store.readEditLog(WORKSPACE_UUID, FILE_UUID)).toEqual([])
  })

  it('writes nothing when the workspace cannot be resolved', async () => {
    const appended = await recordNodeEdit(
      { internalStore: store, workspace: fakeWorkspace() },
      validPayload({ workspacePath: '/not-a-workspace' }),
    )

    expect(appended).toBe(false)
    expect(store.readEditLog(WORKSPACE_UUID, FILE_UUID)).toEqual([])
  })

  it('writes nothing when a required field is missing', async () => {
    for (const field of ['fileUuid', 'nodeId', 'before', 'after'] as const) {
      const appended = await recordNodeEdit(
        { internalStore: store, workspace: fakeWorkspace() },
        validPayload({ [field]: undefined }),
      )
      expect(appended).toBe(false)
    }
    expect(store.readEditLog(WORKSPACE_UUID, FILE_UUID)).toEqual([])
  })

  it('never creates the legacy editlog directory', async () => {
    await recordNodeEdit({ internalStore: store, workspace: fakeWorkspace() }, validPayload())

    expect(fs.existsSync(path.join(tmpDir, 'memory', 'editlog'))).toBe(false)
  })
})
