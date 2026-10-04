import crypto from 'node:crypto'
import { startLoopbackCallbackServer } from './oauth.js'

/** Fixed port for the Feishu UAT authorization callback - the callback URL `http://127.0.0.1:44664/callback`
 *  must be registered once in the Feishu Open Platform console (Security Settings -> Redirect URL), after which every run uses the same address. */
const FEISHU_UAT_CALLBACK_PORT = 44664

/** User identity credential (UAT) obtained after successful authorization, filled back into the connection form by the settings panel */
interface FeishuUatResult {
  uat: string
  refreshToken: string
  expiresIn: number
}

/** Parses a Feishu token endpoint response: throws an error carrying the raw info when code!==0 or the body is not JSON */
async function readFeishuTokenBody(
  res: Response,
  what: string,
): Promise<{ access_token?: string; refresh_token?: string; expires_in?: number }> {
  let body: {
    code?: number
    msg?: string
    data?: { access_token?: string; refresh_token?: string; expires_in?: number }
  }
  try {
    body = (await res.json()) as typeof body
  } catch {
    const raw = await res.text().catch(() => '')
    throw new Error(`${what} response error: ${res.status} ${raw.slice(0, 200)}`)
  }
  if (!res.ok || body.code !== 0 || !body.data?.access_token) {
    throw new Error(`${what} failed: ${body.code ?? res.status} ${body.msg ?? ''}`)
  }
  return body.data
}

/** Token exchanger abstraction; tests can inject a mock */
type FeishuUatExchanger = (
  appId: string,
  appSecret: string,
  code: string,
) => Promise<FeishuUatResult>

/** Production implementation: calls the Feishu Open Platform API to exchange an authorization code for a user identity token
 *  Note: the docs announce v3 (user_access_token/internal, with client_id/client_secret in the body),
 *  but v3 returns 404 in live testing; the current v1/access_token body fields are app_id/app_secret (
 *  using client_id reports 20025 missing app id or app secret). When the platform switches to v3, only this spot needs changing. */
export async function exchangeFeishuUat(
  appId: string,
  appSecret: string,
  code: string,
): Promise<FeishuUatResult> {
  const res = await fetch('https://open.feishu.cn/open-apis/authen/v1/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      app_id: appId,
      app_secret: appSecret,
    }),
    // fetch has no default timeout, so 20s is the backstop - better a failure message than a stuck "fetching" state
    signal: AbortSignal.timeout(20_000),
  })
  const data = await readFeishuTokenBody(res, 'exchanging authorization code for user_access_token')
  // Only returns non-sensitive display info such as the uat; the refresh_token stays on the app side and is not persisted.
  return {
    uat: data.access_token ?? '',
    refreshToken: data.refresh_token ?? '',
    expiresIn: data.expires_in ?? 7200,
  }
}

/** Exchanges a refresh_token for a new UAT (renewable repeatedly within about 30 days); returns the new uat and a new refresh_token */
export async function refreshFeishuUat(
  appId: string,
  appSecret: string,
  refreshToken: string,
): Promise<FeishuUatResult> {
  const res = await fetch('https://open.feishu.cn/open-apis/authen/v1/refresh_access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      app_id: appId,
      app_secret: appSecret,
    }),
    // fetch has no default timeout, so 20s is the backstop - a failure message beats a stuck connection
    signal: AbortSignal.timeout(20_000),
  })
  const data = await readFeishuTokenBody(res, 'refreshing user_access_token')
  return {
    uat: data.access_token ?? '',
    refreshToken: data.refresh_token ?? '',
    expiresIn: data.expires_in ?? 7200,
  }
}

/**
 * One-click Feishu UAT acquisition: open the authorization page -> the user signs in and authorizes in the browser -> the loopback callback receives the code ->
 * exchange it for a user_access_token using the app credentials.
 * openBrowser is called before the authorization page opens; it rejects on timeout or if the user declines.
 */
export async function acquireFeishuUat(opts: {
  appId: string
  appSecret: string
  openBrowser: (url: string) => void
  timeoutMs?: number
  // Tests can pass 0 for a random port to avoid fixed-port conflicts; production defaults to the preset port
  port?: number
  exchange?: FeishuUatExchanger
}): Promise<FeishuUatResult> {
  const { appId, appSecret, openBrowser, timeoutMs = 5 * 60_000 } = opts
  const exchange = opts.exchange ?? exchangeFeishuUat
  const loopback = await startLoopbackCallbackServer({
    port: opts.port ?? FEISHU_UAT_CALLBACK_PORT,
  })
  try {
    const state = crypto.randomUUID()
    const authorizeUrl = new URL('https://open.feishu.cn/open-apis/authen/v1/index')
    authorizeUrl.searchParams.set('redirect_uri', loopback.redirectUrl)
    authorizeUrl.searchParams.set('app_id', appId)
    authorizeUrl.searchParams.set('state', state)
    openBrowser(authorizeUrl.toString())
    const code = await loopback.waitForCallback(state, timeoutMs)
    return await exchange(appId, appSecret, code)
  } finally {
    loopback.close()
  }
}
