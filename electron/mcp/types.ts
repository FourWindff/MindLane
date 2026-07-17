import type { StructuredToolInterface } from '@langchain/core/tools'
import type { McpCredentialStore } from './credentials.js'
import type { LoopbackOAuthProvider } from './oauth.js'

/** MCP server 的连接状态（MCP 用户态，持久化到 settings.json） */
export type McpConnectionState = 'disconnected' | 'connecting' | 'connected' | 'failed'

/** settings.json 中每个 server 的用户态条目：只有连接状态与非敏感展示信息 */
export interface McpServerUserState {
  state: McpConnectionState
  workspaceName?: string
}

/** 单个 server 的运行时状态（含错误信息，供 UI 展示） */
export interface McpServerStatus {
  state: McpConnectionState
  workspaceName?: string
  error?: string
}

/** 合并 catalog 元数据后的完整状态，供 mcp:status 返回给渲染层 */
export interface McpServerStatusInfo extends McpServerStatus {
  id: string
  displayName: string
  icon: string
  description: string
}

/** 传给 server 授权工厂的上下文 */
export interface McpAuthContext {
  credentialStore: McpCredentialStore
  /** loopback 回调地址（交互式授权时由临时 HTTP 服务决定端口） */
  redirectUrl: string
  /** 是否允许打开浏览器（启动时的静默重连为 false） */
  interactive: boolean
  openBrowser: (url: string) => void
}

/** MCP catalog 条目：新增 server = 在 servers/ 下新增一个定义 */
export interface McpServerDefinition {
  id: string
  displayName: string
  /** lucide 图标名 */
  icon: string
  /** 设置面板中展示的一句话说明 */
  description: string
  transport: 'stdio' | 'http' | 'sse'
  connection: {
    url?: string
    command?: string
    args?: string[]
    env?: Record<string, string>
  }
  /** 授权工厂（如 OAuth）；无认证的 server 省略 */
  createAuthProvider?: (ctx: McpAuthContext) => LoopbackOAuthProvider
  /** 连接成功后从 server 工具集中拉取展示信息（如 workspace 名）；失败应返回 undefined */
  fetchWorkspaceName?: (tools: StructuredToolInterface[]) => Promise<string | undefined>
}

/** McpManager 依赖的最小 client 接口（唯一测试接缝的返回类型） */
export interface McpClientLike {
  getTools(): Promise<StructuredToolInterface[]>
  close(): Promise<void>
}

export type McpClientFactory = (
  serverDef: McpServerDefinition,
  authProvider?: LoopbackOAuthProvider,
) => McpClientLike
