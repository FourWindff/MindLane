import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from '../../../fs/types.js'
import { DashScopeProvider } from '../dashscope.js'
import { KimiCodeProvider } from '../kimi-code.js'
import { DeepSeekProvider } from '../deepseek.js'
import { resolveChatProvider } from '../index.js'

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    apiKey: 'global-key',
    chatModel: 'qwen-plus',
    activeProviders: { chat: 'dashscope', image: 'dashscope' },
    providerConfigs: {},
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

  it('prefers the per-provider apiKey over the global key', () => {
    const provider = resolveChatProvider(
      makeSettings({ providerConfigs: { dashscope: { apiKey: 'provider-key' } } }),
    )

    expect(provider.model.lc_kwargs.apiKey).toBe('provider-key')
  })

  it('falls back to the global apiKey when the provider config has none', () => {
    const provider = resolveChatProvider(makeSettings())

    expect(provider.model.lc_kwargs.apiKey).toBe('global-key')
  })

  it('ignores a whitespace-only provider key and falls back to the global key', () => {
    const provider = resolveChatProvider(
      makeSettings({ providerConfigs: { dashscope: { apiKey: '   ' } } }),
    )

    expect(provider.model.lc_kwargs.apiKey).toBe('global-key')
  })

  it('throws when no apiKey is configured', () => {
    expect(() => resolveChatProvider(makeSettings({ apiKey: '' }))).toThrow('未填写 API Key')
    expect(() => resolveChatProvider(makeSettings({ apiKey: '  ' }))).toThrow('未填写 API Key')
  })

  it('throws when chatModel is empty', () => {
    expect(() => resolveChatProvider(makeSettings({ chatModel: '' }))).toThrow('请选择模型')
    expect(() => resolveChatProvider(makeSettings({ chatModel: '  ' }))).toThrow('请选择模型')
  })

  it('throws with the model name when chatModel is outside the provider catalog', () => {
    expect(() => resolveChatProvider(makeSettings({ chatModel: 'gpt-4o' }))).toThrow(
      '模型 gpt-4o 不属于当前 provider',
    )
  })

  it('throws for an unknown provider', () => {
    expect(() =>
      resolveChatProvider(makeSettings({ activeProviders: { chat: 'nope', image: 'dashscope' } })),
    ).toThrow('未知的 provider: nope')
  })

  it('resolves a different provider against its own catalog', () => {
    const kimi = KimiCodeProvider.defaultModels[0]!
    const provider = resolveChatProvider(
      makeSettings({
        activeProviders: { chat: 'kimi-code', image: 'dashscope' },
        chatModel: kimi.id,
      }),
    )

    expect(provider).toBeInstanceOf(KimiCodeProvider)
  })

  it('resolves DeepSeek and pins the chat model to the non-thinking (chatDeepSeek) mode', () => {
    const provider = resolveChatProvider(
      makeSettings({
        activeProviders: { chat: 'deepseek', image: 'dashscope' },
        chatModel: 'deepseek-v4-flash',
        providerConfigs: { deepseek: { apiKey: 'ds-key' } },
      }),
    )

    expect(provider).toBeInstanceOf(DeepSeekProvider)
    expect(provider.model.lc_kwargs.configuration.baseURL).toBe('https://api.deepseek.com')
    expect(provider.model.lc_kwargs.modelKwargs).toEqual({ thinking: { type: 'disabled' } })
  })
})
