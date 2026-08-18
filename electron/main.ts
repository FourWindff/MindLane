import { app, BrowserWindow, Menu, safeStorage, shell, dialog } from 'electron'
import { DOMParser as LinkedomDOMParser } from 'linkedom'
import { registerXmlDomParser } from '../src/shared/lib/mindmapXml/parser.js'
import { resolveChatProvider } from './agent/providers/index.js'
import { FileSystemService } from './fs/index.js'
import {
  loadWindowBounds,
  resolveWindowBounds,
  saveWindowBounds,
  MIN_WIDTH,
  MIN_HEIGHT,
} from './windowState.js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { AppSettings } from './fs/types.js'
import { IPC } from './ipc.js'
import type { ChatStreamEvent } from './ipc.js'

import { initAgentServices, type AgentServices } from './agent/service.js'
import { AgentOrchestrator } from './agent/orchestrator.js'
import { StreamManager } from './agent/streamManager.js'
import { McpManager } from './mcp/mcpManager.js'
import { createMcpClient } from './mcp/clientFactory.js'
import { logger, RotatingFileSink } from './shared/logger.js'
import { cleanupToolResultOffloads } from './agent/tools/toolResultNormalizer.js'

// XML 解析内核按进程装配（设计文档 5.1）：主进程用 linkedom（HTML parser 容错 AI 输出），
// 渲染层用 DOMParser；linkedom 不进渲染层 bundle（可选依赖 canvas 无法被静态解析）。
registerXmlDomParser(LinkedomDOMParser)

