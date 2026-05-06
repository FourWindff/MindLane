import type { LLMProvider } from '../providers/index.js'
import type { MainGraphStateType, PalaceSubgraphStateType } from '../state.js'

/**
 * Agent 基类 - 所有 Agent 的抽象基类
 *
 * 架构原则：
 * - 只有 MindLaneAgent 拥有记忆、上下文管理、工具
 * - 其他 Agent (Analyze, ImageGen, Vision) 不涉及持久化记忆
 * - 所有 Agent 通过统一的 invoke(state) 接口执行任务
 *
 * 工具支持（可选）：
 * - 只有 MindLaneAgent 需要实现 invokeTools 和 route
 * - 其他 Agent 只需实现 invoke
 *
 * 状态类型对应：
 * - MindLaneAgent: MainGraphStateType
 * - Analyze/ImageGen/Vision: PalaceSubgraphStateType
 */
export abstract class BaseAgent {
  constructor(protected provider: LLMProvider) {}

  /**
   * 执行 Agent 的主要逻辑
   * @param state - 当前 Agent 状态
   * @returns 部分状态更新
   */
  abstract invoke(state: MainGraphStateType): Promise<Partial<MainGraphStateType>>

  /**
   * 执行工具调用（可选，只有 MindLaneAgent 需要）
   * @param state - 当前 Agent 状态
   * @returns 工具调用结果
   */
  invokeTools?(state: MainGraphStateType): Promise<Partial<MainGraphStateType>>

  /**
   * 路由决策（可选，只有 MindLaneAgent 需要）
   * @param state - 当前 Agent 状态
   * @returns 目标节点名称
   */
  route?(state: MainGraphStateType): string
}

/**
 * Palace 子图 Agent 基类
 * 用于 Analyze, ImageGen, Vision 等 Palace 子图中的 Agent
 */
export abstract class PalaceAgent {
  constructor(protected provider: LLMProvider) {}

  abstract invoke(state: PalaceSubgraphStateType): Promise<Partial<PalaceSubgraphStateType>>
}
