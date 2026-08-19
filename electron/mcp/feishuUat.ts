import crypto from 'node:crypto'
import { startLoopbackCallbackServer } from './oauth.js'

/** 飞书 UAT 授权回调的固定端口——回调地址 `http://127.0.0.1:44664/callback`
 *  需在飞书开放平台后台（安全设置 → 重定向 URL）一次性登记，之后每次走同一地址。 */
export const FEISHU_UAT_CALLBACK_PORT = 44664

/** 授权成功拿到的用户身份凭证（UAT），供设置面板回填进连接表单 */
export interface FeishuUatResult {
  uat: string
  refreshToken: string
  expiresIn: number
}

/** token 交换器抽象，测试可注入 mock */
export type FeishuUatExchanger = (
  appId: string,
  appSecret: string,
  code: string,
) => Promise<FeishuUatResult>

/** 生产实现：调用飞书开放平台接口，用授权码换用户身份 token
 *  注意：文档预告 v3（user_access_token/internal），但线上实测 v3 返回 404，
 *  现行可用的是 v1/access_token；平台切换 v3 时只需改这里。 */
export async function exchangeFeishuUat(
  appId: string,
  appSecret: string,
  code: string,
): Promise<FeishuUatResult> {
  const res = await fetch(
    'https://open.feishu.cn/open-apis/authen/v1/access_token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: appId, client_secret: appSecret }),
      // 默认 fetch 无超时，这里 20s 兜底——宁可失败提示也不要“获取中”卡死
      signal: AbortSignal.timeout(20_000),
    },
  )
  let data: {
    code?: number
    msg?: string
    data?: { access_token?: string; refresh_token?: string; expires_in?: number }
  }
  try {
    data = (await res.json()) as typeof data
  } catch {
    // 非 JSON 响应（如网关 404 页面）时把原始内容带进错误，便于定位
    const raw = await res.text().catch(() => '')
    throw new Error(`授权码换取 user_access_token 响应异常：${res.status} ${raw.slice(0, 200)}`)
  }
  if (!res.ok || data.code !== 0 || !data.data?.access_token) {
    throw new Error(`授权码换取 user_access_token 失败：${data.code ?? res.status} ${data.msg ?? ''}`)
  }
  const uat = data.data.access_token
  // 仅返回 uat 等非敏感展示信息；refresh_token 由 app 侧持有，不落盘。
  return {
    uat,
    refreshToken: data.data.refresh_token ?? '',
    expiresIn: data.data.expires_in ?? 7200,
  }
}

/**
 * 一键获取飞书 UAT：拉起授权页 → 用户在浏览器登录授权 → loopback 回调拿 code →
 * 用 app 凭证换 user_access_token。
 * openBrowser 会在授权页拉起前被调用；超时或用户拒绝则 reject。
 */
export async function acquireFeishuUat(opts: {
  appId: string
  appSecret: string
  openBrowser: (url: string) => void
  timeoutMs?: number
  // 测试可传 0 用随机端口，避免固定端口冲突；生产默认预设端口
  port?: number
  exchange?: FeishuUatExchanger
}): Promise<FeishuUatResult> {
  const { appId, appSecret, openBrowser, timeoutMs = 5 * 60_000 } = opts
  const exchange = opts.exchange ?? exchangeFeishuUat
  const loopback = await startLoopbackCallbackServer({ port: opts.port ?? FEISHU_UAT_CALLBACK_PORT })
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
