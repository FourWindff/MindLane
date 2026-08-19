import type { McpServerDefinition } from '../types.js'

/**
 * Obsidian Local REST API 插件内建 MCP（streamable HTTP）。
 * 端点为本机 27124 加密回环端口（HTTPS，插件自签证书，client 工厂对回环 https 放行 TLS 校验），
 * API key 经 `Authorization: Bearer` 认证；
 * 注册前剔除破坏性/副作用工具（vault_delete / command_execute / open_file）。
 * 详见 docs/adr/0018-mcp-non-oauth-header-auth.md。
 */
export const obsidianServer: McpServerDefinition = {
  id: 'obsidian',
  displayName: 'Obsidian',
  description:
    '连接后 AI 可以读写和搜索你的 Obsidian 笔记库（需本机 Obsidian 启用 Local REST API 插件）。',
  transport: 'http',
  connection: { url: 'https://127.0.0.1:27124/mcp/' },
  credentialFields: [{ id: 'apiKey', label: 'API Key', required: true, secret: true }],
  excludeTools: ['vault_delete', 'command_execute', 'open_file'],
  createAuthHeaders: async (store) => ({
    Authorization: `Bearer ${store.load().secrets?.apiKey ?? ''}`,
  }),
  failureHint:
    '请打开 Obsidian 并启用 Local REST API 插件（设置 → 第三方插件 → Local REST API），然后重试。',
}
