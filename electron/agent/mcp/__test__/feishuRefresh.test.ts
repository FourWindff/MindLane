import { describe, expect, it, vi } from 'vitest'
import { createFeishuServer, FEISHU_ALLOWED_TOOLS } from '../servers/feishu.js'
import type { McpCredentialStore } from '../credentials.js'

function fakeStore(secrets: Record<string, string>) {
  const state = { secrets }
  return {
    load: () => ({ secrets: state.secrets }),
    saveSecrets: (patch: Record<string, string>) => {
      state.secrets = { ...state.secrets, ...patch }
    },
  } as unknown as McpCredentialStore
}

describe('feishu createAuthHeaders 自动续期', () => {
  it('UAT 过期且有 refresh_token → 自动刷新并回写新值', async () => {
    const refreshUat = vi.fn(async () => ({
      uat: 'u-new',
      refreshToken: 'ur-new',
      expiresIn: 7200,
    }))
    const def = createFeishuServer({ refreshUat })
    const store = fakeStore({
      appId: 'a',
      appSecret: 's',
      uat: 'u-expired',
      refreshToken: 'ur-old',
      uatExpiresAt: String(Date.now() - 1000),
    })

    const headers = await def.createAuthHeaders!(store)

    expect(refreshUat).toHaveBeenCalledWith('a', 's', 'ur-old')
    expect(headers['X-Lark-MCP-UAT']).toBe('u-new')
    expect(headers['X-Lark-MCP-Allowed-Tools']).toBe(FEISHU_ALLOWED_TOOLS)
    const saved = store.load().secrets!
    expect(saved.uat).toBe('u-new')
    expect(saved.refreshToken).toBe('ur-new')
    expect(Number(saved.uatExpiresAt)).toBeGreaterThan(Date.now())
  })

  it('UAT 未过期且有 refresh_token → 不刷新直接用', async () => {
    const refreshUat = vi.fn()
    const def = createFeishuServer({ refreshUat })
    const store = fakeStore({
      appId: 'a',
      appSecret: 's',
      uat: 'u-ok',
      refreshToken: 'ur',
      uatExpiresAt: String(Date.now() + 3_600_000),
    })

    const headers = await def.createAuthHeaders!(store)

    expect(refreshUat).not.toHaveBeenCalled()
    expect(headers['X-Lark-MCP-UAT']).toBe('u-ok')
  })

  it('无 refresh_token 时保留老行为：有 uat 走用户身份，否则走 TAT', async () => {
    const def = createFeishuServer({})
    const headers = await def.createAuthHeaders!(fakeStore({ uat: 'u-manual' }))

    expect(headers['X-Lark-MCP-UAT']).toBe('u-manual')
    expect(headers['X-Lark-MCP-TAT']).toBeUndefined()
  })
})
