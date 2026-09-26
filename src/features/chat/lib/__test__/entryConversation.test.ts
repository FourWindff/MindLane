import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backfillEntryFileTitle, createEntryFile, entryFileTitle } from '../entryConversation'
import { mindmapRegistry } from '@/features/mindmap/model/mindmapRegistry'
import { useAiStore } from '@/features/chat/model/aiStore'
import { useWorkspaceStore } from '@/app/workspace/store'
import { createEmptyFile, type DocumentRef } from '@/shared/lib/fileFormat'

function installBridge() {
  const createFile = vi.fn(
    async (payload: {
      workspacePath: string
      name: string
      data: unknown
    }): Promise<
      { ok: true; data: { filePath: string; data: unknown } } | { ok: false; error: string }
    > => ({
      ok: true,
      data: { filePath: `${payload.workspacePath}/${payload.name}.mindlane`, data: payload.data },
    }),
  )
  const renameItem = vi.fn(async (payload: { oldPath: string; newName: string }) => ({
    ok: true as const,
    data: { newPath: `/workspace/${payload.newName}.mindlane` },
  }))
  vi.stubGlobal('window', {
    mindlane: {
      workspace: {
        createFile,
        renameItem,
        updateFileUuidPath: vi.fn(async () => ({ ok: true as const })),
        listFiles: vi.fn(async () => ({ ok: true, data: [] })),
        listTree: vi.fn(async () => ({ ok: true, data: [] })),
        getSession: vi.fn(async () => ({
          workspacePath: '/workspace',
          workspaceUuid: 'workspace-uuid',
          activeSessionIds: {},
          recentWorkspacePaths: ['/workspace'],
          lastOpenedFilePath: null,
          restoreLastWorkspaceOnLaunch: true,
        })),
      },
      chat: {
        listSessions: vi.fn(async () => ({ ok: true, data: { sessions: [] } })),
      },
    },
  })
  return { createFile, renameItem }
}

const PDF: DocumentRef = {
  id: 'doc-1',
  type: 'pdf',
  source: '/报告.pdf',
  filename: '报告.pdf',
  importedAt: '2026-01-01T00:00:00.000Z',
}

describe('entryFileTitle', () => {
  it('takes the first input line for text-only sends', () => {
    expect(entryFileTitle('  第一行标题\n第二行内容', null)).toBe('第一行标题')
  })

  it('takes the attachment name (without extension) when a document is attached', () => {
    expect(entryFileTitle('随便写点什么', PDF)).toBe('报告')
    // A link's display name (host + pathname) has no strippable extension; its slashes are illegal name chars.
    expect(entryFileTitle('随便写点什么', { ...PDF, type: 'url', filename: 'example.com/a' })).toBe(
      'example.com a',
    )
  })

  it('keeps the title usable as a file name', () => {
    expect(entryFileTitle('a/b:c*d?e"f<g>h|i', null)).toBe('a b c d e f g h i')
    expect(entryFileTitle('x'.repeat(500), null).length).toBeLessThanOrEqual(60)
    expect(entryFileTitle('   ', null)).toBe('未命名')
  })
})

describe('entry conversation file lifecycle', () => {
  beforeEach(() => {
    mindmapRegistry.releaseAll()
    useAiStore.setState({
      currentFileUuid: null,
      currentFilePath: null,
      fileChats: {},
      sessionFileUuids: {},
      loadedFileChats: {},
      workspacePath: '/workspace',
    })
    useWorkspaceStore.setState({
      busy: false,
      lastError: null,
      workspacePath: '/workspace',
      tree: [],
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    mindmapRegistry.releaseAll()
  })

  it('creates and opens the file (editor ready) under the derived title', async () => {
    const { createFile } = installBridge()

    const entry = await createEntryFile('帮我整理一份学习计划', null)

    expect(createFile).toHaveBeenCalledWith(
      expect.objectContaining({ workspacePath: '/workspace', name: '帮我整理一份学习计划' }),
    )
    const active = mindmapRegistry.getActiveFile()
    expect(entry).toEqual({ fileUuid: active?.fileUuid, filePath: active?.filePath })
    expect(active?.filePath).toBe('/workspace/帮我整理一份学习计划.mindlane')
  })

  it('numbers the file when the derived title is already taken', async () => {
    const { createFile } = installBridge()
    createFile.mockResolvedValueOnce({ ok: false as const, error: '文件已存在' })

    const entry = await createEntryFile('第一季度复盘', null)

    expect(createFile).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: '第一季度复盘' }))
    expect(createFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: '第一季度复盘-2' }),
    )
    expect(entry?.filePath).toBe('/workspace/第一季度复盘-2.mindlane')
  })

  it('backfills the generated map title onto the file created by the entry turn', async () => {
    const { renameItem } = installBridge()
    await createEntryFile('先起个占位标题', null)
    const fileUuid = mindmapRegistry.getActiveFile()!.fileUuid

    backfillEntryFileTitle(fileUuid, 'Ruby 学习路线')

    expect(renameItem).toHaveBeenCalledWith({
      oldPath: '/workspace/先起个占位标题.mindlane',
      newName: 'Ruby 学习路线',
      workspacePath: '/workspace',
    })
    expect(mindmapRegistry.getByFileUuid(fileUuid)!.store.getState().fileTitle).toBe(
      'Ruby 学习路线',
    )
  })

  it('keeps the backfill available while the entry file is not open', async () => {
    const { renameItem } = installBridge()
    await createEntryFile('先起个占位标题', null)
    const closed = mindmapRegistry.getActiveFile()!
    mindmapRegistry.releaseAll()

    backfillEntryFileTitle(closed.fileUuid, 'Ruby 学习路线')
    expect(renameItem).not.toHaveBeenCalled()

    const reopened = mindmapRegistry.getOrCreate(closed.filePath)
    reopened.load(closed.filePath, createEmptyFile('先起个占位标题'), '/workspace')
    reopened.store.setState({ fileUuid: closed.fileUuid })
    backfillEntryFileTitle(closed.fileUuid, 'Ruby 学习路线')

    expect(renameItem).toHaveBeenCalledTimes(1)
  })

  it('never renames a file the entry turn did not create', async () => {
    const { renameItem } = installBridge()
    const instance = mindmapRegistry.getOrCreate('/workspace/用户自己的文件.mindlane')
    instance.load(
      '/workspace/用户自己的文件.mindlane',
      {
        ...instance.store.getState().toMindLaneFile(),
        metadata: {
          ...instance.store.getState().toMindLaneFile().metadata,
          fileUuid: 'user-file-uuid',
          title: '用户自己的文件',
        },
      },
      '/workspace',
    )
    mindmapRegistry.setActive('/workspace/用户自己的文件.mindlane')

    backfillEntryFileTitle('user-file-uuid', 'AI 起的名字')

    expect(renameItem).not.toHaveBeenCalled()
    expect(mindmapRegistry.getByFileUuid('user-file-uuid')!.store.getState().fileTitle).toBe(
      '用户自己的文件',
    )
  })
})
