import { dialog, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { MindLaneFile } from '../../../src/shared/lib/fileFormat.js'
import { IPC } from '../../ipc.js'
import { detectDocumentType } from '../documentType.js'
import { getWorkspaceSessionForService } from '../workspaceSession.js'
import type { HandlerContext } from './context.js'
import type { WorkspaceState } from '../../fs/types.js'

async function fileSha256(filePath: string): Promise<string> {
  const buffer = await fs.promises.readFile(filePath)
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function pathExists(targetPath: string | null | undefined): boolean {
  if (!targetPath) return false
  try {
    fs.accessSync(targetPath)
    return true
  } catch {
    return false
  }
}

function directoryExists(targetPath: string | null | undefined): boolean {
  if (!pathExists(targetPath)) return false
  try {
    return fs.statSync(targetPath!).isDirectory()
  } catch {
    return false
  }
}

async function syncWorkspaceFromFile(
  ctx: HandlerContext,
  filePath: string,
  data?: MindLaneFile,
): Promise<void> {
  const settings = await ctx.fsService.appState.load()

  const currentWorkspace = settings.lastWorkspacePath
    ? path.resolve(settings.lastWorkspacePath)
    : null
  const fileIsInCurrentWorkspace =
    currentWorkspace && ctx.fsService.workspaceTree.isWithinWorkspace(filePath, currentWorkspace)

  const workspacePath = fileIsInCurrentWorkspace ? currentWorkspace : path.dirname(filePath)

  await ctx.fsService.appState.switchWorkspace(workspacePath).catch(() => {})
  const title = data?.metadata.title || path.basename(filePath, path.extname(filePath))
  const recentFilesMax = await ctx.fsService.appState.getRecentFilesMax()
  await ctx.fsService.workspace
    .openFile(workspacePath, filePath, title, recentFilesMax)
    .catch(() => {})
}

export function registerFsHandlers(ctx: HandlerContext): void {
  // -- File operations --
  ipcMain.handle(IPC.FileOpen, async () => {
    if (!ctx.getWindow()) return { ok: false, error: 'No window' }
    const settings = await ctx.fsService.appState.load()
    const result = await ctx.fsService.project.open(ctx.getWindow()!, {
      defaultPath: settings.lastWorkspacePath ?? undefined,
    })
    if (result.ok) {
      await syncWorkspaceFromFile(ctx, result.data.filePath, result.data.data)
    }
    return result
  })

  ipcMain.handle(IPC.FileSave, async (_e, payload: { filePath: string | null; data: unknown }) => {
    if (!ctx.getWindow()) return { ok: false, error: 'No window' }
    const data = payload.data as MindLaneFile
    const result = await ctx.fsService.project.save(payload.filePath, data, ctx.getWindow()!)
    if (result.ok) {
      await syncWorkspaceFromFile(ctx, result.data.filePath, result.data.data)
    }
    return result
  })

  ipcMain.handle(IPC.FileSaveAs, async (_e, payload: { data: unknown }) => {
    if (!ctx.getWindow()) return { ok: false, error: 'No window' }
    const settings = await ctx.fsService.appState.load()
    const data = payload.data as MindLaneFile
    const result = await ctx.fsService.project.saveAs(data, ctx.getWindow()!, {
      defaultDirectory: settings.lastWorkspacePath,
    })
    if (result.ok) {
      await syncWorkspaceFromFile(ctx, result.data.filePath, result.data.data)
    }
    return result
  })

  ipcMain.handle(IPC.FileRecentList, async () => {
    const settings = await ctx.fsService.appState.load()
    if (!settings.lastWorkspacePath || !directoryExists(settings.lastWorkspacePath)) return []
    await ctx.fsService.workspace.pruneRecentFiles(settings.lastWorkspacePath)
    const recentResult = await ctx.fsService.workspace.getRecentFiles(settings.lastWorkspacePath)
    return recentResult.ok ? recentResult.data : []
  })

  ipcMain.handle(
    IPC.FileSaveThumbnail,
    async (_e, payload: { filePath: string; imageData: string }) => {
      try {
        const url = await ctx.fsService.thumbnails.save(payload.filePath, payload.imageData)
        return { ok: true, data: { previewUrl: url } }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  ipcMain.handle(IPC.FileSelectDocument, async () => {
    const win = ctx.getWindow()
    if (!win) return { ok: false, error: 'No window' }

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'docx', 'pptx', 'xlsx', 'md', 'markdown'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: 'User cancelled' }
    }

    const filePath = result.filePaths[0]
    try {
      const type = detectDocumentType(filePath)
      const stats = await fs.promises.stat(filePath)
      const hash = await fileSha256(filePath)
      return {
        ok: true,
        data: {
          path: filePath,
          name: path.basename(filePath),
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          sha256: hash,
          type: type!,
        },
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to read file info',
      }
    }
  })

  // -- Workspace operations --
  ipcMain.handle(IPC.WorkspaceOpenDirectory, async () => {
    const win = ctx.getWindow()
    if (!win) return { ok: false, error: 'No window' }
    const settings = await ctx.fsService.appState.load()
    const result = await dialog.showOpenDialog(win, {
      title: '打开本地仓库',
      defaultPath: settings.lastWorkspacePath ?? undefined,
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: '已取消' }
    }
    const workspacePath = path.resolve(result.filePaths[0]!)
    const switchResult = await ctx.fsService.appState.switchWorkspace(workspacePath)
    if (!switchResult.ok) return switchResult
    await ctx.fsService.workspace.clearLastOpenedFile(workspacePath).catch(() => {})
    return { ok: true, data: { workspacePath } }
  })

  ipcMain.handle(IPC.WorkspaceCreateDirectory, async (_e, payload: { name: string }) => {
    const win = ctx.getWindow()
    if (!win) return { ok: false, error: 'No window' }
    const settings = await ctx.fsService.appState.load()
    const parentResult = await dialog.showOpenDialog(win, {
      title: '选择仓库父目录',
      defaultPath: settings.lastWorkspacePath ?? undefined,
      properties: ['openDirectory'],
    })
    if (parentResult.canceled || parentResult.filePaths.length === 0) {
      return { ok: false, error: '已取消' }
    }
    const createResult = await ctx.fsService.workspaceTree.createDirectory(
      parentResult.filePaths[0]!,
      payload.name,
    )
    if (!createResult.ok) return createResult
    const switchResult = await ctx.fsService.appState.switchWorkspace(createResult.data)
    if (!switchResult.ok) return switchResult
    await ctx.fsService.workspace.clearLastOpenedFile(createResult.data).catch(() => {})
    return { ok: true, data: { workspacePath: createResult.data } }
  })

  ipcMain.handle(
    IPC.WorkspaceCreateFile,
    async (_e, payload: { workspacePath: string; name: string; data: unknown }) => {
      const data = payload.data as MindLaneFile
      const result = await ctx.fsService.project.createInDirectory(
        payload.workspacePath,
        payload.name,
        data,
      )
      if (result.ok) {
        await syncWorkspaceFromFile(ctx, result.data.filePath, result.data.data)
        return {
          ok: true,
          data: {
            filePath: result.data.filePath,
            data: result.data.data,
          },
        }
      }
      return result
    },
  )

  ipcMain.handle(IPC.WorkspaceListFiles, async (_e, payload: { workspacePath: string }) => {
    return ctx.fsService.workspaceTree.listFiles(payload.workspacePath)
  })

  ipcMain.handle(IPC.WorkspaceOpenFilePath, async (_e, payload: { filePath: string }) => {
    const result = await ctx.fsService.project.loadFromPath(payload.filePath)
    if (result.ok) {
      await syncWorkspaceFromFile(ctx, result.data.filePath, result.data.data)
    }
    return result
  })

  ipcMain.handle(IPC.WorkspaceGetSession, async () => {
    return getWorkspaceSessionForService(ctx.fsService)
  })

  ipcMain.handle(
    IPC.WorkspaceUpdateState,
    async (
      _e,
      payload: {
        workspacePath: string
        activeSession?: { fileUuid: string; sessionId: string }
      } & Partial<WorkspaceState>,
    ) => {
      const activeSession = payload.activeSession
      if (activeSession !== undefined) {
        const result = await ctx.fsService.workspace.setActiveSessionId(
          payload.workspacePath,
          activeSession.fileUuid,
          activeSession.sessionId,
        )
        if (!result.ok) return result
      }
      if (payload.activeSessionIds !== undefined) {
        const result = await ctx.fsService.workspace.updateActiveSessionIds(
          payload.workspacePath,
          payload.activeSessionIds,
        )
        if (!result.ok) return result
      }
      if (payload.lastOpenedFilePath !== undefined) {
        const result =
          payload.lastOpenedFilePath === null
            ? await ctx.fsService.workspace.clearLastOpenedFile(payload.workspacePath)
            : { ok: false, error: '不支持直接设置 lastOpenedFilePath' }
        if (!result.ok) return result
      }
      return { ok: true }
    },
  )

  ipcMain.handle(IPC.WorkspaceSwitch, async (_e, payload: { workspacePath: string }) => {
    const workspacePath = path.resolve(payload.workspacePath)
    const switchResult = await ctx.fsService.appState.switchWorkspace(workspacePath)
    if (!switchResult.ok) return switchResult
    await ctx.fsService.workspace.clearLastOpenedFile(workspacePath).catch(() => {})
    return { ok: true, data: { workspacePath } }
  })

  ipcMain.handle(IPC.WorkspaceListTree, async (_e, payload: { workspacePath: string }) => {
    return ctx.fsService.workspaceTree.listTree(payload.workspacePath)
  })

  ipcMain.handle(
    IPC.WorkspaceCreateSubfolder,
    async (_e, payload: { parentPath: string; name: string; workspacePath: string }) => {
      const result = await ctx.fsService.workspaceTree.createSubdirectory(
        payload.parentPath,
        payload.name,
        payload.workspacePath,
      )
      if (!result.ok) return result
      return { ok: true, data: { path: result.data } }
    },
  )

  ipcMain.handle(
    IPC.WorkspaceDeleteItem,
    async (_e, payload: { targetPath: string; workspacePath: string }) => {
      const result = await ctx.fsService.workspaceTree.deleteItem(
        payload.targetPath,
        payload.workspacePath,
      )
      if (!result.ok) return result
      // 清理缩略图
      await ctx.fsService.thumbnails.delete(payload.targetPath).catch(() => {})
      return { ok: true }
    },
  )

  ipcMain.handle(
    IPC.WorkspaceRenameItem,
    async (_e, payload: { oldPath: string; newName: string; workspacePath: string }) => {
      const result = await ctx.fsService.workspaceTree.rename(
        payload.oldPath,
        payload.newName,
        payload.workspacePath,
      )
      if (!result.ok) return result
      return { ok: true, data: { newPath: result.data } }
    },
  )

  ipcMain.handle(
    IPC.WorkspaceMoveItem,
    async (_e, payload: { sourcePath: string; targetDirPath: string; workspacePath: string }) => {
      const result = await ctx.fsService.workspaceTree.move(
        payload.sourcePath,
        payload.targetDirPath,
        payload.workspacePath,
      )
      if (!result.ok) return result
      return { ok: true, data: { newPath: result.data } }
    },
  )
}
