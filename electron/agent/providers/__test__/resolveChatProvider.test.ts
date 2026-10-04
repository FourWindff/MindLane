import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from '../../../fs/types.js'
import { DashScopeProvider } from '../dashscope.js'
import { KimiCodeProvider } from '../kimi-code.js'
import { DeepSeekProvider } from '../deepseek.js'
import { OpenCodeGoProvider, withGatewayHeaders } from '../opencode-go.js'
import { resolveChatProvider } from '../index.js'

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    chatModel: 'qwen-plus',
    activeProviders: { chat: 'dashscope' },
    providerConfigs: { dashscope: { apiKey: 'provider-key' } },
    ...overrides,
  }
}

describe('resolveChatProvider', () => {
  it('returns a provider for the active chat provider with model/key/baseUrl passed through', () => {
    const provider = resolveChatProvider(
      makeSettings({
        providerConfigs: { dashscope: { apiKey: 'provider-key', baseUrl: 'https://example.com' } },
      }),
    )

    expect(provider).toBeInstanceOf(DashScopeProvider)
    expect(provider.contextWindow).toBe(131_072) // qwen-plus declared window
    expect(provider.model.lc_kwargs.configuration.baseURL).toBe('https://example.com')
  })

  it('resolves the apiKey from the active provider config', () => {
    const provider = resolveChatProvider(makeSettings())

    expect(provider.model.lc_kwargs.apiKey).toBe('provider-key')
  })

  it('throws when the active provider has no apiKey configured', () => {
    expect(() => resolveChatProvider(makeSettings({ providerConfigs: {} }))).toThrow(
      'API Key is missing',
    )
  })

  it('treats a whitespace-only provider key as missing', () => {
    expect(() =>
      resolveChatProvider(makeSettings({ providerConfigs: { dashscope: { apiKey: '   ' } } })),
    ).toThrow('API Key is missing')
  })

  it('never reuses another provider key for the active provider', () => {
    expect(() =>
      resolveChatProvider(
        makeSettings({
          activeProviders: { chat: 'kimi-code' },
          chatModel: KimiCodeProvider.defaultModels[0]!.id,
        }),
      ),
    ).toThrow('API Key is missing')
  })

  it('throws when chatModel is empty', () => {
    expect(() => resolveChatProvider(makeSettings({ chatModel: '' }))).toThrow(
      'Please select a model',
    )
    expect(() => resolveChatProvider(makeSettings({ chatModel: '  ' }))).toThrow(
      'Please select a model',
    )
  })

  it('throws with the model name when chatModel is outside the provider catalog', () => {
    expect(() => resolveChatProvider(makeSettings({ chatModel: 'gpt-4o' }))).toThrow(
      'model gpt-4o does not belong to the current provider',
    )
  })

  it('throws for an unknown provider', () => {
    expect(() => resolveChatProvider(makeSettings({ activeProviders: { chat: 'nope' } }))).toThrow(
      'unknown provider: nope',
    )
  })

  it('resolves a different provider against its own catalog', () => {
    const kimi = KimiCodeProvider.defaultModels[0]!
    const provider = resolveChatProvider(
      makeSettings({
        activeProviders: { chat: 'kimi-code' },
        chatModel: kimi.id,
        providerConfigs: { 'kimi-code': { apiKey: 'kimi-key' } },
      }),
    )

    expect(provider).toBeInstanceOf(KimiCodeProvider)
  })

  it('resolves DeepSeek and pins the chat model to the non-thinking (chatDeepSeek) mode', () => {
    const provider = resolveChatProvider(
      makeSettings({
        activeProviders: { chat: 'deepseek' },
        chatModel: 'deepseek-v4-flash',
        providerConfigs: { deepseek: { apiKey: 'ds-key' } },
      }),
    )

    expect(provider).toBeInstanceOf(DeepSeekProvider)
    expect(provider.model.lc_kwargs.configuration.baseURL).toBe('https://api.deepseek.com')
    expect(provider.model.lc_kwargs.modelKwargs).toEqual({ thinking: { type: 'disabled' } })
  })

  it('resolves OpenCode Go against its own catalog with the Go endpoint', () => {
    const provider = resolveChatProvider(
      makeSettings({
        activeProviders: { chat: 'opencode-go' },
        chatModel: 'glm-5.2',
        providerConfigs: { 'opencode-go': { apiKey: 'go-key' } },
      }),
    )

    expect(provider).toBeInstanceOf(OpenCodeGoProvider)
    expect(provider.contextWindow).toBe(1_000_000) // glm-5.2 declared window
    expect(provider.model.lc_kwargs.apiKey).toBe('go-key')
    expect(provider.model.lc_kwargs.configuration.baseURL).toBe('https://opencode.ai/zen/go/v1')
    expect(typeof provider.model.lc_kwargs.configuration.fetch).toBe('function')
  })

  it('stamps the gateway session header per conversation, preserving other headers', () => {
    const init = withGatewayHeaders({ headers: { authorization: 'Bearer x' } }, 'session-123')

    const headers = new Headers(init.headers)
    expect(headers.get('x-opencode-session')).toBe('session-123')
    expect(headers.get('authorization')).toBe('Bearer x')
    expect(headers.get('User-Agent')).toMatch(/^MindLaneAgent\//)
  })

  it('falls back to a stable per-process session id outside a stream', () => {
    const first = new Headers(withGatewayHeaders(undefined, undefined).headers)
    const second = new Headers(withGatewayHeaders(undefined, undefined).headers)

    expect(first.get('x-opencode-session')).toBeTruthy()
    expect(first.get('x-opencode-session')).toBe(second.get('x-opencode-session'))
  })
})
