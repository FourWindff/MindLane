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
 * - recursionLimit: LangGraph `StateGraph` 单次 invoke/stream 允许的最大超步数
 *   （防止 supervisor ↔ tools 无限循环），单位：步数。
 *   Shared budget: the subgraphs are mounted as main-graph nodes, so
 *   their internal super-steps count against this one limit (measured: only a nested
 *   `.invoke()` gets its own budget), which therefore has to cover compaction + supervisor
 *   rounds + mindmap waves and merges + palace stages + tools.
 *   Measured steps (scripted provider, long text cut into n leaf batches): 1 batch → 7,
 *   9 → 17, 40 → 33, i.e. ~+0.65 per batch (4 batches per leaf wave, then merge rounds).
 *   300 covers ~500 batches (~13M chars at a 32k window, far beyond a real document) and
 *   still acts as a hard stop for a runaway loop.
 * - maxCompletionTokens: 为模型响应预留的 token 数（输入预算的固定扣减项，与窗口大小无关）。
 * - consolidationTriggerTokens: 压缩触发阈值（**策略值**）：会话长到这一步就滚动摘要，
 *   实际触发点取它与输入预算的较小者——小窗口模型在自己的容量处触发，大窗口模型
 *   保持固定的摘要与记忆提取节奏（不随窗口放大）。
 * - contextCompactRecentMessages: 压缩时保留的最近消息条数（滚动摘要尾部窗口，
 *   也用作调用前超限时的非 LLM 裁剪重试窗口）。
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
  recursionLimit: 300,
  maxCompletionTokens: 8_000,
  consolidationTriggerTokens: 64_000,
  contextCompactRecentMessages: 10,
  consolidationRatio: 0.5,
  consolidationSafetyBuffer: 1_024,
  maxContextMessages: 120,
  maxMessagesBeforeTokenCheck: 120,
  maxConsolidationRounds: 5,
  toolResultOffloadChars: 16_000,
  toolResultMaxChars: 16_000,
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
