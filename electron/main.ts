import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { DashScopeProvider, type LLMProvider, urlToDataUrl } from './agent/providers/index.js'
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
import nodeCrypto from 'node:crypto'
import type { AppSettings } from './fs/types.js'
import type { MindLaneFile } from '../src/shared/lib/fileFormat.js'

import { AiService } from './agent/service.js'
import { AgentOrchestrator, type ChatRequest } from './agent/orchestrator.js'
import type { SelectedNodeContent } from './agent/state.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null
let forceClose = false

let fsService: FileSystemService
let aiService: AiService

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

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function registerIpcHandlers() {
  const createProviderForRequest = async (apiKey: string, model: string) => {
    const settings = await fsService.settings.load()
    const dsConfig = settings.providerConfigs['dashscope']
    return new DashScopeProvider({
      apiKey: apiKey.trim() || settings.apiKey || dsConfig?.apiKey || '',
      chatModel: model.trim() || settings.chatModel || 'qwen-turbo',
      baseUrl: dsConfig?.baseUrl,
    })
  }

  // -- AI chat (ReAct Agent) --
  ipcMain.handle(
    'ai:chat',
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
        }
      },
    ) => {
      try {
        const settings = await fsService.settings.load()
        const apiKey = settings.apiKey || settings.providerConfigs['dashscope']?.apiKey || ''
        const modelName = settings.chatModel || 'qwen-turbo'

        if (!apiKey.trim()) return { ok: false, error: '未填写 API Key' }

        const provider = new DashScopeProvider({
          apiKey,
          chatModel: modelName,
          baseUrl: settings.providerConfigs['dashscope']?.baseUrl,
        })

        const userDataPath = app.getPath('userData')

        if (!payload.message?.trim()) {
          return { ok: false, error: '消息不能为空' }
        }

        const request: ChatRequest = {
          threadId: payload.threadId || crypto.randomUUID(),
          message: payload.message,
          context: payload.context
            ? {
                ...payload.context,
                selectedNodes: payload.context.selectedNodes?.map((n) => ({
                  ...n,
                  type: n.type as 'topic' | 'palace' | 'document',
                })),
              }
            : undefined,
        }

        const orchestrator = new AgentOrchestrator(provider, aiService, userDataPath)
        const result = await orchestrator.run(request)

        return { ok: true, ...result }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

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
        }
      },
    ) => {
      streamAbortController?.abort()
      const abortController = new AbortController()
      streamAbortController = abortController

      try {
        const settings = await fsService.settings.load()
        const apiKey = settings.apiKey || settings.providerConfigs['dashscope']?.apiKey || ''
        const modelName = settings.chatModel || 'qwen-turbo'

        if (!apiKey.trim()) {
          win?.webContents.send('ai:chat-stream-error', '未填写 API Key')
          return
        }

        const provider = new DashScopeProvider({
          apiKey,
          chatModel: modelName,
          baseUrl: settings.providerConfigs['dashscope']?.baseUrl,
        })

        const userDataPath = app.getPath('userData')

        if (!payload.message?.trim()) {
          win?.webContents.send('ai:chat-stream-error', '消息不能为空')
          return
        }

        const request: ChatRequest = {
          threadId: payload.threadId || crypto.randomUUID(),
          message: payload.message,
          context: payload.context
            ? {
                ...payload.context,
                selectedNodes: payload.context.selectedNodes?.map((n) => ({
                  ...n,
                  type: n.type as 'topic' | 'palace' | 'document',
                })),
              }
            : undefined,
        }

        const orchestrator = new AgentOrchestrator(provider, aiService, userDataPath)
        await orchestrator.stream(
          request,
          {
            onToken: (token) => {
              if (!abortController.signal.aborted) {
                win?.webContents.send('ai:chat-stream-token', token)
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

  // -- Doc to MindMap pipeline (multi-agent: mindmapGen) --
  ipcMain.handle(
    'ai:doc-to-mindmap',
    async (
      _e,
      payload: { apiKey: string; model: string; documentText: string; documentFilename: string },
    ) => {
      try {
        const provider = await createProviderForRequest(payload.apiKey, payload.model)
        const userDataPath = app.getPath('userData')
        const orchestrator = new AgentOrchestrator(provider, aiService, userDataPath)
        const result = await orchestrator.runMindmapFromDoc(
          payload.documentText,
          payload.documentFilename,
        )
        return {
          ok: true,
          nodes: result.nodes,
          edges: result.edges,
          documentTitle: result.documentTitle,
        }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
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

  // -- Nodes to Palace pipeline (multi-agent: Analyze → imageGen → Vision) --
  ipcMain.handle(
    'ai:nodes-to-palace',
    async (
      _e,
      payload: { apiKey: string; model: string; selectedNodes: SelectedNodeContent[] },
    ) => {
      const provider = await createProviderForRequest(payload.apiKey, payload.model)
      const userDataPath = app.getPath('userData')
      const orchestrator = new AgentOrchestrator(provider, aiService, userDataPath)
      return orchestrator.runPalaceFromNodes(payload.selectedNodes)
    },
  )

  // -- Provider management --
  ipcMain.handle('ai:list-providers', async () => {
    return {
      chat: [
        {
          id: 'dashscope',
          displayName: '通义千问 (百炼)',
          models: DashScopeProvider.defaultChatModels.map((model) => ({ ...model })),
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

  // -- Chat History (Multi-session support) --
  const chatHistoryDir = path.join(app.getPath('userData'), 'chat-history')
  fs.mkdirSync(chatHistoryDir, { recursive: true })

  function workspaceChatDir(workspacePath: string): string {
    const wsId = nodeCrypto.createHash('md5').update(workspacePath).digest('hex').slice(0, 12)
    const dir = path.join(chatHistoryDir, wsId)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  function sessionFilePath(workspacePath: string, sessionId: string): string {
    return path.join(workspaceChatDir(workspacePath), `${sessionId}.json`)
  }

  function sessionsMetaPath(workspacePath: string): string {
    return path.join(workspaceChatDir(workspacePath), 'sessions.json')
  }

  interface ChatSessionMeta {
    id: string
    title: string
    createdAt: string
    updatedAt: string
    messageCount: number
  }

  function loadSessionsMeta(workspacePath: string): ChatSessionMeta[] {
    try {
      const metaPath = sessionsMetaPath(workspacePath)
      if (fs.existsSync(metaPath)) {
        const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        return Array.isArray(data.sessions) ? data.sessions : []
      }
    } catch { /* ignore */ }
    return []
  }

  function saveSessionsMeta(workspacePath: string, sessions: ChatSessionMeta[]) {
    try {
      const metaPath = sessionsMetaPath(workspacePath)
      fs.writeFileSync(metaPath, JSON.stringify({ sessions }, null, 2), 'utf-8')
    } catch (err) {
      console.error('Failed to save sessions meta:', err)
    }
  }

  function generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }

  function generateSessionTitle(messages: Array<{ role: string; content: string }>): string {
    const firstUserMessage = messages.find(m => m.role === 'user')
    if (firstUserMessage) {
      const title = firstUserMessage.content.slice(0, 30)
      return title.length < firstUserMessage.content.length ? title + '...' : title
    }
    return `新对话 ${new Date().toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
  }

  // List all sessions for a workspace
  ipcMain.handle('chat:list-sessions', async (_e, payload: { workspacePath: string }) => {
    try {
      const sessions = loadSessionsMeta(payload.workspacePath)
      return { ok: true, data: { sessions } }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Load a specific session
  ipcMain.handle('chat:load-session', async (_e, payload: { workspacePath: string; sessionId: string }) => {
    try {
      const filePath = sessionFilePath(payload.workspacePath, payload.sessionId)
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        return {
          ok: true,
          data: {
            sessionId: payload.sessionId,
            messages: Array.isArray(data.messages) ? data.messages : [],
          },
        }
      }
    } catch { /* corrupted file, return empty */ }
    return {
      ok: true,
      data: {
        sessionId: payload.sessionId,
        messages: [],
      },
    }
  })

  // Save a session
  ipcMain.handle(
    'chat:save-session',
    async (
      _e,
      payload: {
        workspacePath: string
        sessionId: string
        messages: Array<{
          role: string
          content: string
          toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: string }>
        }>
      },
    ) => {
      try {
        const sessions = loadSessionsMeta(payload.workspacePath)
        const existingIndex = sessions.findIndex(s => s.id === payload.sessionId)
        const now = new Date().toISOString()

        const title = existingIndex >= 0 && sessions[existingIndex].title
          ? sessions[existingIndex].title
          : generateSessionTitle(payload.messages)

        const sessionMeta: ChatSessionMeta = {
          id: payload.sessionId,
          title,
          createdAt: existingIndex >= 0 ? sessions[existingIndex].createdAt : now,
          updatedAt: now,
          messageCount: payload.messages.length,
        }

        if (existingIndex >= 0) {
          sessions[existingIndex] = sessionMeta
        } else {
          sessions.unshift(sessionMeta)
        }

        // Sort by updatedAt desc
        sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        saveSessionsMeta(payload.workspacePath, sessions)

        const filePath = sessionFilePath(payload.workspacePath, payload.sessionId)
        fs.writeFileSync(
          filePath,
          JSON.stringify({ messages: payload.messages, updatedAt: now }, null, 2),
          'utf-8',
        )
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // Delete a session
  ipcMain.handle('chat:delete-session', async (_e, payload: { workspacePath: string; sessionId: string }) => {
    try {
      const sessions = loadSessionsMeta(payload.workspacePath)
      const filtered = sessions.filter(s => s.id !== payload.sessionId)
      saveSessionsMeta(payload.workspacePath, filtered)

      const filePath = sessionFilePath(payload.workspacePath, payload.sessionId)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Legacy: Load history (for backward compatibility, loads the most recent session)
  ipcMain.handle('chat:load-history', async (_e, payload: { workspacePath: string }) => {
    try {
      const sessions = loadSessionsMeta(payload.workspacePath)
      if (sessions.length > 0) {
        const mostRecent = sessions[0]
        const filePath = sessionFilePath(payload.workspacePath, mostRecent.id)
        if (fs.existsSync(filePath)) {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
          return {
            ok: true,
            data: {
              threadId: mostRecent.id,
              messages: Array.isArray(data.messages) ? data.messages : [],
            },
          }
        }
      }
    } catch { /* corrupted file, return empty */ }
    return {
      ok: true,
      data: {
        threadId: generateSessionId(),
        messages: [],
      },
    }
  })

  // Legacy: Save history (for backward compatibility)
  ipcMain.handle(
    'chat:save-history',
    async (
      _e,
      payload: {
        workspacePath: string
        messages: Array<{
          role: string
          content: string
          toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: string }>
        }>
      },
    ) => {
      try {
        const sessions = loadSessionsMeta(payload.workspacePath)
        const sessionId = sessions.length > 0 ? sessions[0].id : generateSessionId()

        const now = new Date().toISOString()
        const title = sessions.length > 0 && sessions[0].title
          ? sessions[0].title
          : generateSessionTitle(payload.messages)

        const sessionMeta: ChatSessionMeta = {
          id: sessionId,
          title,
          createdAt: sessions.length > 0 ? sessions[0].createdAt : now,
          updatedAt: now,
          messageCount: payload.messages.length,
        }

        if (sessions.length > 0) {
          sessions[0] = sessionMeta
        } else {
          sessions.unshift(sessionMeta)
        }
        saveSessionsMeta(payload.workspacePath, sessions)

        const filePath = sessionFilePath(payload.workspacePath, sessionId)
        fs.writeFileSync(
          filePath,
          JSON.stringify({ messages: payload.messages, updatedAt: now }, null, 2),
          'utf-8',
        )
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // -- Knowledge Base --
  ipcMain.handle('kb:upload-documents', async () => {
    if (!win) return { ok: false, error: 'No window' }
    const settings = await fsService.settings.load()
    const result = await dialog.showOpenDialog(win, {
      title: '导入知识库文档',
      defaultPath: settings.lastWorkspacePath ?? undefined,
      filters: [
        { name: '支持的文档', extensions: ['md', 'txt', 'pdf', 'docx', 'mindlane', 'png', 'jpg', 'jpeg', 'webp'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile', 'multiSelections'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: '已取消' }
    }

    const indexed = []

    for (const filePath of result.filePaths) {
      try {
        const meta = await aiService.rag.index(filePath, (progress) => {
          win?.webContents.send('kb:index-progress', progress)
        })
        indexed.push(meta)
      } catch (err) {
        win?.webContents.send('kb:index-progress', {
          phase: 'error',
          filename: path.basename(filePath),
          progress: 0,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return { ok: true, data: { indexed } }
  })

  ipcMain.handle('kb:list-documents', async () => {
    return aiService.rag.list()
  })

  ipcMain.handle('kb:delete-document', async (_e, payload: { docId: string }) => {
    const success = await aiService.rag.remove(payload.docId)
    return success ? { ok: true } : { ok: false, error: '文档不存在' }
  })

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

  aiService = new AiService()
  try {
    const settings = await fsService.settings.load()
    const apiKey = settings.apiKey || settings.providerConfigs['dashscope']?.apiKey || ''
    let provider: LLMProvider | undefined
    if (apiKey) {
      provider = new DashScopeProvider({
        apiKey,
        chatModel: settings.chatModel || 'qwen-turbo',
        baseUrl: settings.providerConfigs['dashscope']?.baseUrl,
      })
    }
    await aiService.init(userDataPath, provider)
  } catch (err) {
    console.error('AI service init failed:', err)
  }

  registerIpcHandlers()
  setupApplicationMenu()
  createWindow()
})
