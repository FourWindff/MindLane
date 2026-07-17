import { MultiServerMCPClient } from '@langchain/mcp-adapters'
import type { Connection } from '@langchain/mcp-adapters'
import type { McpClientFactory } from './types.js'

/**
 * 生产环境的 client 工厂：按 catalog 定义构建 MultiServerMCPClient。
 * automaticSSEFallback 关闭——避免 401 时 SSE 回退触发第二次浏览器授权。
 */
export const createMcpClient: McpClientFactory = (serverDef, authProvider) => {
  const connection: Connection =
    serverDef.transport === 'stdio'
      ? {
          transport: 'stdio' as const,
          command: serverDef.connection.command ?? '',
          args: serverDef.connection.args ?? [],
          ...(serverDef.connection.env ? { env: serverDef.connection.env } : {}),
        }
      : {
          type: serverDef.transport,
          url: serverDef.connection.url ?? '',
          ...(authProvider ? { authProvider } : {}),
          automaticSSEFallback: false,
        }

  return new MultiServerMCPClient({
    mcpServers: { [serverDef.id]: connection },
  })
}
