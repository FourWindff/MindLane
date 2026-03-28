import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { DEFAULT_CHAT_MODELS, createDashScopeRuntime, urlToDataUrl } from './ai/runtime.js'
import { FileSystemService } from './fs/index.js'
import { runNodesToPalace, type SelectedNodeContent } from './workflows/nodesToPalace.js'
import { runDocToMindmap } from './workflows/docToMindmap.js'
import { runTextToPalace } from './workflows/textToPalace.js'
import {
  loadWindowBounds,
  resolveWindowBounds,
  saveWindowBounds,
  MIN_WIDTH,
  MIN_HEIGHT,
} from './windowState.js'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings } from './fs/types.js'
import type { MindLaneFile } from '../src/shared/lib/fileFormat.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null

let fsService: FileSystemService

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

function dedupeWorkspacePaths(paths: string[], maxEntries: number): string[] {
  const unique = new Set<string>()
  const result: string[] = []
  for (const targetPath of paths) {
    const resolvedPath = path.resolve(targetPath)
    if (unique.has(resolvedPath) || !directoryExists(resolvedPath)) continue
    unique.add(resolvedPath)
    result.push(resolvedPath)
    if (result.length >= maxEntries) break
  }
  return result
}

async function syncWorkspaceFromFile(filePath: string, data?: MindLaneFile): Promise<void> {
  const settings = await fsService.settings.load()

  const currentWorkspace = settings.lastWorkspacePath ? path.resolve(settings.lastWorkspacePath) : null
  const fileIsInCurrentWorkspace =
    currentWorkspace && fsService.workspace.isWithinWorkspace(filePath, currentWorkspace)

  const workspacePath = fileIsInCurrentWorkspace ? currentWorkspace : path.dirname(filePath)

  const recentWorkspacePaths = dedupeWorkspacePaths(
    [workspacePath, ...settings.recentWorkspacePaths],
    settings.recentFilesMax,
  )
  await fsService.settings.update({
    lastWorkspacePath: workspacePath,
    lastOpenedFilePath: filePath,
    recentWorkspacePaths,
  })
  await fsService.recentFiles
    .touch({
      filePath,
      title: data?.metadata.title || path.basename(filePath, path.extname(filePath)),
    })
    .catch(() => {})
}

async function rememberWorkspace(
  workspacePath: string,
  options?: { clearLastOpenedFile?: boolean },
): Promise<void> {
  const settings = await fsService.settings.load()
  const recentWorkspacePaths = dedupeWorkspacePaths(
    [workspacePath, ...settings.recentWorkspacePaths],
    settings.recentFilesMax,
  )
  const nextLastOpenedFilePath = options?.clearLastOpenedFile
    ? null
    : settings.lastOpenedFilePath &&
        fsService.workspace.isWithinWorkspace(settings.lastOpenedFilePath, workspacePath)
      ? settings.lastOpenedFilePath
      : null

  await fsService.settings.update({
    lastWorkspacePath: workspacePath,
    recentWorkspacePaths,
    lastOpenedFilePath: nextLastOpenedFilePath,
  })
}

async function getWorkspaceSession() {
  const settings = await fsService.settings.load()
  const recentWorkspacePaths = dedupeWorkspacePaths(
    settings.recentWorkspacePaths,
    settings.recentFilesMax,
  )
  const persistedWorkspacePath =
    settings.lastWorkspacePath && directoryExists(settings.lastWorkspacePath)
      ? path.resolve(settings.lastWorkspacePath)
      : null
  const persistedLastOpenedFilePath =
    persistedWorkspacePath &&
    settings.lastOpenedFilePath &&
    pathExists(settings.lastOpenedFilePath) &&
    fsService.workspace.isSupportedFile(settings.lastOpenedFilePath) &&
    fsService.workspace.isWithinWorkspace(settings.lastOpenedFilePath, persistedWorkspacePath)
      ? path.resolve(settings.lastOpenedFilePath)
      : null

  const shouldPersistCleanup =
    JSON.stringify(recentWorkspacePaths) !== JSON.stringify(settings.recentWorkspacePaths) ||
    settings.lastWorkspacePath !== persistedWorkspacePath ||
    settings.lastOpenedFilePath !== persistedLastOpenedFilePath

  if (shouldPersistCleanup) {
    await fsService.settings.update({
      lastWorkspacePath: persistedWorkspacePath,
      recentWorkspacePaths,
      lastOpenedFilePath: persistedLastOpenedFilePath,
    })
  }

  return {
    workspacePath: settings.restoreLastWorkspaceOnLaunch ? persistedWorkspacePath : null,
    recentWorkspacePaths,
    lastOpenedFilePath: settings.restoreLastWorkspaceOnLaunch ? persistedLastOpenedFilePath : null,
    restoreLastWorkspaceOnLaunch: settings.restoreLastWorkspaceOnLaunch,
  }
}

function setupApplicationMenu() {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ label: app.name, submenu: [{ role: 'quit' }] }]),
    )
  } else {
    Menu.setApplicationMenu(null)
  }
}

