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

/** 非 OAuth server 连接表单的字段元数据；渲染层据此画表单，主进程按定义校验 */
export interface McpCredentialField {
  /** 表单字段 id（同时是凭据存储 secrets 中的键） */
  id: string
  /** 表单中的展示标签 */
  label: string
  /** 必填字段；缺失时连接直接失败，不发起请求 */
  required?: boolean
  /** 敏感字段：渲染为密码输入框，明文只经凭据存储加密落盘 */
  secret?: boolean
}

/** 合并 catalog 元数据后的完整状态，供 mcp:status 返回给渲染层 */
export interface McpServerStatusInfo extends McpServerStatus {
  id: string
  displayName: string
  description: string
  /** 非 OAuth server 的连接表单字段元数据（OAuth server 省略） */
  credentialFields?: McpCredentialField[]
  /** 失败指引文案（如“打开 Obsidian 并启用 Local REST API 插件”） */
  failureHint?: string
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
  /** 设置面板中展示的一句话说明 */
  description: string
  transport: 'stdio' | 'http' | 'sse'
  connection: {
    url?: string
    command?: string
    args?: string[]
    env?: Record<string, string>
  }
  /**
   * OAuth 模式授权工厂；与 createAuthHeaders 互斥，定义内二选一。
   * 设置面板对这种 server 走浏览器授权交互。
   */
  createAuthProvider?: (ctx: McpAuthContext) => LoopbackOAuthProvider
  /**
   * 非 OAuth 模式：从凭据存储解析要注入 HTTP 请求头的键值对（如 Authorization: Bearer）；
   * 与 createAuthProvider 互斥。设置面板对这种 server 走凭据表单交互。
   */
  createAuthHeaders?: (store: McpCredentialStore) => Promise<Record<string, string>>
  /** 连接表单字段元数据（非 OAuth server 声明；渲染层据元数据画表单） */
  credentialFields?: McpCredentialField[]
  /** 失败指引文案；连接失败时追加到错误信息 */
  failureHint?: string
  /** 注册进 ToolRegistry 之前剔除的工具名（如 Obsidian 的破坏性工具） */
  excludeTools?: string[]
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
  /** 非 OAuth 模式：createAuthHeaders 解析出的认证头，透传到 http transport */
  headers?: Record<string, string>,
) => McpClientLike
