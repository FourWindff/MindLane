import type { McpServerDefinition } from '../types.js'
import { LoopbackOAuthProvider } from '../oauth.js'

/**
 * Notion 官方托管 MCP（streamable HTTP + OAuth 2.0/PKCE，支持 DCR）。
 * 详见 docs/adr/0003-notion-hosted-mcp-oauth.md。
 */
export const notionServer: McpServerDefinition = {
  id: 'notion',
  displayName: 'Notion',
  description: '连接后 AI 可以搜索和读取你的 Notion 内容。',
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
  // 通过 server 自带的 get-self 工具取 workspace 名（OAuthTokens 不保留 token 响应里的 workspace_name）
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
