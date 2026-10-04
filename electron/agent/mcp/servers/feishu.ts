import type { McpServerDefinition } from '../types.js'
import { refreshFeishuUat } from '../feishuUat.js'

/** Default endpoint for the Feishu developer remote mode (verified live, see ADR-0019). */
const FEISHU_DEFAULT_ENDPOINT = 'https://mcp.feishu.cn/mcp'

/** Uses the `X-Lark-MCP-Allowed-Tools` header to narrow the server tool surface to document search/read/wiki lookup.
 * The names must match the official Feishu developer remote mode tool set - tools/list filters by this list,
 * wrong names yield 0 tools (bitten before: invented names like doc_search were all filtered out). */
export const FEISHU_ALLOWED_TOOLS = 'search-doc,fetch-doc,list-docs'

/**
 * Client-side allowlist as a second guard: removes write operations (create/update/comment) and generic tools before registration.
 * Names stay in sync with the official Feishu tool set; add/adjust here as the platform tool surface evolves.
 */
const FEISHU_EXCLUDE_TOOLS = [
  'search-user',
  'get-user',
  'fetch-file',
  'create-doc',
  'update-doc',
  'get-comments',
  'add-comments',
]

/** Abstraction for exchanging app credentials for a tenant access token on the fly; production hits the real API, tests inject a mock. */
type FeishuTokenExchanger = (appId: string, appSecret: string) => Promise<string>

/** Production implementation: calls the Feishu Open Platform internal endpoint to exchange for an app identity token. */
async function exchangeTenantToken(appId: string, appSecret: string): Promise<string> {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  const data = (await res.json()) as { code?: number; msg?: string; tenant_access_token?: string }
  if (!res.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(
      `Failed to get app identity token: ${data.code ?? res.status} ${data.msg ?? ''}`,
    )
  }
  return data.tenant_access_token
}

/** Abstraction for exchanging a refresh_token for a new UAT; production hits the real endpoint, tests inject a mock */
type FeishuUatRefresher = (
  appId: string,
  appSecret: string,
  refreshToken: string,
) => Promise<{ uat: string; refreshToken: string; expiresIn: number }>

/**
 * Feishu (developer remote mode, custom header auth).
 * With a UAT it reads and searches personal documents as the user (X-Lark-MCP-UAT); otherwise it exchanges
 * app credentials for a tenant token on the fly and sends X-Lark-MCP-TAT (app identity fallback). Both branches attach
 * the X-Lark-MCP-Allowed-Tools header to narrow the tool surface, with the client allowlist as a final trim.
 * An expired UAT (when the credential store holds a refreshToken) is renewed automatically via refresh_token and the new value written back.
 * See docs/adr/0018.md and docs/adr/0019.md.
 */
export function createFeishuServer(
  opts: { exchangeTenantToken?: FeishuTokenExchanger; refreshUat?: FeishuUatRefresher } = {},
): McpServerDefinition {
  const exchange = opts.exchangeTenantToken ?? exchangeTenantToken
  const refreshUat = opts.refreshUat ?? refreshFeishuUat
  return {
    id: 'feishu',
    displayName: 'Feishu',
    description:
      'Once connected, the AI can search and read your Feishu cloud documents and look up the wiki (requires an app and a user UAT configured in the Feishu Open Platform).',
    transport: 'http',
    connection: { url: FEISHU_DEFAULT_ENDPOINT },
    credentialFields: [
      { id: 'appId', label: 'App ID', required: true },
      { id: 'appSecret', label: 'App Secret', required: true, secret: true },
      { id: 'uat', label: 'User Access Token (optional)', secret: true },
    ],
    excludeTools: FEISHU_EXCLUDE_TOOLS,
    createAuthHeaders: async (store) => {
      const allowed = { 'X-Lark-MCP-Allowed-Tools': FEISHU_ALLOWED_TOOLS }
      const secrets = store.load().secrets ?? {}
      if (secrets.refreshToken?.trim()) {
        // User identity + auto renewal: when expired, exchange the refresh_token for a new one and write it back to the store
        let uat = secrets.uat?.trim() ?? ''
        let refreshToken = secrets.refreshToken.trim()
        const expiresAt = Number(secrets.uatExpiresAt ?? 0)
        if (!uat || Date.now() >= expiresAt) {
          const fresh = await refreshUat(secrets.appId ?? '', secrets.appSecret ?? '', refreshToken)
          if (!fresh.uat) {
            throw new Error(
              'Refreshing user_access_token returned an empty token, please re-authorize',
            )
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
        // Manually pasted UAT (no refresh_token): no refresh, re-acquire per failureHint once expired
        return { 'X-Lark-MCP-UAT': secrets.uat.trim(), ...allowed }
      }
      const tat = await exchange(secrets.appId ?? '', secrets.appSecret ?? '')
      return { 'X-Lark-MCP-TAT': tat, ...allowed }
    },
    failureHint:
      'If you use the user identity, fetch and paste a new UAT again; if you use the app identity, check that the App ID and App Secret are correct.',
  }
}

/** Default catalog instance. */
export const feishuServer = createFeishuServer()
