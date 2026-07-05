import type { BaseMessage } from '@langchain/core/messages'
import type { MindmapContextData } from './tools/mindmapContext.js'
import {
  GENERATE_MINDMAP_FRAGMENT_TOOL,
  GENERATE_PALACE_TOOL,
} from './tools/subgraphRoutingTools.js'

export type SubgraphName = 'mindmap' | 'palace'

export interface SubgraphRouteResult {
  /** 目标子图名称 */
  subgraph: SubgraphName
  /** 原始 tool_call id */
  toolCallId: string
  /** 原始工具名 */
  toolName: string
}

export interface ToolCallLike {
  name: string
  id?: string
}

/**
 * 判断一个工具名是否属于虚拟子图路由工具。
 *
 * 该函数目前仍被 `orchestrator.ts` 的 `toolsNode` 用于过滤混合调用中的虚拟工具。
 */
export function isVirtualSubgraphTool(name: string): boolean {
  return name === GENERATE_MINDMAP_FRAGMENT_TOOL || name === GENERATE_PALACE_TOOL
}

/**
 * 将 LLM 调用的虚拟子图工具映射为待执行的子图名称。
 *
 * 该函数只做映射，不解析子图输入；输入解析由子图入口节点负责。
 * `context` 和 `messages` 参数为将来扩展保留，当前实现不读取。
 */
export function route(
  toolCall: ToolCallLike,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _context: MindmapContextData | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _messages: BaseMessage[],
): SubgraphRouteResult | null {
  if (!isVirtualSubgraphTool(toolCall.name)) {
    return null
  }

  const subgraph: SubgraphName = toolCall.name === GENERATE_PALACE_TOOL ? 'palace' : 'mindmap'

  return {
    subgraph,
    toolCallId: toolCall.id ?? '',
    toolName: toolCall.name,
  }
}
