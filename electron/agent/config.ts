/**
 * Agent 层集中配置
 *
 * 把 orchestrator / memory / palace 等模块原本散落的"魔法数字"集中到此文件，
 * 便于统一调优、避免重复声明。各 provider 的 temperature / timeout 等
 * 属于构造参数（由用户设置注入），不纳入此处。
 */

/**
 * Agent 调度与上下文压缩相关阈值
 *
 * - recursionLimit: LangGraph `StateGraph` 单次 invoke/stream 允许的最大节点
 *   迭代次数（防止 supervisor ↔ tools 无限循环），单位：步数。
 * - maxTokens: 上下文 `trimMessages` 保留的真实 token 上限，单位：token。
 *   使用 js-tiktoken (cl100k_base) 精确计数。
 * - summaryTriggerTokens: 历史消息总 token 数超过此阈值后切换为"摘要 + 最近若干条"
 *   策略，单位：token。
 * - contextWindowTokens: 模型上下文窗口总 token 数，用于计算输入预算。
 * - maxCompletionTokens: 为模型响应预留的 token 数。
 * - contextSafetyBufferTokens: 输入预算安全缓冲，防止估算误差导致超限。
 * - contextCompactRecentMessages: 主动压缩时保留的最近消息条数。
 * - reactiveCompactTailMessages: 被动压缩时保留的历史尾部消息条数。
 * - reactiveCompactMaxRetries: 被动压缩最大重试次数。
 * - consolidationRatio: 归档目标占输入预算的比例。
 * - consolidationSafetyBuffer: 归档时预留的安全缓冲 token 数。
 * - maxContextMessages: 归档后进入 LLM 的最大消息条数。
 * - maxMessagesBeforeTokenCheck: 触发精确 token 估算的消息数量阈值。
 * - maxConsolidationRounds: 单次调用最多执行归档轮数。
 * - toolResultOffloadChars: 工具结果字符数超过此阈值时转存到磁盘，单位：字符。
 * - toolResultMaxChars: 工具结果最大允许字符数，超过则硬截断，单位：字符。
 * - toolResultSummaryChars: 转存后返回给模型的摘要长度，单位：字符。
 * - toolResultOffloadDirName: 转存目录名，位于 userData 下。
 */
export const AGENT_LIMITS = {
  recursionLimit: 80,
  maxTokens: 4000,
  summaryTriggerTokens: 6000,
  contextWindowTokens: 64_000,
  maxCompletionTokens: 8_000,
  contextSafetyBufferTokens: 1_024,
  contextCompactRecentMessages: 10,
  reactiveCompactTailMessages: 5,
  reactiveCompactMaxRetries: 1,
  consolidationRatio: 0.5,
  consolidationSafetyBuffer: 1_024,
  maxContextMessages: 120,
  maxMessagesBeforeTokenCheck: 120,
  maxConsolidationRounds: 5,
  toolResultOffloadChars: 8_000,
  toolResultMaxChars: 32_000,
  toolResultSummaryChars: 1_000,
  toolResultOffloadDirName: 'tool-results',
} as const

/**
 * 记忆宫殿（Memory Palace）坐标布局参数
 *
 * - coordPad: 标准化坐标系（0~1）下相对画面边缘保留的最小内边距，
 *   单位：归一化坐标分量。
 * - minDistance: 两个锚点之间允许的最小欧氏距离，单位：归一化坐标分量；
 *   小于此距离时由 `enforceMinDistance` 互相推开。
 */
export const PALACE_LAYOUT = {
  coordPad: 0.05,
  minDistance: 0.12,
} as const
