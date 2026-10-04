import { describe, expect, it, vi } from 'vitest'
import { acquireFeishuUat } from '../feishuUat.js'

describe('acquireFeishuUat', () => {
  it('opens the authorization page -> loopback callback delivers the state code -> exchanges app credentials for a UAT', async () => {
    let capturedUrl = ''
    let gotCode = ''
    const exchange = vi.fn(async (_appId: string, _secret: string, code: string) => {
      gotCode = code
      return { uat: 'u-fake-user-token', refreshToken: 'ur-fake', expiresIn: 7200 }
    })

    const acquiring = acquireFeishuUat({
      appId: 'cli_a5ca35a685b0x26e',
      appSecret: 'secret',
      port: 0,
      openBrowser: (url) => {
        capturedUrl = url
        // Simulate the user finishing authorization in the browser and returning to the callback URL: the callback URL comes from the authorize redirect_uri
        const u = new URL(url)
        const cb = new URL(u.searchParams.get('redirect_uri')!)
        cb.searchParams.set('code', 'real-code')
        cb.searchParams.set('state', u.searchParams.get('state')!)
        void fetch(cb.toString())
      },
      exchange,
      timeoutMs: 10_000,
    })

    const result = await acquiring
    expect(exchange).toHaveBeenCalledOnce()
    expect(gotCode).toBe('real-code')
    expect(result.uat).toBe('u-fake-user-token')

    // The authorization link carries app_id / redirect_uri / state
    const u = new URL(capturedUrl)
    expect(u.pathname).toBe('/open-apis/authen/v1/index')
    expect(u.searchParams.get('app_id')).toBe('cli_a5ca35a685b0x26e')
    expect(u.searchParams.get('redirect_uri')).toMatch(/\/callback$/)
    expect(u.searchParams.get('state')).toBeTruthy()
  })

  it('rejects when the callback carries an error, without calling the token exchange', async () => {
    const exchange = vi.fn()
    const acquiring = acquireFeishuUat({
      appId: 'a',
      appSecret: 's',
      port: 0,
      openBrowser: (url) => {
        const u = new URL(url)
        const cb = new URL(u.searchParams.get('redirect_uri')!)
        cb.searchParams.set('error', 'access_denied')
        cb.searchParams.set('state', u.searchParams.get('state')!)
        void fetch(cb.toString())
      },
      exchange,
      timeoutMs: 10_000,
    })

    await expect(acquiring).rejects.toThrow(/Authorization failed/)
    expect(exchange).not.toHaveBeenCalled()
  })

  it('rejects with the failure reason when the token exchange fails', async () => {
    const exchange = vi.fn(async () => {
      throw new Error('code expired or invalid')
    })
    const acquiring = acquireFeishuUat({
      appId: 'a',
      appSecret: 's',
      port: 0,
      openBrowser: (url) => {
        const u = new URL(url)
        const cb = new URL(u.searchParams.get('redirect_uri')!)
        cb.searchParams.set('code', 'expired')
        cb.searchParams.set('state', u.searchParams.get('state')!)
        void fetch(cb.toString())
      },
      exchange,
      timeoutMs: 10_000,
    })

    await expect(acquiring).rejects.toThrow(/code expired or invalid/)
  })
})
