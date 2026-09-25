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

interface SubgraphResultPayload {
  messages: ToolMessage[]
  pendingSubgraph: null
  mindmapToolCallId?: string
  mindmapToolName?: string
  palaceToolCallId?: string
  palaceToolName?: string
}

/**
 * 将子图执行结果包装成 ToolMessage，并清理该子图自己的调用信息。
 *
 * 标量通道按子图拆名后，收口只读自己那一份：另一个子图的错误/轨迹/调用信息
 * 不参与本次收口，也不被清除（并行时各收各的）。
 *
 * Palace 子图已经在内部将远程图片 URL 转换为 data URL，因此这里只读取 state.imageUrls。
 */
export function packageResult(state: MainGraphStateType): SubgraphResultPayload {
  const subgraph: SubgraphName = state.pendingSubgraph === 'palace' ? 'palace' : 'mindmap'
  const channels =
    subgraph === 'palace'
      ? {
          toolName: state.palaceToolName,
          toolCallId: state.palaceToolCallId,
          error: state.palaceError,
          response: state.palaceResponse,
          toolSteps: state.palaceToolSteps,
        }
      : {
          toolName: state.mindmapToolName,
          toolCallId: state.mindmapToolCallId,
          error: state.mindmapError,
          response: state.mindmapResponse,
          toolSteps: state.mindmapToolSteps,
        }

  const content = channels.error
    ? { ok: false, error: channels.response || channels.error }
    : buildSuccessPayload(state, subgraph)

  return {
    messages: [
      new ToolMessage({
        tool_call_id: channels.toolCallId,
        name: channels.toolName || defaultToolName(subgraph),
        content: JSON.stringify(content),
        additional_kwargs: channels.toolSteps?.length
          ? { toolSteps: channels.toolSteps }
          : undefined,
      }),
    ],
    pendingSubgraph: null,
    ...(subgraph === 'palace'
      ? { palaceToolCallId: '', palaceToolName: '' }
      : { mindmapToolCallId: '', mindmapToolName: '' }),
  }
}

function defaultToolName(subgraph: SubgraphName): string {
  return subgraph === 'palace' ? GENERATE_PALACE_TOOL : GENERATE_MINDMAP_FRAGMENT_TOOL
}

function buildSuccessPayload(
  state: MainGraphStateType,
  subgraph: SubgraphName,
): Record<string, unknown> {
  return subgraph === 'palace' ? buildPalacePayload(state) : buildMindmapPayload(state)
}

function buildMindmapPayload(state: MainGraphStateType): Record<string, unknown> {
  return {
    ok: true,
    title: state.mindmapTitle,
    xmlFragment: state.mindmapXml,
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
