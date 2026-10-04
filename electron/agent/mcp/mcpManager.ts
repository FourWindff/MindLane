import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import { logger } from '../../shared/logger.js'
import { McpCredentialStore, type McpCredentialCrypto } from './credentials.js'
import {
  LoopbackOAuthProvider,
  startLoopbackCallbackServer,
  type LoopbackCallbackServer,
} from './oauth.js'
import type {
  McpClientLike,
  McpServerDefinition,
  McpServerStatus,
  McpServerStatusInfo,
  McpServerUserState,
} from './types.js'
import { MCP_SERVERS } from './servers/index.js'

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000
const DEFAULT_AUTH_TIMEOUT_MS = 5 * 60_000
/** Placeholder callback URL for the OAuth provider in non-interactive mode (no real DCR/redirect happens, it only satisfies clientMetadata) */
const NON_INTERACTIVE_REDIRECT_URL = 'http://127.0.0.1/callback'

export interface McpManagerOptions {
  userDataPath: string
  /** The single test seam: client creation factory */
  createClient: (
    serverDef: McpServerDefinition,
    authProvider?: LoopbackOAuthProvider,
    /** Non-OAuth mode: auth headers resolved by createAuthHeaders, passed through to the http transport */
    headers?: Record<string, string>,
  ) => McpClientLike
  servers?: McpServerDefinition[]
  /** Credential encryption; when missing, credentials are kept in memory only with a warning */
  credentialCrypto?: McpCredentialCrypto
  openBrowser?: (url: string) => void
  onToolsChanged?: (tools: StructuredToolInterface[]) => void
  onStatusChanged?: (serverId: string, status: McpServerStatus) => void
  /** Per-call getTools timeout (15s by default) */
  connectTimeoutMs?: number
  /** Timeout for waiting on the user to finish browser authorization (5min by default) */
  authTimeoutMs?: number
}

/**
 * MCP lifecycle core: connects authorized servers at startup, degrades gracefully on a single failure,
 * hot-reloads tools on authorization completion/disconnect, and exposes connection status.
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
   * Startup: hydrates display info (e.g. the workspace name) from persisted MCP user state,
   * then silently reconnects every authorized server; a single failure does not affect the others and it never rejects.
   */
  async start(persistedState: Record<string, McpServerUserState>): Promise<void> {
    const authorized: string[] = []
    for (const [serverId, userState] of Object.entries(persistedState)) {
      if (!this.servers.has(serverId)) continue
      // Write internal state directly instead of going through setStatus - hydration is not a state transition and must not trigger the persistence callback
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

  /** Interactive connect (the settings panel "connect" button): OAuth servers trigger browser authorization, non-OAuth servers connect directly with the supplied credentials */
  async connect(serverId: string, credentials?: Record<string, string>): Promise<McpServerStatus> {
    await this.connectServer(serverId, true, credentials)
    return this.statuses.get(serverId) ?? { state: 'failed', error: 'Unknown MCP server' }
  }

  /** Disconnect: remove tools and close the connection.
   *  OAuth servers also delete stored tokens; form-configured servers (obsidian/feishu) **keep**
   *  their credentials, so a reconnect can edit the last config instead of filling it from scratch. */
  async disconnect(serverId: string): Promise<void> {
    this.bumpToken(serverId)
    const client = this.clients.get(serverId)
    this.clients.delete(serverId)
    this.toolsByServer.delete(serverId)
    if (client) await client.close().catch(() => {})
    if (this.servers.get(serverId)?.createAuthProvider) {
      this.getCredentialStore(serverId).clear()
    }
    this.setStatus(serverId, { state: 'disconnected' })
    this.emitToolsChanged()
  }

  /** Returns the saved credential key/values of a form-configured server (for the settings panel "show config" fill-in; empty object when none) */
  getSecrets(serverId: string): Record<string, string> {
    return this.getCredentialStore(serverId).load().secrets ?? {}
  }

  /** All MCP tools currently injected (already prefixed with the server id) */
  getTools(): StructuredToolInterface[] {
    return [...this.toolsByServer.values()].flat()
  }

  /**
   * Writes extra credentials that do not come from the form (e.g. a refresh_token obtained via one-click), merged into that server's credential store.
   * Lets the handler persist them after UAT authorization completes, so createAuthHeaders can auto-renew on connect.
   */
  persistSecrets(serverId: string, secrets: Record<string, string>): void {
    this.getCredentialStore(serverId).saveSecrets(secrets)
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
      // Allowlist trimming happens before prefixing and registration: destructive/side-effect tools never reach ToolRegistry
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
   * Form credentials: validates required entries against the definition's credentialFields, then writes them to the credential store;
   * on validation failure it sets failed and returns false to abort the connection (without sending any request).
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
        error: `Missing required connection credentials: ${missing.map((f) => f.label).join(', ')}${hint}`,
      })
      return false
    }
    // Only write fields the definition declares, so unknown keys never leak into the encrypted file
    const known = Object.fromEntries(
      fields.map((f) => [f.id, credentials[f.id]]).filter(([, v]) => v != null),
    )
    if (Object.keys(known).length > 0) this.getCredentialStore(def.id).saveSecrets(known)
    return true
  }

  /**
   * Establishes the connection and retrieves the tools.
   * In interactive mode, if the SDK falls back to browser authorization because of missing valid credentials (provider.authRedirected),
   * it waits for the loopback callback, exchanges the authorization code for a token, and retries once.
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
      // Non-OAuth mode: resolve auth headers from the credential store and inject them into the client factory (passed through the http transport)
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
    const timer = setTimeout(() => reject(new Error('Connection timed out')), timeoutMs)
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
