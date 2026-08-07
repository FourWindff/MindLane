import { mergeMessagePipelineConfig } from '../agent/context/pipeline.js'
import type { MessagePipelineConfig } from '../agent/context/pipeline.js'
import type { AppSettings } from '../fs/types.js'

/**
 * 解析消息预处理管道配置：全局配置叠加当前 chat provider 的 provider 级覆盖。
 * 纯函数，便于单测。
 */
export function resolveMessagePipelineConfig(settings: AppSettings): MessagePipelineConfig {
  const providerId = settings.activeProviders.chat || 'dashscope'
  const providerOverride = settings.providerConfigs[providerId]?.messagePipeline
  return mergeMessagePipelineConfig({
    ...settings.messagePipeline,
    ...providerOverride,
  })
}
