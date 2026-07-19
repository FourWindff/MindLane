import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from 'electron'
import {
  urlToDataUrl,
  createProvider,
  getProviderMeta,
  getRegisteredProviders,
} from './agent/providers/index.js'
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
import type { AppSettings, WorkspaceState } from './fs/types.js'
import { DEFAULT_SETTINGS } from './fs/types.js'
import { DEFAULT_WORKSPACE_STATE } from './fs/workspace.js'
import type { DocumentRef, MindLaneFile } from '../src/shared/lib/fileFormat.js'
import { IPC } from './ipc.js'
import { resolveDocumentRef } from '../src/shared/lib/documentRef.js'
import { detectDocumentType } from './main/documentType.js'

import { AiService } from './agent/service.js'
import { AgentOrchestrator } from './agent/orchestrator.js'
import type { SelectedNodeContent } from './agent/state.js'
import { mergeMessagePipelineConfig } from './agent/context/pipeline.js'
import { cleanupToolResultOffloads } from './agent/tools/toolResultNormalizer.js'
import { StreamManager, type StreamRequest, type StreamRuntime } from './agent/streamManager.js'
import type { ChatContext, ChatStreamEvent } from './preload.js'
import { McpManager } from './mcp/mcpManager.js'
import { createMcpClient } from './mcp/clientFactory.js'
import type { McpServerStatus } from './mcp/types.js'
import { logger, RotatingFileSink } from './shared/logger.js'

const appLog = logger.withContext('app')
const providerLog = logger.withContext('provider')
const mcpLog = logger.withContext('mcp')

let logFileSink: RotatingFileSink | null = null

/** Collect every configured API key from settings for literal redaction in the file sink. */
function collectApiKeys(settings: AppSettings): string[] {
  const keys = Object.values(settings.providerConfigs ?? {})
    .map((config) => config?.apiKey)
    .filter((key): key is string => typeof key === 'string' && key.trim().length > 0)
  if (settings.apiKey?.trim()) keys.push(settings.apiKey)
  return keys
}

