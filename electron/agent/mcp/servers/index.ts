import type { McpServerDefinition } from '../types.js'
import { notionServer } from './notion.js'
import { feishuServer } from './feishu.js'

/** Built-in MCP catalog: adding a server = adding one definition here */
export const MCP_SERVERS: McpServerDefinition[] = [
  notionServer,
  /**
   * MCP built into the Obsidian Local REST API plugin (streamable HTTP).
   * The endpoint is the local encrypted loopback port 27124 (HTTPS, plugin self-signed certificate, the client factory relaxes TLS verification for loopback https),
   * the API key authenticates via `Authorization: Bearer`;
   * destructive/side-effect tools are removed before registration (vault_delete / command_execute / open_file).
   * See docs/adr/0018-mcp-non-oauth-header-auth.md.
   */
  {
    id: 'obsidian',
    displayName: 'Obsidian',
    description:
      'Once connected, the AI can read, write and search your Obsidian vault (requires the Local REST API plugin enabled in the local Obsidian).',
    transport: 'http',
    connection: { url: 'https://127.0.0.1:27124/mcp/' },
    credentialFields: [{ id: 'apiKey', label: 'API Key', required: true, secret: true }],
    excludeTools: ['vault_delete', 'command_execute', 'open_file'],
    createAuthHeaders: async (store) => ({
      Authorization: `Bearer ${store.load().secrets?.apiKey ?? ''}`,
    }),
    failureHint:
      'Open Obsidian and enable the Local REST API plugin (Settings -> Community plugins -> Local REST API), then retry.',
  },
  feishuServer,
]
