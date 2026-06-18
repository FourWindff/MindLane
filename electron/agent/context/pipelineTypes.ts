/**
 * 消息预处理管道配置
 *
 * 用于在 mindlaneAgent 调用 LLM 前对 state.messages 进行规范化与压缩。
 */
export interface MessagePipelineConfig {
  /** 是否启用预处理管道 */
  enabled: boolean
  /** 历史消息最大 token 预算（不含 system prompt） */
  maxContextTokens: number
  /** 单条 tool_result 最大字节数，超过则转存磁盘 */
  toolResultMaxBytes: number
  /** 仅对这些工具名的结果执行 microcompact */
  microcompactToolNames: string[]
  /** 触发 microcompact 的字符串长度阈值 */
  microcompactThreshold: number
  /** 保留最近多少条完整工具结果不压缩 */
  microcompactKeepRecent: number
  /** snip 时是否始终保留 system 消息 */
  snipPreserveSystem: boolean
  /** snip 时是否始终保留最后一条 user 消息 */
  snipPreserveLastUser: boolean
}

const DEFAULT_MESSAGE_PIPELINE_CONFIG: MessagePipelineConfig = {
  enabled: true,
  maxContextTokens: 16_000,
  toolResultMaxBytes: 8_000,
  microcompactToolNames: [],
  microcompactThreshold: 4_000,
  microcompactKeepRecent: 3,
  snipPreserveSystem: true,
  snipPreserveLastUser: true,
}

/**
 * 合并部分配置到默认配置
 */
export function mergeMessagePipelineConfig(
  partial?: Partial<MessagePipelineConfig>,
): MessagePipelineConfig {
  return {
    ...DEFAULT_MESSAGE_PIPELINE_CONFIG,
    ...partial,
    microcompactToolNames: partial?.microcompactToolNames
      ? [...partial.microcompactToolNames]
      : [...DEFAULT_MESSAGE_PIPELINE_CONFIG.microcompactToolNames],
  }
}
