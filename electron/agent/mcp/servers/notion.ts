import type { McpServerDefinition } from '../types.js'
import { LoopbackOAuthProvider } from '../oauth.js'

/**
 * Notion's official hosted MCP (streamable HTTP + OAuth 2.0/PKCE, supports DCR).
 * See docs/adr/0003-notion-hosted-mcp-oauth.md.
 */
export const notionServer: McpServerDefinition = {
  id: 'notion',
  displayName: 'Notion',
  description: 'Once connected, the AI can search and read your Notion content.',
  transport: 'http',
  connection: { url: 'https://mcp.notion.com/mcp' },
  createAuthProvider: (ctx) =>
    new LoopbackOAuthProvider({
      clientName: 'MindLane',
      credentialStore: ctx.credentialStore,
      redirectUrl: ctx.redirectUrl,
      interactive: ctx.interactive,
      openBrowser: ctx.openBrowser,
    }),
  // Get the workspace name through the server's own get-self tool (OAuthTokens does not keep workspace_name from the token response)
  fetchWorkspaceName: async (tools) => {
    const selfTool = tools.find((t) => /(^|__)((API|notion)[-_])?get-self$/i.test(t.name))
    if (!selfTool) return undefined
    const result = await selfTool.invoke({})
    const text = typeof result === 'string' ? result : JSON.stringify(result)
    try {
      const parsed = JSON.parse(text) as { bot?: { workspace_name?: string } }
      if (parsed.bot?.workspace_name) return parsed.bot.workspace_name
    } catch {
      /* fall through to regex */
    }
    return /"workspace_name"\s*:\s*"([^"]+)"/.exec(text)?.[1]
  },
}
