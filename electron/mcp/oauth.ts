import http from 'node:http'
import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { McpCredentialStore } from './credentials.js'

/**
 * 基于 loopback 回调的 OAuth 2.0 授权码 + PKCE provider。
 *
 * 配合 MCP SDK 的 auth() 使用：SDK 负责 DCR、PKCE 生成、token 交换与刷新，
 * 本类负责凭据持久化（credentialStore）、打开浏览器（openBrowser）与 state 生成。
 *
 * interactive=false 时（启动静默重连）redirectToAuthorization 只置标记不打开浏览器，
 * 由调用方据此判断需要用户重新授权并走失败降级。
 */
export class LoopbackOAuthProvider implements OAuthClientProvider {
  /** SDK 是否已走到需要浏览器授权的一步（据此区分"凭据失效"与其他连接错误） */
  authRedirected = false
  private currentState?: string
  private verifier = ''

  constructor(
    private readonly opts: {
      clientName: string
      credentialStore: McpCredentialStore
      redirectUrl: string
      interactive: boolean
      openBrowser: (url: string) => void
    },
  ) {}

  get redirectUrl(): string {
    return this.opts.redirectUrl
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.opts.clientName,
      redirect_uris: [this.opts.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  state(): string {
    this.currentState = crypto.randomUUID()
    return this.currentState
  }

  /** 最近一次生成的 state，用于校验 loopback 回调 */
  get expectedState(): string | undefined {
    return this.currentState
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.opts.credentialStore.load().clientInformation
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.opts.credentialStore.saveClientInformation(info)
  }

  tokens(): OAuthTokens | undefined {
    return this.opts.credentialStore.load().tokens
  }

  saveTokens(tokens: OAuthTokens): void {
    this.opts.credentialStore.saveTokens(tokens)
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authRedirected = true
    if (this.opts.interactive) this.opts.openBrowser(authorizationUrl.toString())
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier
  }

  codeVerifier(): string {
    return this.verifier
  }
}

export interface LoopbackCallbackServer {
  /** 形如 http://127.0.0.1:<port>/callback */
  redirectUrl: string
  /** 等待浏览器回调，校验 state 后 resolve 授权码；超时或出错则 reject */
  waitForCallback: (expectedState: string | undefined, timeoutMs: number) => Promise<string>
  close: () => void
}

/**
 * 在 127.0.0.1 上启动临时 HTTP 服务接收 OAuth 回调（RFC 8252 loopback）。
 * 回调可能在 waitForCallback 被调用前到达，因此先缓存结果。
 */
export async function startLoopbackCallbackServer(): Promise<LoopbackCallbackServer> {
  type CallbackResult = { code?: string; state?: string; error?: string }
  let received: CallbackResult | null = null
  let notify: (() => void) | null = null

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/callback') {
      res.writeHead(404).end()
      return
    }
    received = {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
      error: url.searchParams.get('error') ?? undefined,
    }
    notify?.()
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(
      '<html><body style="font-family:sans-serif;text-align:center;padding-top:4em">' +
        (received.error
          ? '<p>授权失败，可以关闭此页面并返回 MindLane 重试。</p>'
          : '<p>授权完成，可以关闭此页面并返回 MindLane。</p>') +
        '</body></html>',
    )
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as AddressInfo

  const close = () => {
    notify?.()
    server.close()
  }

  return {
    redirectUrl: `http://127.0.0.1:${port}/callback`,
    close,
    waitForCallback: (expectedState, timeoutMs) =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('等待授权回调超时'))
        }, timeoutMs)
        const check = () => {
          if (!received) return false
          clearTimeout(timer)
          if (received.error) reject(new Error(`授权失败: ${received.error}`))
          else if (!received.code) reject(new Error('授权回调缺少 code'))
          else if (expectedState && received.state !== expectedState) {
            reject(new Error('授权 state 校验失败'))
          } else resolve(received.code)
          return true
        }
        notify = () => {
          check()
        }
        if (check()) return
        // server 关闭时不再等待
        server.once('close', () => {
          clearTimeout(timer)
          if (!received) reject(new Error('授权回调服务已关闭'))
        })
      }),
  }
}
