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
 * OAuth 2.0 authorization code + PKCE provider based on a loopback callback.
 *
 * Used together with the MCP SDK's auth(): the SDK handles DCR, PKCE generation, token exchange and refresh,
 * while this class handles credential persistence (credentialStore), opening the browser (openBrowser) and state generation.
 *
 * When interactive=false (silent reconnect at startup) redirectToAuthorization only sets a flag instead of opening the browser,
 * so the caller can tell that the user must re-authorize and fall back to failure.
 */
export class LoopbackOAuthProvider implements OAuthClientProvider {
  /** Whether the SDK has reached the step that needs browser authorization (used to tell "invalid credentials" apart from other connection errors) */
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

  /** Most recently generated state, used to verify the loopback callback */
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
  /** Of the form http://127.0.0.1:<port>/callback */
  redirectUrl: string
  /** Waits for the browser callback, verifies state, then resolves the authorization code; rejects on timeout or error */
  waitForCallback: (expectedState: string | undefined, timeoutMs: number) => Promise<string>
  close: () => void
}

/**
 * Starts a temporary HTTP server on 127.0.0.1 to receive the OAuth callback (RFC 8252 loopback).
 * The callback may arrive before waitForCallback is called, so the result is buffered first.
 * When port is omitted a random one is chosen; a fixed port is used for flows that must pre-register the callback URL (e.g. Feishu UAT).
 */
export async function startLoopbackCallbackServer(opts?: {
  port?: number
}): Promise<LoopbackCallbackServer> {
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
          ? '<p>Authorization failed. You can close this page and retry in MindLane.</p>'
          : '<p>Authorization complete. You can close this page and return to MindLane.</p>') +
        '</body></html>',
    )
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts?.port ?? 0, '127.0.0.1', () => resolve())
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
          reject(new Error('Timed out waiting for the authorization callback'))
        }, timeoutMs)
        const check = () => {
          if (!received) return false
          clearTimeout(timer)
          if (received.error) reject(new Error(`Authorization failed: ${received.error}`))
          else if (!received.code) reject(new Error('Authorization callback is missing the code'))
          else if (expectedState && received.state !== expectedState) {
            reject(new Error('Authorization state verification failed'))
          } else resolve(received.code)
          return true
        }
        notify = () => {
          check()
        }
        if (check()) return
        // Stop waiting once the server closes
        server.once('close', () => {
          clearTimeout(timer)
          if (!received) reject(new Error('Authorization callback server was closed'))
        })
      }),
  }
}
