import { describe, it, expect } from 'vitest'
import type { AppSettings } from '../../fs/types.js'
import type { MessagePipelineConfig } from '../../agent/context/pipeline.js'
import { resolveMessagePipelineConfig } from '../messagePipeline.js'

const pipeline = (partial: Partial<MessagePipelineConfig>): MessagePipelineConfig => ({
  enabled: true,
  maxContextTokens: 16_000,
  toolResultMaxBytes: 8_000,
  microcompactToolNames: [] as string[],
  microcompactThreshold: 4_000,
  microcompactKeepRecent: 3,
  snipPreserveSystem: true,
  snipPreserveLastUser: true,
  ...partial,
})

const baseSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
  apiKey: '',
  chatModel: 'qwen-max',
  activeProviders: { chat: 'dashscope', image: 'dashscope' },
  providerConfigs: {},
  editor: { autoSaveIntervalMs: 30_000, maxBackups: 5, cachePruneDays: 30 },
  recentFilesMax: 10,
  lastWorkspacePath: null,
  recentWorkspacePaths: [],
  restoreLastWorkspaceOnLaunch: true,
  workspacePathsByUuid: {},
  filePathsByUuid: {},
  mcpServers: {},
  ...overrides,
})

describe('resolveMessagePipelineConfig', () => {
  it('falls back to the global messagePipeline config when the provider has no override', () => {
    const config = resolveMessagePipelineConfig(
      baseSettings({ messagePipeline: pipeline({ maxContextTokens: 12_345 }) }),
    )

    expect(config.enabled).toBe(true)
    expect(config.maxContextTokens).toBe(12_345)
  })

  it('lets the active provider override the global config', () => {
    const config = resolveMessagePipelineConfig(
      baseSettings({
        activeProviders: { chat: 'kimi-code', image: 'dashscope' },
        messagePipeline: pipeline({ maxContextTokens: 8_000 }),
        providerConfigs: {
          'kimi-code': { apiKey: 'k', messagePipeline: { maxContextTokens: 4_000 } },
        },
      }),
    )

    expect(config.maxContextTokens).toBe(4_000)
  })

  it('fills defaults for keys the provider override omits', () => {
    const config = resolveMessagePipelineConfig(
      baseSettings({
        activeProviders: { chat: 'kimi-code', image: 'dashscope' },
        providerConfigs: {
          'kimi-code': { apiKey: 'k', messagePipeline: { enabled: false } },
        },
      }),
    )

    expect(config.enabled).toBe(false)
    expect(config.maxContextTokens).toBeGreaterThan(0)
  })
})