function refreshLogSecrets(settings: AppSettings): void {
  logFileSink?.setSecrets(collectApiKeys(settings))
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

// Enable remote debugging for MCP Electron tools (port 9222)
app.commandLine.appendSwitch('remote-debugging-port', '9222')

let win: BrowserWindow | null
let forceClose = false

// Crash evidence must land in the log file; the sink attaches once app is ready.
process.on('uncaughtException', (err) => {
  appLog.error('uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  appLog.error('unhandledRejection:', reason)
})

let fsService: FileSystemService
let aiService: AiService
let aiServiceReady = false
let streamManager: StreamManager | null = null
let chatOrchestrator: AgentOrchestrator | null = null
let mcpManager: McpManager | null = null

/**
 * MCP 用户态记录的是用户的授权意图，只持久化 connected / disconnected。
 * connecting / failed 是会话内瞬态——若把 failed 落盘，一次临时故障会把
 * server 永久移出启动重连集合（凭据其实还在）。
 */
async function persistMcpStatus(serverId: string, status: McpServerStatus): Promise<void> {
  if (status.state !== 'connected' && status.state !== 'disconnected') return
  try {
    const settings = await fsService.appState.load()
    await fsService.appState.update({
      mcpServers: {
        ...settings.mcpServers,
        [serverId]: {
          state: status.state,
          ...(status.workspaceName ? { workspaceName: status.workspaceName } : {}),
        },
      },
    })
  } catch (err) {
    mcpLog.warn('failed to persist status for %s: %o', serverId, err)
  }
}

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

async function syncWorkspaceFromFile(filePath: string, data?: MindLaneFile): Promise<void> {
  const settings = await fsService.appState.load()

  const currentWorkspace = settings.lastWorkspacePath
    ? path.resolve(settings.lastWorkspacePath)
    : null
  const fileIsInCurrentWorkspace =
    currentWorkspace && fsService.workspaceTree.isWithinWorkspace(filePath, currentWorkspace)

  const workspacePath = fileIsInCurrentWorkspace ? currentWorkspace : path.dirname(filePath)

  await fsService.appState.switchWorkspace(workspacePath).catch(() => {})
  const title = data?.metadata.title || path.basename(filePath, path.extname(filePath))
  const recentFilesMax = await fsService.appState.getRecentFilesMax()
  await fsService.workspace.openFile(workspacePath, filePath, title, recentFilesMax).catch(() => {})
}

export async function getWorkspaceSessionForService(service: FileSystemService) {
  const launchResult = await service.appState.getLaunchSession()
  if (!launchResult.ok) {
    return {
      workspacePath: null as string | null,
      workspaceUuid: null as string | null,
      activeSessionIds: {} as Record<string, string>,
      recentWorkspacePaths: [] as string[],
      lastOpenedFilePath: null as string | null,
      expandedFolderPaths: [] as string[],
      restoreLastWorkspaceOnLaunch: DEFAULT_SETTINGS.restoreLastWorkspaceOnLaunch,
    }
  }
  const { workspacePath, recentWorkspacePaths, restoreLastWorkspaceOnLaunch } = launchResult.data

  let lastOpenedFilePath: string | null = null
  let expandedFolderPaths: string[] = []
  let workspaceUuid: string | null = null
  let activeSessionIds: Record<string, string> = {}
  if (workspacePath) {
    const workspaceResult = await service.workspace.load(workspacePath)
    const workspaceState = workspaceResult.ok
      ? workspaceResult.data
      : { ...DEFAULT_WORKSPACE_STATE }
    expandedFolderPaths = workspaceState.expandedFolderPaths
    lastOpenedFilePath = workspaceState.lastOpenedFilePath
    workspaceUuid = workspaceState.workspaceUuid
    activeSessionIds = workspaceState.activeSessionIds

    // One-time migration of legacy workspace-scoped keys from global settings.json.
    // Only seed workspace-local state if it is still all-defaults, then remove the legacy keys.
    if (isDefaultWorkspaceState(workspaceState)) {
      const legacyResult = await service.appState.migrateLegacyWorkspaceState(workspacePath)
      if (legacyResult.ok && legacyResult.data) {
        await service.workspace.migrateLegacyState(workspacePath, legacyResult.data)
        const reloaded = await service.workspace.load(workspacePath)
        if (reloaded.ok) {
          expandedFolderPaths = reloaded.data.expandedFolderPaths
          lastOpenedFilePath = reloaded.data.lastOpenedFilePath
          workspaceUuid = reloaded.data.workspaceUuid
          activeSessionIds = reloaded.data.activeSessionIds
        }
      }
    }
  }

  return {
    workspacePath,
    recentWorkspacePaths,
    lastOpenedFilePath,
    expandedFolderPaths,
    workspaceUuid,
    activeSessionIds,
    restoreLastWorkspaceOnLaunch,
  }
}

async function getWorkspaceSession() {
  return getWorkspaceSessionForService(fsService)
}

function isDefaultWorkspaceState(state: WorkspaceState): boolean {
  return (
    state.lastOpenedFilePath === null &&
    state.expandedFolderPaths.length === 0 &&
    state.recentFiles.length === 0
  )
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
      browserWindow.webContents.send(IPC.AppBeforeClose)
    }
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send(IPC.MainProcessMessage, new Date().toLocaleString())
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
    const settings = await fsService.appState.load()
    const providerId = settings.activeProviders.chat || 'dashscope'
    const providerConfig = settings.providerConfigs[providerId]
    const providerMeta = getProviderMeta(providerId)
    const requestedModel = model.trim() || settings.chatModel || ''
    const normalizedModel = providerMeta?.defaultModels.some((item) => item.id === requestedModel)
      ? requestedModel
      : providerMeta?.defaultModels[0]?.id || requestedModel || 'qwen-turbo'
    return createProvider(providerId, {
      apiKey: apiKey.trim() || providerConfig?.apiKey || settings.apiKey || '',
      chatModel: normalizedModel,
      baseUrl: providerConfig?.baseUrl,
    })
  }

  const resolveMessagePipelineConfig = async () => {
    const settings = await fsService.appState.load()
    const providerId = settings.activeProviders.chat || 'dashscope'
    const providerOverride = settings.providerConfigs[providerId]?.messagePipeline
    return mergeMessagePipelineConfig({
      ...settings.messagePipeline,
      ...providerOverride,
    })
  }

  // -- AI chat stream (concurrent runners) --
  streamManager ??= new StreamManager({
    aiService,
    eventSink: (event: ChatStreamEvent) => {
      win?.webContents.send(IPC.AiChatStreamEvent, event)
    },
    createRuntime: async () => {
      const settings = await fsService.appState.load()
      const providerId = settings.activeProviders.chat || 'dashscope'
      const providerConfig = settings.providerConfigs[providerId]
      const apiKey = providerConfig?.apiKey || settings.apiKey || ''
      if (!apiKey.trim()) throw new Error('未填写 API Key')
      const provider = createProvider(providerId, {
        apiKey,
        chatModel: settings.chatModel || 'qwen-turbo',
        baseUrl: providerConfig?.baseUrl,
      })
      providerLog.info('初始化： %s, model=%s', providerId, settings.chatModel || 'qwen-turbo')
      const messagePipeline = await resolveMessagePipelineConfig()
      if (chatOrchestrator) chatOrchestrator.updateProvider(provider, messagePipeline)
      else {
        chatOrchestrator = new AgentOrchestrator(provider, aiService, {
          userDataPath,
          messagePipeline,
        })
      }
      // orchestrator 可能在 MCP 连接完成后才被创建，这里保证拿到当前 MCP 工具集
      chatOrchestrator.setMcpTools(mcpManager?.getTools() ?? [])
      return chatOrchestrator.getStreamRuntime() as unknown as StreamRuntime
    },
  })

  ipcMain.handle(
    IPC.AiChatStream,
    async (_e, payload: { threadId: string; message: string; context: ChatContext }) => {
      if (!aiServiceReady) {
        return { ok: false, error: 'AI service not initialized' }
      }

      try {
        if (!payload.message?.trim()) {
          return { ok: false, error: '消息不能为空' }
        }

        let fileTags: string[] | undefined
        if (payload.context?.filePath) {
          try {
            const raw = await fs.promises.readFile(payload.context.filePath, 'utf-8')
            const data = JSON.parse(raw) as MindLaneFile
            fileTags = data.metadata.tags
          } catch {
            /* ignore */
          }
        }

        const workspacePath = payload.context.workspacePath
        if (!workspacePath || !payload.context.fileUuid) {
          return { ok: false, error: '聊天上下文缺少文件身份或工作区路径' }
        }
        let workspaceUuid: string
        {
          const workspaceState = await fsService.workspace.load(workspacePath)
          if (!workspaceState.ok) return workspaceState
          workspaceUuid = workspaceState.data.workspaceUuid
          if (!workspaceUuid) return { ok: false, error: '工作区缺少稳定身份' }
        }

        const request: StreamRequest = {
          sessionId: payload.threadId || crypto.randomUUID(),
          message: payload.message,
          workspaceUuid,
          context: {
            ...payload.context,
            selectedNodes: payload.context.selectedNodes?.filter(
              (n) => n.type === 'text' || n.type === 'palace',
            ),
            fileTags,
          },
          documentRef: payload.context?.attachedDocument,
        }

        return {
          ok: true,
          streamId: streamManager!.startStream(request),
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  ipcMain.handle(IPC.AiChatStreamStop, (_e, payload: { streamId: string }) => {
    return { ok: streamManager?.stopStream(payload.streamId) ?? false }
  })

  // -- Image URL to base64 data URL --
  ipcMain.handle(IPC.ImageUrlToDataUrl, async (_e, payload: { url: string }) => {
    try {
      const dataUrl = await urlToDataUrl(payload.url)
      return { ok: true, data: { dataUrl } }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // -- Nodes to Palace pipeline (multi-agent: Analyze → imageGen → Vision) --
  ipcMain.handle(
    IPC.AiNodesToPalace,
    async (
      _e,
      payload: { apiKey: string; model: string; selectedNodes: SelectedNodeContent[] },
    ) => {
      const provider = await createProviderForRequest(payload.apiKey, payload.model)
      const messagePipeline = await resolveMessagePipelineConfig()
      if (!chatOrchestrator) {
        chatOrchestrator = new AgentOrchestrator(provider, aiService, {
          userDataPath,
          messagePipeline,
        })
      }
      return chatOrchestrator.runPalaceFromNodes(payload.selectedNodes, provider)
    },
  )

  // -- Provider management --
  ipcMain.handle(IPC.AiListProviders, async () => {
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

  ipcMain.handle(IPC.AiGetProviders, async () => {
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

  ipcMain.handle(IPC.AiGetCapabilities, async () => {
    try {
      const settings = await fsService.appState.load()
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
  ipcMain.handle(IPC.FileOpen, async () => {
    if (!win) return { ok: false, error: 'No window' }
    const settings = await fsService.appState.load()
    const result = await fsService.project.open(win, {
      defaultPath: settings.lastWorkspacePath ?? undefined,
    })
    if (result.ok) {
      await syncWorkspaceFromFile(result.data.filePath, result.data.data)
    }
    return result
  })

  ipcMain.handle(IPC.FileSave, async (_e, payload: { filePath: string | null; data: unknown }) => {
    if (!win) return { ok: false, error: 'No window' }
    const data = payload.data as MindLaneFile
    const result = await fsService.project.save(payload.filePath, data, win)
    if (result.ok) {
      await syncWorkspaceFromFile(result.data.filePath, result.data.data)
    }
    return result
  })

  ipcMain.handle(IPC.FileSaveAs, async (_e, payload: { data: unknown }) => {
    if (!win) return { ok: false, error: 'No window' }
    const settings = await fsService.appState.load()
    const data = payload.data as MindLaneFile
    const result = await fsService.project.saveAs(data, win, {
      defaultDirectory: settings.lastWorkspacePath,
    })
    if (result.ok) {
      await syncWorkspaceFromFile(result.data.filePath, result.data.data)
    }
    return result
  })

  ipcMain.handle(IPC.FileRecentList, async () => {
    const settings = await fsService.appState.load()
    if (!settings.lastWorkspacePath || !directoryExists(settings.lastWorkspacePath)) return []
    await fsService.workspace.pruneRecentFiles(settings.lastWorkspacePath)
    const recentResult = await fsService.workspace.getRecentFiles(settings.lastWorkspacePath)
    return recentResult.ok ? recentResult.data : []
  })

  ipcMain.handle(
    IPC.FileSaveThumbnail,
    async (_e, payload: { filePath: string; imageData: string }) => {
      try {
        const url = await fsService.thumbnails.save(payload.filePath, payload.imageData)
        return { ok: true, data: { previewUrl: url } }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  ipcMain.handle(IPC.FileSelectDocument, async () => {
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
    if (!win) return { ok: false, error: 'No window' }
    const settings = await fsService.appState.load()
    const result = await dialog.showOpenDialog(win, {
      title: '打开本地仓库',
      defaultPath: settings.lastWorkspacePath ?? undefined,
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: '已取消' }
    }
    const workspacePath = path.resolve(result.filePaths[0]!)
    const switchResult = await fsService.appState.switchWorkspace(workspacePath)
    if (!switchResult.ok) return switchResult
    await fsService.workspace.clearLastOpenedFile(workspacePath).catch(() => {})
    const filesResult = await fsService.workspaceTree.listFiles(workspacePath)
    if (!filesResult.ok) return filesResult
    return { ok: true, data: { workspacePath, files: filesResult.data } }
  })

  ipcMain.handle(IPC.WorkspaceCreateDirectory, async (_e, payload: { name: string }) => {
    if (!win) return { ok: false, error: 'No window' }
    const settings = await fsService.appState.load()
    const parentResult = await dialog.showOpenDialog(win, {
      title: '选择仓库父目录',
      defaultPath: settings.lastWorkspacePath ?? undefined,
      properties: ['openDirectory'],
    })
    if (parentResult.canceled || parentResult.filePaths.length === 0) {
      return { ok: false, error: '已取消' }
    }
    const createResult = await fsService.workspaceTree.createDirectory(
      parentResult.filePaths[0]!,
      payload.name,
    )
    if (!createResult.ok) return createResult
    const switchResult = await fsService.appState.switchWorkspace(createResult.data)
    if (!switchResult.ok) return switchResult
    await fsService.workspace.clearLastOpenedFile(createResult.data).catch(() => {})
    return { ok: true, data: { workspacePath: createResult.data, files: [] } }
  })

  ipcMain.handle(
    IPC.WorkspaceCreateFile,
    async (_e, payload: { workspacePath: string; name: string; data: unknown }) => {
      const data = payload.data as MindLaneFile
      const result = await fsService.project.createInDirectory(
        payload.workspacePath,
        payload.name,
        data,
      )
      if (result.ok) {
        await syncWorkspaceFromFile(result.data.filePath, result.data.data)
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
    return fsService.workspaceTree.listFiles(payload.workspacePath)
  })

  ipcMain.handle(IPC.WorkspaceOpenFilePath, async (_e, payload: { filePath: string }) => {
    const result = await fsService.project.loadFromPath(payload.filePath)
    if (result.ok) {
      await syncWorkspaceFromFile(result.data.filePath, result.data.data)
    }
    return result
  })

  ipcMain.handle(IPC.WorkspaceGetSession, async () => {
    return getWorkspaceSession()
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
        const result = await fsService.workspace.setActiveSessionId(
          payload.workspacePath,
          activeSession.fileUuid,
          activeSession.sessionId,
        )
        if (!result.ok) return result
      }
      if (payload.expandedFolderPaths !== undefined) {
        const result = await fsService.workspace.updateExpandedFolders(
          payload.workspacePath,
          payload.expandedFolderPaths,
        )
        if (!result.ok) return result
      }
      if (payload.activeSessionIds !== undefined) {
        const result = await fsService.workspace.updateActiveSessionIds(
          payload.workspacePath,
          payload.activeSessionIds,
        )
        if (!result.ok) return result
      }
      if (payload.lastOpenedFilePath !== undefined) {
        const result =
          payload.lastOpenedFilePath === null
            ? await fsService.workspace.clearLastOpenedFile(payload.workspacePath)
            : { ok: false, error: '不支持直接设置 lastOpenedFilePath' }
        if (!result.ok) return result
      }
      return { ok: true }
    },
  )

  ipcMain.handle(IPC.WorkspaceSwitch, async (_e, payload: { workspacePath: string }) => {
    const workspacePath = path.resolve(payload.workspacePath)
    const filesResult = await fsService.workspaceTree.listFiles(workspacePath)
    if (!filesResult.ok) return filesResult
    const switchResult = await fsService.appState.switchWorkspace(workspacePath)
    if (!switchResult.ok) return switchResult
    await fsService.workspace.clearLastOpenedFile(workspacePath).catch(() => {})
    return { ok: true, data: { workspacePath, files: filesResult.data } }
  })

  ipcMain.handle(IPC.WorkspaceListTree, async (_e, payload: { workspacePath: string }) => {
    return fsService.workspaceTree.listTree(payload.workspacePath)
  })

  ipcMain.handle(
    IPC.WorkspaceCreateSubfolder,
    async (_e, payload: { parentPath: string; name: string; workspacePath: string }) => {
      const result = await fsService.workspaceTree.createSubdirectory(
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
      const result = await fsService.workspaceTree.deleteItem(
        payload.targetPath,
        payload.workspacePath,
      )
      if (!result.ok) return result
      // 清理缩略图
      await fsService.thumbnails.delete(payload.targetPath).catch(() => {})
      return { ok: true }
    },
  )

  ipcMain.handle(
    IPC.WorkspaceRenameItem,
    async (_e, payload: { oldPath: string; newName: string; workspacePath: string }) => {
      const result = await fsService.workspaceTree.rename(
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
      const result = await fsService.workspaceTree.move(
        payload.sourcePath,
        payload.targetDirPath,
        payload.workspacePath,
      )
      if (!result.ok) return result
      return { ok: true, data: { newPath: result.data } }
    },
  )

  // -- Chat History (Multi-session support) --

  ipcMain.handle(
    IPC.ChatListSessions,
    async (
      _e,
      payload: { workspacePath: string; fileUuid: string; limit?: number; offset?: number },
    ) => {
      if (!aiServiceReady) return aiNotReadyResponse()
      try {
        const workspaceState = await fsService.workspace.load(payload.workspacePath)
        if (!workspaceState.ok) return workspaceState
        const sessions = await aiService.sessionManager.runInWorkspace(
          workspaceState.data.workspaceUuid,
          () =>
            aiService.sessionManager.listSessions({
              fileUuid: payload.fileUuid,
              limit: payload.limit,
              offset: payload.offset,
            }),
        )
        return { ok: true, data: { sessions } }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    IPC.ChatLoadSession,
    async (_e, payload: { workspacePath: string; sessionId: string }) => {
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
        const workspaceState = await fsService.workspace.load(payload.workspacePath)
        if (!workspaceState.ok) throw new Error(workspaceState.error)
        const messages = await aiService.sessionManager.runInWorkspace(
          workspaceState.data.workspaceUuid,
          () => aiService.sessionManager.loadSessionMessages(payload.sessionId),
        )
        return {
          ok: true,
          data: {
            sessionId: payload.sessionId,
            messages,
          },
        }
      } catch {
        return {
          ok: true,
          data: {
            sessionId: payload.sessionId,
            messages: [],
          },
        }
      }
    },
  )

  ipcMain.handle(
    IPC.ChatDeleteSession,
    async (_e, payload: { workspacePath: string; sessionId: string }) => {
      if (!aiServiceReady) return aiNotReadyResponse()
      try {
        const workspaceState = await fsService.workspace.load(payload.workspacePath)
        if (!workspaceState.ok) return workspaceState
        const sessionMeta = await aiService.sessionManager.runInWorkspace(
          workspaceState.data.workspaceUuid,
          async () => {
            const meta = aiService.sessionManager.getSessionMeta(payload.sessionId)
            await aiService.sessionManager.deleteSession(payload.sessionId)
            return meta
          },
        )
        if (sessionMeta?.fileUuid) {
          await fsService.workspace.setActiveSessionId(
            payload.workspacePath,
            sessionMeta.fileUuid,
            null,
            payload.sessionId,
          )
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // -- Shell: open linked document refs --
  ipcMain.handle('shell:open-document-ref', async (_e, doc: DocumentRef) => {
    const resolved = resolveDocumentRef(doc, userDataPath)
    if (!resolved.ok) {
      return { ok: false, error: resolved.error }
    }

    if (doc.type === 'text' && !fs.existsSync(resolved.target)) {
      return { ok: false, error: '缓存文件不存在' }
    }

    try {
      if (resolved.external) {
        await shell.openExternal(resolved.target)
      } else {
        const error = await shell.openPath(resolved.target)
        if (error) {
          return { ok: false, error }
        }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // -- Shell: reveal the log file so users can attach it to a bug report --
  ipcMain.handle(IPC.ShellOpenLogs, () => {
    shell.showItemInFolder(path.join(userDataPath, 'logs', 'mindlane.log'))
    return { ok: true }
  })

  // -- Settings --
  ipcMain.handle(IPC.FileSettingsLoad, async () => {
    return fsService.appState.load()
  })

  ipcMain.handle(IPC.FileSettingsUpdate, async (_e, partial: Record<string, unknown>) => {
    await fsService.appState.update(partial as Partial<AppSettings>)
    streamManager?.invalidateRuntime()
    // API keys may have changed — refresh the redaction list on the file sink.
    const settings = await fsService.appState.load()
    refreshLogSecrets(settings)
  })

  // -- MCP servers (catalog + OAuth) --
  ipcMain.handle(IPC.McpConnect, async (_e, payload: { serverId: string }) => {
    if (!mcpManager) return { ok: false, error: 'MCP 模块未初始化' }
    try {
      const status = await mcpManager.connect(payload.serverId)
      if (status.state !== 'connected') {
        return { ok: false, error: status.error ?? '连接失败' }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.McpDisconnect, async (_e, payload: { serverId: string }) => {
    if (!mcpManager) return { ok: false, error: 'MCP 模块未初始化' }
    await mcpManager.disconnect(payload.serverId)
    return { ok: true }
  })

  ipcMain.handle(IPC.McpStatus, async () => {
    return { ok: true, data: mcpManager?.getStatuses() ?? [] }
  })

  ipcMain.handle(IPC.WindowMinimize, () => {
    win?.minimize()
  })

  ipcMain.handle(IPC.WindowToggleMaximize, () => {
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.handle(IPC.WindowClose, () => {
    win?.close()
  })

  ipcMain.handle(IPC.WindowCloseConfirmed, () => {
    forceClose = true
    win?.close()
  })

  ipcMain.handle(IPC.WindowOpenDevtools, () => {
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

  // File sink first: every later log line (debug included) lands on disk.
  logFileSink = new RotatingFileSink({ filePath: path.join(userDataPath, 'logs', 'mindlane.log') })
  logger.setSink(logFileSink)
  appLog.info(
    '启动： version=%s, platform=%s, arch=%s',
    app.getVersion(),
    process.platform,
    process.arch,
  )

  fsService = new FileSystemService(userDataPath)
  await fsService.initialize()
  fsService.workspaceTree.setThumbnailManager(fsService.thumbnails)

  // MCP：safeStorage 不可用时凭据仅驻留内存（McpCredentialStore 会记录警告）
  mcpManager = new McpManager({
    userDataPath,
    createClient: createMcpClient,
    credentialCrypto: safeStorage.isEncryptionAvailable()
      ? {
          encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
          decrypt: (cipher) => safeStorage.decryptString(Buffer.from(cipher, 'base64')),
        }
      : undefined,
    openBrowser: (url) => void shell.openExternal(url),
    onToolsChanged: (tools) => {
      chatOrchestrator?.setMcpTools(tools)
      streamManager?.invalidateRuntime()
    },
    onStatusChanged: (serverId, status) => {
      mcpLog.info(
        'server %s: %s%s',
        serverId,
        status.state,
        status.error ? ` — ${status.error}` : '',
      )
      void persistMcpStatus(serverId, status)
    },
  })
  // 异步静默重连已授权 server，不阻塞 app 可用
  const manager = mcpManager
  void (async () => {
    try {
      const settings = await fsService.appState.load()
      await manager.start(settings.mcpServers)
    } catch (err) {
      mcpLog.warn('startup connect failed: %o', err)
    }
  })()

  aiService = new AiService()
  try {
    const settings = await fsService.appState.load()
    refreshLogSecrets(settings)
    const providerId = settings.activeProviders.chat || 'dashscope'
    const providerConfig = settings.providerConfigs[providerId]
    const apiKey = providerConfig?.apiKey || settings.apiKey || ''
    if (apiKey) {
      createProvider(providerId, {
        apiKey,
        chatModel: settings.chatModel || 'qwen-turbo',
        baseUrl: providerConfig?.baseUrl,
      })
      providerLog.info('初始化： %s, model=%s', providerId, settings.chatModel || 'qwen-turbo')
    } else {
      providerLog.info('未配置 API Key，provider 初始化推迟到首次对话')
    }
    await aiService.init(userDataPath)
    await cleanupToolResultOffloads(userDataPath)
    aiServiceReady = true
  } catch (err) {
    appLog.error('AI service init failed:', err)
    console.error('AI service init failed:', err)
  }

  registerIpcHandlers(userDataPath)
  setupApplicationMenu()
  createWindow()
})
