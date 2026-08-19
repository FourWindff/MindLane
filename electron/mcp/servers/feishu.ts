import type { McpServerDefinition } from '../types.js'
import { refreshFeishuUat } from '../feishuUat.js'

/** 飞书开发者远程模式默认端点（实测存活，见 ADR-0019）。 */
export const FEISHU_DEFAULT_ENDPOINT = 'https://mcp.feishu.cn/mcp'

/** 用 `X-Lark-MCP-Allowed-Tools` 头把服务端工具面收敛到文档搜索/读取/wiki 检索。
 * 名称必须与飞书开发者远程模式官方工具集一致——tools/list 按此名单过滤，
 * 写错名称会导致 0 工具（实测踩坑：曾用 doc_search 等臆造名，全部被过滤）。 */
export const FEISHU_ALLOWED_TOOLS = 'search-doc,fetch-doc,list-docs'

/**
 * 客户端侧 allowlist 双保险：注册前剔除创建/更新/评论等写操作与通用工具。
 * 名称与飞书官方工具集保持一致；平台工具面演进时在此追加/调整。
 */
export const FEISHU_EXCLUDE_TOOLS = [
  'search-user',
  'get-user',
  'fetch-file',
  'create-doc',
  'update-doc',
  'get-comments',
  'add-comments',
]

/** 用 app 凭证现换 tenant access token 的抽象；生产走真实 API，测试注入 mock。 */
export type FeishuTokenExchanger = (appId: string, appSecret: string) => Promise<string>

/** 生产实现：调用飞书开放平台 internal 接口换取应用身份 token。 */
async function exchangeTenantToken(appId: string, appSecret: string): Promise<string> {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  const data = (await res.json()) as { code?: number; msg?: string; tenant_access_token?: string }
  if (!res.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`获取应用身份 token 失败：${data.code ?? res.status} ${data.msg ?? ''}`)
  }
  return data.tenant_access_token
}

/** 用 refresh_token 换新 UAT 的抽象；生产走真实接口，测试注入 mock */
export type FeishuUatRefresher = (
  appId: string,
  appSecret: string,
  refreshToken: string,
) => Promise<{ uat: string; refreshToken: string; expiresIn: number }>

/**
 * 飞书（开发者远程模式，自定义头认证）。
 * 有 UAT 时以用户身份（X-Lark-MCP-UAT）读搜个人文档；缺省用 app 凭证现换
 * tenant token 发 X-Lark-MCP-TAT（应用身份退化）。两个分支都附
 * X-Lark-MCP-Allowed-Tools 头收敛工具面，客户端 allowlist 再兜底裁剪。
 * UAT 过期（凭据存储里带 refreshToken 时）自动用 refresh_token 续期并回写新值。
 * 详见 docs/adr/0018.md、docs/adr/0019.md。
 */
export function createFeishuServer(
  opts: { exchangeTenantToken?: FeishuTokenExchanger; refreshUat?: FeishuUatRefresher } = {},
): McpServerDefinition {
  const exchange = opts.exchangeTenantToken ?? exchangeTenantToken
  const refreshUat = opts.refreshUat ?? refreshFeishuUat
  return {
    id: 'feishu',
    displayName: '飞书',
    description:
      '连接后 AI 可以搜索、读取你的飞书云文档并检索 wiki（需在飞书开放平台配置应用与用户 UAT）。',
    transport: 'http',
    connection: { url: FEISHU_DEFAULT_ENDPOINT },
    credentialFields: [
      { id: 'appId', label: 'App ID', required: true },
      { id: 'appSecret', label: 'App Secret', required: true, secret: true },
      { id: 'uat', label: 'User Access Token（可选）', secret: true },
    ],
    excludeTools: FEISHU_EXCLUDE_TOOLS,
    createAuthHeaders: async (store) => {
      const allowed = { 'X-Lark-MCP-Allowed-Tools': FEISHU_ALLOWED_TOOLS }
      const secrets = store.load().secrets ?? {}
      if (secrets.refreshToken?.trim()) {
        // 用户身份 + 自动续期：过期则用 refresh_token 换新并回写存储
        let uat = secrets.uat?.trim() ?? ''
        let refreshToken = secrets.refreshToken.trim()
        const expiresAt = Number(secrets.uatExpiresAt ?? 0)
        if (!uat || Date.now() >= expiresAt) {
          const fresh = await refreshUat(secrets.appId ?? '', secrets.appSecret ?? '', refreshToken)
          if (!fresh.uat) {
            throw new Error('刷新 user_access_token 返回空 token，请重新授权')
          }
          uat = fresh.uat
          refreshToken = fresh.refreshToken || refreshToken
          store.saveSecrets({
            uat,
            refreshToken,
            uatExpiresAt: String(Date.now() + fresh.expiresIn * 1000),
          })
        }
        return { 'X-Lark-MCP-UAT': uat, ...allowed }
      }
      if (secrets.uat?.trim()) {
        // 手动粘贴的 UAT（无 refresh_token）：不刷新，过期后按 failureHint 重新获取
        return { 'X-Lark-MCP-UAT': secrets.uat.trim(), ...allowed }
      }
      const tat = await exchange(secrets.appId ?? '', secrets.appSecret ?? '')
      return { 'X-Lark-MCP-TAT': tat, ...allowed }
    },
    failureHint:
      '若使用用户身份，请重新获取并粘贴新的 UAT；若使用应用身份，请检查 App ID 与 App Secret 是否正确。',
  }
}

/** catalog 默认实例。 */
export const feishuServer = createFeishuServer()
