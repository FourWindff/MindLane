import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import { logger } from '../shared/logger.js'
import { McpCredentialStore, type McpCredentialCrypto } from './credentials.js'
import {
  LoopbackOAuthProvider,
  startLoopbackCallbackServer,
  type LoopbackCallbackServer,
} from './oauth.js'
import type {
  McpClientFactory,
  McpClientLike,
  McpServerDefinition,
  McpServerStatus,
  McpServerStatusInfo,
  McpServerUserState,
} from './types.js'
import { MCP_SERVERS } from './servers/index.js'

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000
const DEFAULT_AUTH_TIMEOUT_MS = 5 * 60_000
/** 非交互模式下 OAuth provider 的占位回调地址（不会真正发起 DCR/重定向，仅满足 clientMetadata） */
const NON_INTERACTIVE_REDIRECT_URL = 'http://127.0.0.1/callback'

export interface McpManagerOptions {
  userDataPath: string
  /** 唯一测试接缝：client 创建工厂 */
  createClient: McpClientFactory
  servers?: McpServerDefinition[]
  /** 凭据加密；缺失时凭据仅保存在内存并警告 */
  credentialCrypto?: McpCredentialCrypto
  openBrowser?: (url: string) => void
  onToolsChanged?: (tools: StructuredToolInterface[]) => void
  onStatusChanged?: (serverId: string, status: McpServerStatus) => void
  /** 单次 getTools 超时（默认 15s） */
  connectTimeoutMs?: number
  /** 等待用户完成浏览器授权的超时（默认 5min） */
  authTimeoutMs?: number
}

/**
 * MCP 生命周期核心：启动时连接已授权 server、单点失败降级、
 * 授权完成/断开时热重载工具、对外暴露连接状态。
 */
export class McpManager {
  private readonly servers: Map<string, McpServerDefinition>
  private readonly statuses = new Map<string, McpServerStatus>()
  private readonly clients = new Map<string, McpClientLike>()
  private readonly toolsByServer = new Map<string, StructuredToolInterface[]>()
  private readonly credentialStores = new Map<string, McpCredentialStore>()
  private readonly connectTokens = new Map<string, number>()

  constructor(private readonly options: McpManagerOptions) {
    this.servers = new Map((options.servers ?? MCP_SERVERS).map((s) => [s.id, s]))
    for (const id of this.servers.keys()) this.statuses.set(id, { state: 'disconnected' })
  }

  /**
   * 启动：用持久化的 MCP 用户态水合展示信息（如 workspace 名），
   * 并静默重连所有已授权 server；单点失败互不影响，永不 reject。
   */
  async start(persistedState: Record<string, McpServerUserState>): Promise<void> {
    const authorized: string[] = []
    for (const [serverId, userState] of Object.entries(persistedState)) {
      if (!this.servers.has(serverId)) continue
      // 直接写内部状态而不走 setStatus——水合不是状态迁移，不应触发持久化回调
      if (userState.workspaceName) {
        this.statuses.set(serverId, {
          state: 'disconnected',
          workspaceName: userState.workspaceName,
        })
      }
      if (userState.state === 'connected') authorized.push(serverId)
    }
    await Promise.allSettled(authorized.map((serverId) => this.connectServer(serverId, false)))
  }

  /** 交互式连接（设置面板“连接”按钮）：OAuth server 触发浏览器授权，非 OAuth server 用随凭据直接连接 */
  async connect(serverId: string, credentials?: Record<string, string>): Promise<McpServerStatus> {
    await this.connectServer(serverId, true, credentials)
    return this.statuses.get(serverId) ?? { state: 'failed', error: '未知的 MCP server' }
  }

  /** 断开：移除工具、关闭连接、删除凭据 */
  async disconnect(serverId: string): Promise<void> {
    this.bumpToken(serverId)
    const client = this.clients.get(serverId)
    this.clients.delete(serverId)
    this.toolsByServer.delete(serverId)
    if (client) await client.close().catch(() => {})
    this.getCredentialStore(serverId).clear()
    this.setStatus(serverId, { state: 'disconnected' })
    this.emitToolsChanged()
  }

  /** 当前已注入的全部 MCP 工具（已加 server 前缀） */
  getTools(): StructuredToolInterface[] {
    return [...this.toolsByServer.values()].flat()
  }

  getStatuses(): McpServerStatusInfo[] {
    return [...this.servers.values()].map((def) => ({
      id: def.id,
      displayName: def.displayName,
      description: def.description,
      ...(def.credentialFields ? { credentialFields: def.credentialFields } : {}),
      ...(def.failureHint ? { failureHint: def.failureHint } : {}),
      ...(this.statuses.get(def.id) ?? { state: 'disconnected' as const }),
    }))
  }

