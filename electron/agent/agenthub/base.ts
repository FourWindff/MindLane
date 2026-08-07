import type { LLMProvider } from '../providers/index.js'
import type { MainGraphStateType, PalaceSubgraphStateType } from '../state.js'

/**
 * Agent 基类 - 所有 Agent 的抽象基类
 *
 * 架构原则：
 * - 只有 MindLaneAgent 拥有记忆、上下文管理、工具绑定
 * - 其他 Agent (Analyze, ImageGen, Vision) 不涉及持久化记忆
 * - 所有 Agent 通过统一的 invoke(state) 接口执行任务
 * - MindLaneAgent 自行声明 route(state) 路由方法（基类不声明，也不调用）
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
}

/**
 * Palace 子图 Agent 基类
 * 用于 Analyze, ImageGen, Vision 等 Palace 子图中的 Agent
 */
export abstract class PalaceAgent {
  constructor(protected provider: LLMProvider) {}

  abstract invoke(state: PalaceSubgraphStateType): Promise<Partial<PalaceSubgraphStateType>>
}
