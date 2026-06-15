import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { urlToDataUrl, createProvider, getProviderMeta, getRegisteredProviders } from './agent/providers/index.js'
import { FileSystemService } from './fs/index.js'
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
import crypto from 'node:crypto'
import type { AppSettings } from './fs/types.js'
import type { ChatMessage, DocumentRef, MindLaneFile } from '../src/shared/lib/fileFormat.js'

import { AiService } from './agent/service.js'
import { AgentOrchestrator, type ChatRequest } from './agent/orchestrator.js'
import type { SelectedNodeContent } from './agent/state.js'
import { mergeMessagePipelineConfig } from './agent/context/pipeline.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

// Enable remote debugging for MCP Electron tools (port 9222)
app.commandLine.appendSwitch('remote-debugging-port', '9222')

let win: BrowserWindow | null
let forceClose = false

let fsService: FileSystemService
let aiService: AiService
let aiServiceReady = false

function aiNotReadyResponse(): { ok: false; error: string } {
  return { ok: false, error: 'AI service not initialized' }
}

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
  browserWindow.on('close', (event) => {
    if (!browserWindow.isDestroyed()) {
      saveWindowBounds(browserWindow.getBounds())
    }
    if (!forceClose) {
      event.preventDefault()
      browserWindow.webContents.send('app:before-close')
    }
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F12') {
      win?.webContents.toggleDevTools()
      event.preventDefault()
      return
    }
    const ctrlOrCmd = process.platform === 'darwin' ? input.meta : input.control
    if (ctrlOrCmd && input.shift && (input.key === 'I' || input.key === 'i')) {
      win?.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function registerIpcHandlers(userDataPath: string) {
  const createProviderForRequest = async (apiKey: string, model: string) => {
    const settings = await fsService.settings.load()
    const providerId = settings.activeProviders.chat || 'dashscope'
    const providerConfig = settings.providerConfigs[providerId]
    const providerMeta = getProviderMeta(providerId)
    const requestedModel = model.trim() || settings.chatModel || ''
    const normalizedModel =
      providerMeta?.defaultModels.some((item) => item.id === requestedModel)
        ? requestedModel
        : providerMeta?.defaultModels[0]?.id || requestedModel || 'qwen-turbo'
    return createProvider(providerId, {
      apiKey: apiKey.trim() || providerConfig?.apiKey || settings.apiKey || '',
      chatModel: normalizedModel,
      baseUrl: providerConfig?.baseUrl,
    })
  }

  const resolveMessagePipelineConfig = async () => {
    const settings = await fsService.settings.load()
    const providerId = settings.activeProviders.chat || 'dashscope'
    const providerOverride = settings.providerConfigs[providerId]?.messagePipeline
    return mergeMessagePipelineConfig({
      ...settings.messagePipeline,
      ...providerOverride,
    })
  }

  // -- AI chat stream (with abort support) --
  let streamAbortController: AbortController | null = null

  ipcMain.handle(
    'ai:chat-stream',
    async (
      _e,
      payload: {
        threadId: string
        message: string
        context?: {
          mindmapSummary?: string
          selectedNodes?: { id: string; type: string; label: string; extra?: Record<string, unknown> }[]
          filePath?: string
          fileTitle?: string
          hasDocumentOpen?: boolean
          workspacePath?: string
          workspaceFiles?: { name: string; filePath: string }[]
          attachedDocument?: DocumentRef
          linkedDocuments?: DocumentRef[]
        }
      },
    ) => {
      streamAbortController?.abort()
      const abortController = new AbortController()
      streamAbortController = abortController

      if (!aiServiceReady) {
        win?.webContents.send('ai:chat-stream-error', 'AI service not initialized')
        return
      }

      try {
        const settings = await fsService.settings.load()
        const providerId = settings.activeProviders.chat || 'dashscope'
        const providerConfig = settings.providerConfigs[providerId]
        const apiKey = providerConfig?.apiKey || settings.apiKey || ''
        const modelName = settings.chatModel || 'qwen-turbo'

        if (!apiKey.trim()) {
          win?.webContents.send('ai:chat-stream-error', '未填写 API Key')
          return
        }

        const provider = createProvider(providerId, {
          apiKey,
          chatModel: modelName,
          baseUrl: providerConfig?.baseUrl,
        })

        if (!payload.message?.trim()) {
          win?.webContents.send('ai:chat-stream-error', '消息不能为空')
          return
        }

        let fileTags: string[] | undefined
        if (payload.context?.filePath) {
          try {
            const raw = await fs.promises.readFile(payload.context.filePath, 'utf-8')
            const data = JSON.parse(raw) as MindLaneFile
            fileTags = data.metadata.tags
          } catch { /* ignore */ }
        }

        const request: ChatRequest = {
          threadId: payload.threadId || crypto.randomUUID(),
          message: payload.message,
          context: payload.context
            ? {
                ...payload.context,
                selectedNodes: payload.context.selectedNodes?.filter(
                  (n): n is { id: string; type: 'text' | 'palace'; label: string; extra?: Record<string, unknown> } =>
                    n.type === 'text' || n.type === 'palace',
                ),
                fileTags,
              }
            : undefined,
          documentRef: payload.context?.attachedDocument,
        }

        const orchestrator = new AgentOrchestrator(provider, aiService, {
          cacheManager: fsService.cache,
          userDataPath,
          messagePipeline: await resolveMessagePipelineConfig(),
        })
        await orchestrator.stream(
          request,
          {
            onToken: (token) => {
              if (!abortController.signal.aborted) {
                win?.webContents.send('ai:chat-stream-token', token)
              }
            },
            onMessageStart: () => {
              if (!abortController.signal.aborted) {
                win?.webContents.send('ai:chat-stream-message-start')
              }
            },
            onToolStart: (name, input) => {
              if (!abortController.signal.aborted) {
                win?.webContents.send('ai:chat-stream-tool-start', { name, input })
              }
            },
            onToolEnd: (name, output) => {
              if (!abortController.signal.aborted) {
                win?.webContents.send('ai:chat-stream-tool-end', { name, output })
              }
            },
            onEnd: (response) => {
              win?.webContents.send('ai:chat-stream-end', response)
            },
            onError: (error) => {
              if (!abortController.signal.aborted) {
                win?.webContents.send('ai:chat-stream-error', error)
              }
            },
          },
          abortController.signal,
        )
      } catch (error) {
        if (!abortController.signal.aborted) {
          win?.webContents.send(
            'ai:chat-stream-error',
            error instanceof Error ? error.message : String(error),
          )
        }
      } finally {
        if (streamAbortController === abortController) {
          streamAbortController = null
        }
      }
    },
  )

  ipcMain.handle('ai:chat-stream-stop', () => {
    streamAbortController?.abort()
    streamAbortController = null
  })

  // -- Direct text2image via runtime --
  ipcMain.handle(
    'ai:text2image',
    async (_e, payload: { apiKey: string; prompt: string; size?: string; n?: number }) => {
      try {
        const provider = await createProviderForRequest(payload.apiKey, '')
        const result = await provider.generateImage(payload)
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

  // -- Nodes to Palace pipeline (multi-agent: Analyze → imageGen → Vision) --
  ipcMain.handle(
    'ai:nodes-to-palace',
    async (
      _e,
      payload: { apiKey: string; model: string; selectedNodes: SelectedNodeContent[] },
    ) => {
      const provider = await createProviderForRequest(payload.apiKey, payload.model)
      const orchestrator = new AgentOrchestrator(provider, aiService, {
        cacheManager: fsService.cache,
        userDataPath,
        messagePipeline: await resolveMessagePipelineConfig(),
      })
      return orchestrator.runPalaceFromNodes(payload.selectedNodes)
    },
  )

  // -- Provider management --
  ipcMain.handle('ai:list-providers', async () => {
    return {
      chat: getRegisteredProviders().map((meta) => ({
        id: meta.id,
        displayName: meta.displayName,
        models: meta.defaultModels.map((m) => ({ ...m })),
        capabilities: meta.capabilities,
      })),
      image: getRegisteredProviders()
        .filter((meta) => meta.capabilities.includes('imageGen' as never))
        .map((meta) => ({ id: meta.id, displayName: meta.displayName })),
    }
  })

  ipcMain.handle('ai:get-providers', async () => {
    return {
      ok: true,
      providers: getRegisteredProviders().map((meta) => ({
        id: meta.id,
        displayName: meta.displayName,
        capabilities: meta.capabilities,
        models: meta.defaultModels,
      })),
    }
  })

  ipcMain.handle('ai:get-capabilities', async () => {
    try {
      const settings = await fsService.settings.load()
      const providerId = settings.activeProviders.chat || 'dashscope'
      const providerMeta = getProviderMeta(providerId)
      if (!providerMeta) {
        return { ok: false, error: `未知的 provider: ${providerId}` }
      }

      return {
        ok: true,
        capabilities: providerMeta.capabilities,
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
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

  ipcMain.handle('file:save-thumbnail', async (_e, payload: { filePath: string; imageData: string }) => {
    try {
      const url = await fsService.thumbnails.save(payload.filePath, payload.imageData)
      return { ok: true, data: { previewUrl: url } }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('file:select-document', async () => {
    if (!win) return { ok: false, error: 'No window' }

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'PDF Documents', extensions: ['pdf'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: 'User cancelled' }
    }

    const filePath = result.filePaths[0]
    try {
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
        },
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Failed to read file info' }
    }
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
        // 清理缩略图
        await fsService.thumbnails.delete(payload.targetPath)
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

  // -- Chat History (Multi-session support) --

  ipcMain.handle('chat:list-sessions', async (_e, payload: { workspacePath: string; limit?: number; offset?: number }) => {
    if (!aiServiceReady) return aiNotReadyResponse()
    try {
      aiService.sessionManager.setWorkspace(payload.workspacePath)
      const sessions = await aiService.sessionManager.listSessions(payload.limit, payload.offset)
      return { ok: true, data: { sessions } }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('chat:load-session', async (_e, payload: { workspacePath: string; sessionId: string }) => {
    if (!aiServiceReady) {
      return {
        ok: true,
        data: {
          sessionId: payload.sessionId,
          messages: [],
        },
      }
    }
    try {
      aiService.sessionManager.setWorkspace(payload.workspacePath)
      const messages = await aiService.sessionManager.loadHistory(payload.sessionId)
      return {
        ok: true,
        data: {
          sessionId: payload.sessionId,
          messages,
        },
      }
    } catch (err) {
      return {
        ok: true,
        data: {
          sessionId: payload.sessionId,
          messages: [],
        },
      }
    }
  })

  ipcMain.handle(
    'chat:save-session',
    async (
      _e,
      payload: {
        workspacePath: string
        sessionId: string
        messages: ChatMessage[]
      },
    ) => {
      if (!aiServiceReady) return aiNotReadyResponse()
      try {
        aiService.sessionManager.setWorkspace(payload.workspacePath)
        await aiService.sessionManager.saveSession(
          payload.sessionId,
          payload.messages,
        )
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle('chat:delete-session', async (_e, payload: { workspacePath: string; sessionId: string }) => {
    if (!aiServiceReady) return aiNotReadyResponse()
    try {
      aiService.sessionManager.setWorkspace(payload.workspacePath)
      await aiService.sessionManager.deleteSession(payload.sessionId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('chat:load-history', async (_e, payload: { workspacePath: string }) => {
    if (!aiServiceReady) {
      return {
        ok: true,
        data: {
          threadId: `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          messages: [],
        },
      }
    }
    try {
      aiService.sessionManager.setWorkspace(payload.workspacePath)
      const sessionId = await aiService.sessionManager.getMostRecentSessionId()
      if (sessionId) {
        const messages = await aiService.sessionManager.loadHistory(sessionId)
        return {
          ok: true,
          data: {
            threadId: sessionId,
            messages,
          },
        }
      }
    } catch { /* corrupted, return empty */ }
    return {
      ok: true,
      data: {
        threadId: `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        messages: [],
      },
    }
  })

  ipcMain.handle(
    'chat:save-history',
    async (
      _e,
      payload: {
        workspacePath: string
        messages: ChatMessage[]
      },
    ) => {
      if (!aiServiceReady) return aiNotReadyResponse()
      try {
        aiService.sessionManager.setWorkspace(payload.workspacePath)
        const sessionId = await aiService.sessionManager.getMostRecentSessionId()
          || `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
        await aiService.sessionManager.saveSession(
          sessionId,
          payload.messages,
        )
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
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

  ipcMain.handle('window:toggle-maximize', () => {
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.handle('window:close', () => {
    win?.close()
  })

  ipcMain.handle('window:close-confirmed', () => {
    forceClose = true
    win?.close()
  })

  ipcMain.handle('window:open-devtools', () => {
    win?.webContents.openDevTools()
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
  const userDataPath = app.getPath('userData')
  fsService = new FileSystemService(userDataPath)
  await fsService.initialize()
  fsService.workspace.setThumbnailManager(fsService.thumbnails)

  aiService = new AiService()
  try {
    const settings = await fsService.settings.load()
    const providerId = settings.activeProviders.chat || 'dashscope'
    const providerConfig = settings.providerConfigs[providerId]
    const apiKey = providerConfig?.apiKey || settings.apiKey || ''
    if (apiKey) {
      createProvider(providerId, {
        apiKey,
        chatModel: settings.chatModel || 'qwen-turbo',
        baseUrl: providerConfig?.baseUrl,
      })
    }
    await aiService.init(userDataPath)
    // TODO: 应用启动时清理 userData/tool-results/ 下过期的转存文件，
    // 避免工具结果文件无限累积占用磁盘。
    aiServiceReady = true
  } catch (err) {
    console.error('AI service init failed:', err)
  }

  registerIpcHandlers(userDataPath)
  setupApplicationMenu()
  createWindow()
})
