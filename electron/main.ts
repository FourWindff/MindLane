import { app, BrowserWindow, Menu, safeStorage, shell, dialog } from 'electron'
import { DOMParser as LinkedomDOMParser } from 'linkedom'
import { registerXmlDomParser } from '../contracts/mindmapXml/parser.js'
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
import { McpManager } from './agent/mcp/mcpManager.js'
import { createMcpClient } from './agent/mcp/clientFactory.js'
import { logger, RotatingFileSink } from './shared/logger.js'
import { cleanupToolResultOffloads } from './agent/tools/toolResultNormalizer.js'

// The XML parsing kernel is assembled per process (design doc 5.1): the main process uses
// linkedom (an HTML parser tolerant of AI output), the renderer uses DOMParser; linkedom does
// not enter the renderer bundle (the optional canvas dependency cannot be statically resolved).
registerXmlDomParser(LinkedomDOMParser)

import { registerFsHandlers } from './main/handlers/fs.js'
import { registerAiHandlers } from './main/handlers/ai.js'
import { registerChatHandlers } from './main/handlers/chat.js'
import { registerSettingsHandlers } from './main/handlers/settings.js'
import { registerMcpHandlers, persistMcpStatus } from './main/handlers/mcp.js'
import { registerShellHandlers } from './main/handlers/shell.js'
import { registerWindowHandlers } from './main/handlers/window.js'
import {
  buildMindmapReadRequest,
  buildMindmapWriteRequest,
  createMindmapReadRequester,
  createMindmapWriteRequester,
} from './main/mindmapRequesters.js'
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

// Enable remote debugging for MCP Electron tools (port 9222). Development only:
// packaged builds must not open a debug port.
if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

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
  logFileSink = new RotatingFileSink(path.join(userDataPath, 'logs', 'mindlane.log'))
  logger.setSink(logFileSink)
  appLog.info(
    'Startup: version=%s, platform=%s, arch=%s',
    app.getVersion(),
    process.platform,
    process.arch,
  )

  fsService = new FileSystemService(userDataPath)
  await fsService.initialize()

  // MCP: when safeStorage is unavailable credentials stay in memory only (McpCredentialStore logs a warning)
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
  // Silently reconnect authorized servers in the background; does not block app availability
  const manager = mcpManager
  void (async () => {
    try {
      const settings = await fsService.appState.load()
      await manager.start(settings.mcpServers)
    } catch (err) {
      mcpLog.warn('startup connect failed: %o', err)
    }
  })()

  // AI service assembly: success -> set the readiness gate; failure -> show a dialog about the
  // degradation and keep running; non-AI features such as mindmap editing stay available
  // (the renderer reads isReady over the bridge to show the disabled state).
  try {
    services = await initAgentServices(userDataPath)
    aiServiceReady = true
  } catch (err) {
    appLog.error('AI service init failed:', err)
    console.error('AI service init failed:', err)
    dialog.showErrorBox(
      'AI service initialization failed',
      'Chat and memory are disabled; mindmap editing is unaffected. Restart the app to retry.',
    )
  }

  // best-effort, independent of AI assembly: a single garbage-collection/redaction failure must not affect AI readiness.
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

  // Main process -> renderer mindmap read/save requesters: `win` is a module-level mutable
  // reference (the window can be recreated) injected via a getter, so a request fails
  // immediately instead of hanging once the window is destroyed.
  const mindmapReadRequester = createMindmapReadRequester(() => win)
  const mindmapWriteRequester = createMindmapWriteRequester(() => win)

  // StreamManager is constructed only after assembly succeeds: its input is narrowed to sessionManager.
  if (services) {
    const sessionManager = services.sessionManager
    streamManager = new StreamManager({
      sessionManager,
      eventSink,
      createRuntime: async () => {
        const settings = await fsService.appState.load()
        const provider = resolveChatProvider(settings)
        providerLog.info(
          'Initializing: %s, model=%s',
          settings.activeProviders.chat || 'dashscope',
          settings.chatModel,
        )
        if (!chatOrchestrator) {
          // Lazy creation only happens after the readiness gate passes, so services is non-null.
          chatOrchestrator = new AgentOrchestrator(provider, services!, {
            userDataPath,
            mindmapReadProvider: (fileUuid, query) =>
              mindmapReadRequester.request(() => buildMindmapReadRequest(fileUuid, query)),
            mindmapWriteProxy: (fileUuid, action, args) =>
              mindmapWriteRequester.request(() => buildMindmapWriteRequest(fileUuid, action, args)),
          })
        } else {
          // The reused orchestrator still runs the model it was built with.
          chatOrchestrator.updateProvider(provider)
        }
        // the orchestrator may be created before MCP connects; make sure it gets the current MCP tool set
        chatOrchestrator.setMcpTools(mcpManager?.getTools() ?? [])
        return chatOrchestrator.getStreamRuntime(settings.palaceArtworkStyle)
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
    getMcpManager: () => mcpManager,
    isAiServiceReady: () => aiServiceReady,
    userDataPath,
    invalidateStreamRuntime: () => streamManager?.invalidateRuntime(),
    refreshLogSecrets,
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
