import { MultiServerMCPClient, loadMcpTools } from '@langchain/mcp-adapters'
import type { Connection } from '@langchain/mcp-adapters'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Agent } from 'undici'
import type { McpClientFactory, McpClientLike } from './types.js'

/**
 * 生产环境的 client 工厂：按 catalog 定义构建 MultiServerMCPClient。
 * automaticSSEFallback 关闭——避免 401 时 SSE 回退触发第二次浏览器授权。
 * 本机回环 https 端点（如 Obsidian Local REST API 加密端口 27124）用自签证书，
 * 走裸 SDK client + 仅限该 transport 的放宽 TLS 校验，不做全局降级。
 */
export const createMcpClient: McpClientFactory = (serverDef, authProvider, headers) => {
  const url = serverDef.connection.url
  if (serverDef.transport === 'http' && url && isLoopbackHttps(url)) {
    return createLoopbackHttpsClient(serverDef.id, url, authProvider, headers)
  }
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
          ...(headers ? { headers } : {}),
          automaticSSEFallback: false,
        }

  return new MultiServerMCPClient({
    mcpServers: { [serverDef.id]: connection },
  })
}

function isLoopbackHttps(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const host = parsed.hostname
  return (
    parsed.protocol === 'https:' &&
    (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]')
  )
}

function createLoopbackHttpsClient(
  serverId: string,
  url: string,
  authProvider: Parameters<McpClientFactory>[1],
  headers?: Record<string, string>,
): McpClientLike {
  const client = new Client({ name: 'mindlane-mcp', version: '1.0.0' }, { capabilities: {} })
  let connected = false
  return {
    async getTools() {
      if (!connected) {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(url), {
            ...(authProvider ? { authProvider } : {}),
            // requestInit is SDK-accepted RequestInit; `dispatcher` is a Node/undici
            // extension that doesn't exist on the DOM type.
            requestInit: {
              ...(headers ? { headers } : {}),
              // Trust the loopback server's self-signed cert for this transport only.
              // ponytail: per-endpoint agent; move to explicit CA pinning if 27124 is ever non-local.
              dispatcher: new Agent({ connect: { rejectUnauthorized: false } }),
            } as RequestInit,
          }),
        )
        connected = true
      }
      return loadMcpTools(serverId, client)
    },
    async close() {
      await client.close()
    },
  }
}
