import { MultiServerMCPClient, loadMcpTools } from '@langchain/mcp-adapters'
import type { Connection } from '@langchain/mcp-adapters'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Agent } from 'undici'
import type { LoopbackOAuthProvider } from './oauth.js'
import type { McpClientLike, McpServerDefinition } from './types.js'

/**
 * Production client factory: builds a MultiServerMCPClient from a catalog definition.
 * automaticSSEFallback is off - avoids the SSE fallback on a 401 triggering a second browser authorization.
 * Local loopback https endpoints (e.g. the Obsidian Local REST API encrypted port 27124) use self-signed certificates,
 * so they go through a bare SDK client with relaxed TLS verification scoped to that transport only, without a global downgrade.
 */
export const createMcpClient = (
  serverDef: McpServerDefinition,
  authProvider?: LoopbackOAuthProvider,
  headers?: Record<string, string>,
): McpClientLike => {
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
  authProvider: LoopbackOAuthProvider | undefined,
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
