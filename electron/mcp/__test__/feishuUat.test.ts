import { describe, expect, it, vi } from 'vitest'
import { acquireFeishuUat } from '../feishuUat.js'

describe('acquireFeishuUat', () => {
  it('拉起授权页 → loopback 回调携带 state 的 code → 用 app 凭证换出 UAT', async () => {
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
        // 模拟用户在浏览器完成授权后跳回回调地址：回调地址取自 authorize 的 redirect_uri
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

    // 授权链接带 app_id / redirect_uri / state
    const u = new URL(capturedUrl)
    expect(u.pathname).toBe('/open-apis/authen/v1/index')
    expect(u.searchParams.get('app_id')).toBe('cli_a5ca35a685b0x26e')
    expect(u.searchParams.get('redirect_uri')).toMatch(/\/callback$/)
    expect(u.searchParams.get('state')).toBeTruthy()
  })

  it('callback 带 error 时 reject，不调用 token 交换', async () => {
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

    await expect(acquiring).rejects.toThrow(/授权失败/)
    expect(exchange).not.toHaveBeenCalled()
  })

  it('token 交换失败时 reject 并包含失败原因', async () => {
    const exchange = vi.fn(async () => {
      throw new Error('code 已过期或无效')
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

    await expect(acquiring).rejects.toThrow(/code 已过期或无效/)
  })
})