import { registerFsHandlers } from './main/handlers/fs.js'
import { registerAiHandlers } from './main/handlers/ai.js'
import { registerChatHandlers } from './main/handlers/chat.js'
import { registerSettingsHandlers } from './main/handlers/settings.js'
import { registerMcpHandlers, persistMcpStatus } from './main/handlers/mcp.js'
import { registerShellHandlers } from './main/handlers/shell.js'
import { registerWindowHandlers } from './main/handlers/window.js'
import { resolveMessagePipelineConfig } from './main/messagePipeline.js'
import { MindmapReadRequester } from './main/mindmapRead.js'
import { MindmapWriteRequester } from './main/mindmapWrite.js'
import type { HandlerContext } from './main/handlers/context.js'

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
let services: AgentServices | null = null
let aiServiceReady = false
let streamManager: StreamManager | null = null
let chatOrchestrator: AgentOrchestrator | null = null
let mcpManager: McpManager | null = null

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
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
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

  // Native escape hatch when the renderer hangs or crashes: lets the user
  // force-close the app even if the renderer can't answer, instead of
  // hunting the process down in a terminal.
  let hangDialogOpen = false
  browserWindow.on('unresponsive', () => {
    if (hangDialogOpen || browserWindow.isDestroyed()) return
    hangDialogOpen = true
    void dialog
      .showMessageBox(browserWindow, {
        type: 'warning',
        title: 'MindLane not responding',
        message: 'The application window has stopped responding.',
        detail: 'You can wait for it to recover, or force quit the app.',
        buttons: ['Force quit', 'Wait'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => {
        hangDialogOpen = false
        if (response === 0 && !browserWindow.isDestroyed()) {
          forceClose = true
          browserWindow.close()
        }
      })
  })
  browserWindow.on('responsive', () => {
    hangDialogOpen = false
  })
  browserWindow.webContents.on('render-process-gone', (_event, details) => {
    if (browserWindow.isDestroyed()) return
    void dialog
      .showMessageBox(browserWindow, {
        type: 'error',
        title: 'MindLane crashed',
        message: 'The renderer process has exited.',
        detail: `Reason: ${details.reason}. You can reload the page, or close the app.`,
        buttons: ['Close app', 'Reload'],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      })
      .then(({ response }) => {
        if (browserWindow.isDestroyed()) return
        if (response === 1) {
          browserWindow.webContents.reload()
        } else {
          forceClose = true
          browserWindow.close()
        }
      })
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
      void persistMcpStatus(fsService, serverId, status)
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

  // AI 服务装配：成功 → 置位就绪门控；失败 → 弹窗告知降级，不退出，
  // 导图编辑等非 AI 功能照常可用（渲染层经桥读取 isReady 显示禁用态）。
  try {
    services = await initAgentServices(userDataPath)
    aiServiceReady = true
  } catch (err) {
    appLog.error('AI service init failed:', err)
    console.error('AI service init failed:', err)
    dialog.showErrorBox(
      'AI 服务初始化失败',
      '聊天与记忆已禁用，导图编辑不受影响。可重启应用后重试。',
    )
  }

  // best-effort，独立于 AI 装配：单次垃圾回收/脱敏故障不牵连 AI 就绪状态。
  void (async () => {
    try {
      await cleanupToolResultOffloads(userDataPath)
    } catch (err) {
      appLog.warn('tool-result offload cleanup failed:', err)
    }
  })()

  try {
    refreshLogSecrets(await fsService.appState.load())
  } catch (err) {
    appLog.warn('log secrets refresh failed:', err)
  }

  const eventSink = (event: ChatStreamEvent) => {
    win?.webContents.send(IPC.AiChatStreamEvent, event)
  }

  // 主进程 → 渲染层读导图请求器：`win` 是模块级可变引用（窗口可重建），
  // 经 getter 注入，窗口销毁时请求立即报错而非挂起。
  const mindmapReadRequester = new MindmapReadRequester(() => win)
  // 主进程 → 渲染层落盘请求器：同读导图模式（requestId 关联 + 超时按失败处理）。
  const mindmapWriteRequester = new MindmapWriteRequester(() => win)

  // 唯一装配点：惰性创建（或复用）当前 orchestrator。createRuntime 与
  // getChatOrchestrator 都从这里取，避免两条构造路径漂移。
  const ensureChatOrchestrator = async (): Promise<AgentOrchestrator> => {
    if (!chatOrchestrator) {
      const settings = await fsService.appState.load()
      const provider = resolveChatProvider(settings)
      const messagePipeline = resolveMessagePipelineConfig(settings)
      // 惰性创建仅发生在就绪门控通过之后（getChatOrchestrator），services 必非空。
      chatOrchestrator = new AgentOrchestrator(provider, services!, {
        userDataPath,
        messagePipeline,
        mindmapReadProvider: (fileUuid, query) => mindmapReadRequester.request(fileUuid, query),
        mindmapSnapshotRequester: (fileUuid) => mindmapReadRequester.requestSnapshot(fileUuid),
      })
    }
    return chatOrchestrator
  }

  // 装配成功才构造 StreamManager：入参收窄为 sessionManager。
  if (services) {
    const sessionManager = services.sessionManager
    streamManager = new StreamManager({
      sessionManager,
      eventSink,
      createRuntime: async () => {
        const settings = await fsService.appState.load()
        const provider = resolveChatProvider(settings)
        providerLog.info(
          '初始化： %s, model=%s',
          settings.activeProviders.chat || 'dashscope',
          settings.chatModel,
        )
        const messagePipeline = resolveMessagePipelineConfig(settings)
        const orchestrator = await ensureChatOrchestrator()
        orchestrator.updateProvider(provider, messagePipeline)
        // orchestrator 可能在 MCP 连接完成后才被创建，这里保证拿到当前 MCP 工具集
        orchestrator.setMcpTools(mcpManager?.getTools() ?? [])
        return orchestrator.getStreamRuntime()
      },
    })
  }

  const ctx: HandlerContext = {
    fsService,
    sessionManager: services?.sessionManager ?? null,
    editLogStore: services?.editLogStore ?? null,
    getWindow: () => win,
    mindmapReadRequester,
    mindmapWriteRequester,
    getStreamManager: () => streamManager,
    getChatOrchestrator: async () => {
      if (!aiServiceReady) return null
      return ensureChatOrchestrator()
    },
    getMcpManager: () => mcpManager,
    isAiServiceReady: () => aiServiceReady,
    userDataPath,
    eventSink,
    invalidateStreamRuntime: () => streamManager?.invalidateRuntime(),
    refreshLogSecrets,
    getForceClose: () => forceClose,
    setForceClose: (value: boolean) => {
      forceClose = value
    },
  }

  registerFsHandlers(ctx)
  registerAiHandlers(ctx)
  registerChatHandlers(ctx)
  registerSettingsHandlers(ctx)
  registerMcpHandlers(ctx)
  registerShellHandlers(ctx)
  registerWindowHandlers(ctx)

  setupApplicationMenu()
  createWindow()
})
