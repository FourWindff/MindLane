import { ToolMessage } from '@langchain/core/messages'
import type { MainGraphStateType } from './state.js'
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
 * 调用方（如 AgentOrchestrator）根据自身的 palace 能力决定是否注册 palace 工具。
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

interface SubgraphResultPayload {
  messages: ToolMessage[]
  pendingSubgraph: null
  pendingSubgraphToolCallId: string
  pendingSubgraphToolName: string
}

/**
 * 将子图执行结果包装成 ToolMessage，并清理 pending subgraph 状态。
 *
 * Palace 子图已经在内部将远程图片 URL 转换为 data URL，因此这里只读取 state.imageUrls。
 */
export function packageResult(state: MainGraphStateType): SubgraphResultPayload {
  const toolName = state.pendingSubgraphToolName || defaultToolName(state.pendingSubgraph)
  const toolCallId = state.pendingSubgraphToolCallId

  const content = state.error
    ? { ok: false, error: state.response || state.error }
    : buildSuccessPayload(state)

  return {
    messages: [
      new ToolMessage({
        tool_call_id: toolCallId,
        name: toolName,
        content: JSON.stringify(content),
      }),
    ],
    pendingSubgraph: null,
    pendingSubgraphToolCallId: '',
    pendingSubgraphToolName: '',
  }
}

function defaultToolName(subgraph: MainGraphStateType['pendingSubgraph']): string {
  return subgraph === 'palace' ? GENERATE_PALACE_TOOL : GENERATE_MINDMAP_FRAGMENT_TOOL
}

function buildSuccessPayload(state: MainGraphStateType): Record<string, unknown> {
  if (state.pendingSubgraph === 'palace') {
    return buildPalacePayload(state)
  }
  // mindmap 或任何其他状态都走 mindmap 路径；palace 已在上方处理
  return buildMindmapPayload(state)
}

function buildMindmapPayload(state: MainGraphStateType): Record<string, unknown> {
  return {
    ok: true,
    title: state.mindmapTitle,
    yamlFragment: state.mindmapYaml,
    documentRef: state.documentRef,
  }
}

function buildPalacePayload(state: MainGraphStateType): Record<string, unknown> {
  return {
    ok: true,
    label: state.palace?.theme || `记忆宫殿 (${state.memoryRoute.length} 站)`,
    stations: state.memoryRoute.map((s) => ({
      order: s.order,
      content: s.content,
      anchorVisual: s.anchorVisual ?? '',
      association: s.association,
      x: s.x,
      y: s.y,
      linkedNodeId: s.linkedNodeId ?? '',
    })),
    imageUrl: state.imageUrls[0] ?? '',
    sourceNodeIds: state.palaceInputNodes.map((n) => n.id),
  }
}
