import { ToolMessage } from '@langchain/core/messages'
import type { ChatToolCallStep } from '../../src/shared/lib/fileFormat.js'
import {
  createGenerateMindmapFragmentTool,
  createGeneratePalaceTool,
  GENERATE_MINDMAP_FRAGMENT_TOOL,
  GENERATE_PALACE_TOOL,
} from './tools/subgraphRoutingTools.js'

export { GENERATE_MINDMAP_FRAGMENT_TOOL, GENERATE_PALACE_TOOL }

export type SubgraphName = 'mindmap' | 'palace'

export interface SubgraphCall {
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
 * 返回模型可见的虚拟子图路由工具列表（mindmap 与 palace）。
 *
 * 记忆宫殿默认可用；画面载体在子图内按偏好与 provider 能力解析。
 */
export function getToolSchemas() {
  return [createGenerateMindmapFragmentTool(), createGeneratePalaceTool()]
}

/**
 * 判断一个工具名是否代表虚拟子图调用。
 */
export function isSubgraphCall(name: string): boolean {
  return name === GENERATE_MINDMAP_FRAGMENT_TOOL || name === GENERATE_PALACE_TOOL
}

/**
 * 从模型输出的 tool_calls 中识别出第一个虚拟子图调用。
 *
 * @returns 第一个子图调用，如果没有则返回 null
 */
export function detect(toolCalls: ToolCallLike[]): SubgraphCall | null {
  for (const toolCall of toolCalls) {
    if (!isSubgraphCall(toolCall.name)) {
      continue
    }

    const subgraph: SubgraphName = toolCall.name === GENERATE_PALACE_TOOL ? 'palace' : 'mindmap'
    return {
      subgraph,
      toolCallId: toolCall.id ?? '',
      toolName: toolCall.name,
    }
  }

  return null
}

/**
 * Build the ToolMessage a subgraph node writes back for its own virtual call —
 * the subgraph side of the virtual-tool interface.
 *
 * Both subgraphs close out through this one builder so the persisted shape
 * (JSON payload + `additional_kwargs.toolSteps` trace) cannot drift between
 * them; the payload itself stays each subgraph's own business.
 *
 * The call info rides in from the supervisor's declaration of the call; the
 * default name covers a subgraph executed without one.
 */
export function buildSubgraphToolMessage(params: {
  subgraph: SubgraphName
  toolCallId: string
  toolName: string
  payload: Record<string, unknown>
  toolSteps: ChatToolCallStep[]
}): ToolMessage {
  return new ToolMessage({
    tool_call_id: params.toolCallId,
    name: params.toolName || defaultToolName(params.subgraph),
    content: JSON.stringify(params.payload),
    additional_kwargs: params.toolSteps.length ? { toolSteps: params.toolSteps } : undefined,
  })
}

function defaultToolName(subgraph: SubgraphName): string {
  return subgraph === 'palace' ? GENERATE_PALACE_TOOL : GENERATE_MINDMAP_FRAGMENT_TOOL
}