  private async connectServer(
    serverId: string,
    interactive: boolean,
    credentials?: Record<string, string>,
  ): Promise<void> {
    const def = this.servers.get(serverId)
    if (!def) {
      logger.withContext('mcp').warn('unknown server: %s', serverId)
      return
    }
    const token = this.bumpToken(serverId)
    this.setStatus(serverId, { state: 'connecting' })
    try {
      if (!(await this.applyCredentials(def, credentials))) return
      const { client, tools } = await this.establish(def, interactive)
      if (!this.isCurrent(serverId, token)) {
        await client.close().catch(() => {})
        return
      }
      await this.clients
        .get(serverId)
        ?.close()
        .catch(() => {})
      this.clients.set(serverId, client)
      // allowlist 裁剪先于加前缀与注册：破坏性/副作用工具永远不进入 ToolRegistry
      const exclude = def.excludeTools
      const toolsToRegister =
        exclude && exclude.length > 0 ? tools.filter((tool) => !exclude.includes(tool.name)) : tools
      for (const tool of toolsToRegister) tool.name = `${def.id}__${tool.name}`
      this.toolsByServer.set(serverId, toolsToRegister)

      let workspaceName = this.statuses.get(serverId)?.workspaceName
      if (interactive && def.fetchWorkspaceName) {
        workspaceName =
          (await def.fetchWorkspaceName(tools).catch(() => undefined)) ?? workspaceName
      }
      this.setStatus(serverId, { state: 'connected', workspaceName })
      this.emitToolsChanged()
      logger.withContext('mcp').info('server %s connected, %d tools', serverId, tools.length)
    } catch (err) {
      if (!this.isCurrent(serverId, token)) return
      const message = err instanceof Error ? err.message : String(err)
      logger.withContext('mcp').warn('server %s connect failed: %s', serverId, message)
      const hint = def.failureHint ? ` ${def.failureHint}` : ''
      this.setStatus(serverId, { state: 'failed', error: message + hint })
    }
  }

  /**
   * 表单凭据：按定义的 credentialFields 校验必填项后写入凭据存储；
   * 校验失败时置 failed 并返回 false 中止连接（不发起任何请求）。
   */
  private async applyCredentials(
    def: McpServerDefinition,
    credentials?: Record<string, string>,
  ): Promise<boolean> {
    if (credentials === undefined) return true
    const fields = def.credentialFields ?? []
    const missing = fields.filter((f) => f.required).filter((f) => !credentials[f.id]?.trim())
    if (missing.length > 0) {
      const hint = def.failureHint ? ` ${def.failureHint}` : ''
      this.setStatus(def.id, {
        state: 'failed',
        error: `缺少必填连接凭据：${missing.map((f) => f.label).join('、')}${hint}`,
      })
      return false
    }
    // 只写入定义声明过的字段，避免未知键混入加密文件
    const known = Object.fromEntries(
      fields.map((f) => [f.id, credentials[f.id]]).filter(([, v]) => v != null),
    )
    if (Object.keys(known).length > 0) this.getCredentialStore(def.id).saveSecrets(known)
    return true
  }

  /**
   * 建立连接并取回工具。
   * 交互式模式下，若 SDK 因缺少有效凭据走到浏览器授权（provider.authRedirected），
   * 则等待 loopback 回调拿授权码、换 token 后重试一次。
   */
  private async establish(
    def: McpServerDefinition,
    interactive: boolean,
  ): Promise<{ client: McpClientLike; tools: StructuredToolInterface[] }> {
    const store = this.getCredentialStore(def.id)
    let loopback: LoopbackCallbackServer | null = null
    try {
      let provider: LoopbackOAuthProvider | undefined
      if (def.createAuthProvider) {
        if (interactive) loopback = await startLoopbackCallbackServer()
        provider = def.createAuthProvider({
          credentialStore: store,
          redirectUrl: loopback?.redirectUrl ?? NON_INTERACTIVE_REDIRECT_URL,
          interactive,
          openBrowser: this.options.openBrowser ?? (() => {}),
        })
      }
      // 非 OAuth 模式：从凭据存储解析认证头，注入 client 工厂（经 http transport 透传）
      const headers = def.createAuthProvider ? undefined : await def.createAuthHeaders?.(store)

      const attempt = async (): Promise<{
        client: McpClientLike
        tools: StructuredToolInterface[]
      }> => {
        const client = this.options.createClient(def, provider, headers)
        try {
          const tools = await withTimeout(
            client.getTools(),
            this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
          )
          return { client, tools }
        } catch (err) {
          await client.close().catch(() => {})
          throw err
        }
      }

      try {
        return await attempt()
      } catch (err) {
        if (interactive && loopback && provider?.authRedirected && def.connection.url) {
          const code = await loopback.waitForCallback(
            provider.expectedState,
            this.options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS,
          )
          await auth(provider, { serverUrl: def.connection.url, authorizationCode: code })
          return await attempt()
        }
        throw err
      }
    } finally {
      loopback?.close()
    }
  }

  private getCredentialStore(serverId: string): McpCredentialStore {
    let store = this.credentialStores.get(serverId)
    if (!store) {
      store = new McpCredentialStore(
        path.join(this.options.userDataPath, 'mcp-credentials', `${serverId}.json`),
        this.options.credentialCrypto,
      )
      this.credentialStores.set(serverId, store)
    }
    return store
  }

  private bumpToken(serverId: string): number {
    const next = (this.connectTokens.get(serverId) ?? 0) + 1
    this.connectTokens.set(serverId, next)
    return next
  }

  private isCurrent(serverId: string, token: number): boolean {
    return this.connectTokens.get(serverId) === token
  }

  private setStatus(serverId: string, status: McpServerStatus): void {
    this.statuses.set(serverId, status)
    this.options.onStatusChanged?.(serverId, status)
  }

  private emitToolsChanged(): void {
    this.options.onToolsChanged?.(this.getTools())
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('连接超时')), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