function createWindow() {
  const bounds = resolveWindowBounds(loadWindowBounds())
  win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    icon: path.join(process.env.VITE_PUBLIC, 'assets', 'mindlane-logo.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  const browserWindow = win
  browserWindow.on('close', () => {
    if (!browserWindow.isDestroyed()) {
      saveWindowBounds(browserWindow.getBounds())
    }
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function registerIpcHandlers() {
  const createRuntimeForRequest = async (apiKey: string, model: string) => {
    const settings = await fsService.settings.load()
    const dsConfig = settings.providerConfigs['dashscope']
    return createDashScopeRuntime({
      apiKey: apiKey.trim() || settings.apiKey || dsConfig?.apiKey || '',
      chatModel: model.trim() || settings.chatModel || 'qwen-turbo',
      baseUrl: dsConfig?.baseUrl,
    })
  }

  // -- AI chat --
  ipcMain.handle(
    'ai:chat',
    async (
      _e,
      payload: { apiKey: string; model: string; messages: { role: string; content: string }[] },
    ) => {
      const messages = (payload.messages ?? []).map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: String(m.content ?? ''),
      }))
      const runtime = await createRuntimeForRequest(payload.apiKey, payload.model)
      return runTextToPalace({
        apiKey: payload.apiKey,
        model: payload.model,
        messages,
        runtime,
      })
    },
  )

  // -- Direct text2image via runtime --
  ipcMain.handle(
    'ai:text2image',
    async (_e, payload: { apiKey: string; prompt: string; size?: string; n?: number }) => {
      try {
        const runtime = await createRuntimeForRequest(payload.apiKey, '')
        const result = await runtime.generateImage(payload)
        return { ok: true, urls: result.urls }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  // -- Image URL to base64 data URL --
  ipcMain.handle('image:url-to-data-url', async (_e, payload: { url: string }) => {
    try {
      const dataUrl = await urlToDataUrl(payload.url)
      return { ok: true, data: { dataUrl } }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // -- Doc to MindMap pipeline --
  ipcMain.handle(
    'ai:doc-to-mindmap',
    async (
      _e,
      payload: { apiKey: string; model: string; documentText: string; documentFilename: string },
    ) => {
      return runDocToMindmap(payload)
    },
  )

  // -- Document import --
  ipcMain.handle('file:import-document', async () => {
    if (!win) return { ok: false, error: 'No window' }
    const settings = await fsService.settings.load()
    const result = await dialog.showOpenDialog(win, {
      title: '导入文档',
      defaultPath: settings.lastWorkspacePath ?? undefined,
      filters: [
        { name: '文本文档', extensions: ['txt', 'md', 'text'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: '已取消' }
    }
    const filePath = result.filePaths[0]!
    try {
      const fs = await import('node:fs')
      const pathMod = await import('node:path')
      const content = await fs.promises.readFile(filePath, 'utf-8')
      const filename = pathMod.default.basename(filePath)
      const docId = crypto.randomUUID()
      await fsService.cache.cacheDocumentText(docId, content)
      return {
        ok: true,
        data: { docId, filename, content, filePath },
      }
    } catch (e) {
      return { ok: false, error: `读取失败：${e instanceof Error ? e.message : String(e)}` }
    }
  })

  // -- Nodes to Palace pipeline --
  ipcMain.handle(
    'ai:nodes-to-palace',
    async (
      _e,
      payload: { apiKey: string; model: string; selectedNodes: SelectedNodeContent[] },
    ) => {
      const runtime = await createRuntimeForRequest(payload.apiKey, payload.model)
      return runNodesToPalace({
        apiKey: payload.apiKey,
        model: payload.model,
        selectedNodes: payload.selectedNodes,
        runtime,
      })
    },
  )

  // -- Provider management --
  ipcMain.handle('ai:list-providers', async () => {
    return {
      chat: [
        {
          id: 'dashscope',
          displayName: '通义千问 (百炼)',
          models: DEFAULT_CHAT_MODELS.map((model) => ({ ...model })),
        },
      ],
      image: [{ id: 'dashscope', displayName: '通义万相 (百炼)' }],
    }
  })

  // -- File operations --
  ipcMain.handle('file:open', async () => {
    if (!win) return { ok: false, error: 'No window' }
    const settings = await fsService.settings.load()
    const result = await fsService.project.open(win, {
      defaultPath: settings.lastWorkspacePath ?? undefined,
    })
    if (result.ok) {
      await syncWorkspaceFromFile(result.data.filePath, result.data.data)
    }
    return result
  })

  ipcMain.handle('file:save', async (_e, payload: { filePath: string | null; data: unknown }) => {
    if (!win) return { ok: false, error: 'No window' }
    const data = payload.data as MindLaneFile
    const result = await fsService.project.save(payload.filePath, data, win)
    if (result.ok) {
      await syncWorkspaceFromFile(result.data.filePath, data)
    }
    return result
  })

  ipcMain.handle('file:save-as', async (_e, payload: { data: unknown }) => {
    if (!win) return { ok: false, error: 'No window' }
    const settings = await fsService.settings.load()
    const data = payload.data as MindLaneFile
    const result = await fsService.project.saveAs(data, win, {
      defaultDirectory: settings.lastWorkspacePath,
    })
    if (result.ok) {
      await syncWorkspaceFromFile(result.data.filePath, data)
    }
    return result
  })

  ipcMain.handle('file:recent-list', async () => {
    return fsService.recentFiles.list()
  })

  // -- Workspace operations --
  ipcMain.handle('workspace:open-directory', async () => {
    if (!win) return { ok: false, error: 'No window' }
    const settings = await fsService.settings.load()
    const result = await dialog.showOpenDialog(win, {
      title: '打开本地仓库',
      defaultPath: settings.lastWorkspacePath ?? undefined,
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: '已取消' }
    }
    const workspacePath = path.resolve(result.filePaths[0]!)
    await rememberWorkspace(workspacePath, { clearLastOpenedFile: true })
    const files = await fsService.workspace.listFiles(workspacePath)
    return { ok: true, data: { workspacePath, files } }
  })

  ipcMain.handle('workspace:create-directory', async (_e, payload: { name: string }) => {
    if (!win) return { ok: false, error: 'No window' }
    const settings = await fsService.settings.load()
    const parentResult = await dialog.showOpenDialog(win, {
      title: '选择仓库父目录',
      defaultPath: settings.lastWorkspacePath ?? undefined,
      properties: ['openDirectory'],
    })
    if (parentResult.canceled || parentResult.filePaths.length === 0) {
      return { ok: false, error: '已取消' }
    }
    try {
      const workspacePath = await fsService.workspace.createDirectory(
        parentResult.filePaths[0]!,
        payload.name,
      )
      await rememberWorkspace(workspacePath, { clearLastOpenedFile: true })
      return { ok: true, data: { workspacePath, files: [] } }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(
    'workspace:create-file',
    async (_e, payload: { workspacePath: string; name: string; data: unknown }) => {
      const data = payload.data as MindLaneFile
      const result = await fsService.project.createInDirectory(payload.workspacePath, payload.name, data)
      if (result.ok) {
        await syncWorkspaceFromFile(result.data.filePath, data)
        return {
          ok: true,
          data: {
            filePath: result.data.filePath,
            data,
          },
        }
      }
      return result
    },
  )

  ipcMain.handle('workspace:list-files', async (_e, payload: { workspacePath: string }) => {
    try {
      return {
        ok: true,
        data: await fsService.workspace.listFiles(payload.workspacePath),
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('workspace:open-file-path', async (_e, payload: { filePath: string }) => {
    const result = await fsService.project.loadFromPath(payload.filePath)
    if (result.ok) {
      await syncWorkspaceFromFile(result.data.filePath, result.data.data)
    }
    return result
  })

  ipcMain.handle('workspace:get-session', async () => {
    return getWorkspaceSession()
  })

  ipcMain.handle('workspace:switch', async (_e, payload: { workspacePath: string }) => {
    try {
      const workspacePath = path.resolve(payload.workspacePath)
      const files = await fsService.workspace.listFiles(workspacePath)
      await rememberWorkspace(workspacePath, { clearLastOpenedFile: true })
      return { ok: true, data: { workspacePath, files } }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('workspace:list-tree', async (_e, payload: { workspacePath: string }) => {
    try {
      return {
        ok: true,
        data: await fsService.workspace.listTree(payload.workspacePath),
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(
    'workspace:create-subfolder',
    async (_e, payload: { parentPath: string; name: string; workspacePath: string }) => {
      try {
        const createdPath = await fsService.workspace.createSubdirectory(
          payload.parentPath,
          payload.name,
          payload.workspacePath,
        )
        return { ok: true, data: { path: createdPath } }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  ipcMain.handle(
    'workspace:delete-item',
    async (_e, payload: { targetPath: string; workspacePath: string }) => {
      try {
        await fsService.workspace.deleteItem(payload.targetPath, payload.workspacePath)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  ipcMain.handle(
    'workspace:rename-item',
    async (_e, payload: { oldPath: string; newName: string; workspacePath: string }) => {
      try {
        const newPath = await fsService.workspace.rename(
          payload.oldPath,
          payload.newName,
          payload.workspacePath,
        )
        return { ok: true, data: { newPath } }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  ipcMain.handle(
    'workspace:move-item',
    async (_e, payload: { sourcePath: string; targetDirPath: string; workspacePath: string }) => {
      try {
        const newPath = await fsService.workspace.move(
          payload.sourcePath,
          payload.targetDirPath,
          payload.workspacePath,
        )
        return { ok: true, data: { newPath } }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  // -- Settings --
  ipcMain.handle('file:settings-load', async () => {
    return fsService.settings.load()
  })

  ipcMain.handle('file:settings-update', async (_e, partial: Record<string, unknown>) => {
    await fsService.settings.update(partial as Partial<AppSettings>)
  })

  ipcMain.handle('window:minimize', () => {
    win?.minimize()
  })

  ipcMain.handle('window:close', () => {
    win?.close()
  })

}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(async () => {
  fsService = new FileSystemService(app.getPath('userData'))
  await fsService.initialize()

  registerIpcHandlers()
  setupApplicationMenu()
  createWindow()
})
