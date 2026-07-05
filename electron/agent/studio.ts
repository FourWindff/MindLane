/**
 * LangGraph Studio 入口
 *
 * 自动读取 MindLane 应用配置（settings.json）创建 Provider。
 * 支持所有已注册的 provider：dashscope、kimi-code、minimax。
 *
 * 配置查找顺序：
 * 1. MINDLANE_SETTINGS_PATH 环境变量指定的路径
 * 2. 各 OS 默认的 Electron userData 路径
 *
 * 注意：Kimi Code / MiniMax 仅支持 Chat 能力，palace graph 运行时需 Vision + ImageGen。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { LLMProvider } from './providers/base.js'
import { createProvider, getProviderMeta } from './providers/registry.js'
import { buildMindmapSubgraph } from './graphs/mindmapGraph/index.js'
import { buildPalaceSubgraph } from './graphs/palaceGraph.js'
import { AgentOrchestrator } from './orchestrator.js'
import { AiService } from './service.js'
import type { AppSettings } from '../fs/types.js'

// ===== 配置读取 =====

function getSettingsPath(): string {
  const envPath = process.env.MINDLANE_SETTINGS_PATH
  if (envPath) {
    console.log('[studio] settings path (env):', envPath)
    return envPath
  }

  const home = os.homedir()
  let p: string
  switch (process.platform) {
    case 'darwin':
      p = path.join(home, 'Library/Application Support/MindLane/settings.json')
      break
    case 'win32':
      p = path.join(
        process.env.APPDATA || path.join(home, 'AppData/Roaming'),
        'MindLane/settings.json',
      )
      break
    default:
      p = path.join(home, '.config/mindlane/settings.json')
  }
  console.log('[studio] settings path:', p)
  return p
}

function loadSettings(): AppSettings | null {
  const settingsPath = getSettingsPath()
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8')
    return JSON.parse(raw) as AppSettings
  } catch (err) {
    console.error(`[studio] failed to load settings from ${settingsPath}:`, err)
    return null
  }
}

function getDefaultModel(providerId: string): string {
  const meta = getProviderMeta(providerId)
  return meta?.defaultModels[0]?.id ?? ''
}

function createProviderFromSettings(): LLMProvider {
  let providerId: string | undefined
  let apiKey: string | undefined
  let chatModel: string | undefined
  let baseUrl: string | undefined

  const settings = loadSettings()
  if (settings) {
    providerId = settings.activeProviders.chat
    const providerConfig = settings.providerConfigs[providerId]
    apiKey = providerConfig?.apiKey || settings.apiKey
    chatModel = settings.chatModel || getDefaultModel(providerId)
    baseUrl = providerConfig?.baseUrl
  } else {
    providerId = process.env.MINDLANE_PROVIDER || 'dashscope'
    apiKey = process.env.MINDLANE_API_KEY
    chatModel = process.env.MINDLANE_CHAT_MODEL || getDefaultModel(providerId)
    baseUrl = process.env.MINDLANE_BASE_URL
  }

  if (!apiKey) {
    throw new Error(
      `缺少 API Key。\n` +
        `方式一：在 MindLane 应用中配置 provider，或通过 MINDLANE_SETTINGS_PATH 指定配置路径。\n` +
        `方式二：设置环境变量启动 LangGraph Studio，例如：\n` +
        `  MINDLANE_API_KEY=your_key npx @langchain/langgraph-cli dev\n\n` +
        `可选环境变量：\n` +
        `  MINDLANE_PROVIDER  - provider ID（默认 dashscope）\n` +
        `  MINDLANE_API_KEY   - API Key\n` +
        `  MINDLANE_CHAT_MODEL - 模型名称（默认取 provider 的第一个默认模型）\n` +
        `  MINDLANE_BASE_URL  - 自定义 API 地址\n` +
        `  MINDLANE_SETTINGS_PATH - MindLane settings.json 路径`,
    )
  }

  if (!chatModel) {
    throw new Error(`无法确定 provider「${providerId}」的默认模型。请设置 MINDLANE_CHAT_MODEL。`)
  }

  return createProvider(providerId, {
    apiKey,
    chatModel,
    baseUrl,
  })
}

// ===== Graph 导出 =====

const provider = createProviderFromSettings()

export const mindmapGraph = buildMindmapSubgraph({ provider })
export const palaceGraph = buildPalaceSubgraph({ provider })
export const mainGraph = new AgentOrchestrator(provider, new AiService()).buildGraph()
