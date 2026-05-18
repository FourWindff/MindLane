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
 * - maxTokens: 上下文 `trimMessages` 保留的近似 token 上限，单位：token
 *   （近似 ≈ 字符数 / 3）。
 * - summaryTriggerCount: 历史消息数超过此阈值后切换为"摘要 + 最近若干条"
 *   策略，单位：消息条数。
 */
export const AGENT_LIMITS = {
  recursionLimit: 80,
  maxTokens: 4000,
  summaryTriggerCount: 20,
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
