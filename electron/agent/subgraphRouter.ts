import { ToolMessage } from '@langchain/core/messages'
import type { ChatToolCallStep } from '../../contracts/fileFormat.js'
import {
  createGenerateMindmapFragmentTool,
  createGeneratePalaceTool,
  GENERATE_MINDMAP_FRAGMENT_TOOL,
  GENERATE_PALACE_TOOL,
} from './tools/subgraphRoutingTools.js'

export { GENERATE_MINDMAP_FRAGMENT_TOOL, GENERATE_PALACE_TOOL }

export type SubgraphName = 'mindmap' | 'palace'

interface SubgraphCall {
  /** Target subgraph name */
  subgraph: SubgraphName
  /** Original tool_call id */
  toolCallId: string
  /** Original tool name */
  toolName: string
}

export interface ToolCallLike {
  name: string
  id?: string
}

/**
 * Return the model-visible virtual subgraph routing tools (mindmap and palace).
 *
 * The memory palace is available by default; the artwork carrier is resolved
 * inside the subgraph from the preference and the provider's capabilities.
 */
export function getToolSchemas() {
  return [createGenerateMindmapFragmentTool(), createGeneratePalaceTool()]
}

/**
 * Tell whether a tool name stands for a virtual subgraph call.
 */
export function isSubgraphCall(name: string): boolean {
  return name === GENERATE_MINDMAP_FRAGMENT_TOOL || name === GENERATE_PALACE_TOOL
}

/**
 * Detect **every** virtual subgraph call in the model's tool_calls, in
 * declaration order.
 *
 * Several calls in one round each become their own subgraph node in the same
 * super-step, so returning only the first one (the old behaviour) silently
 * dropped the rest.
 */
export function detect(toolCalls: ToolCallLike[]): SubgraphCall[] {
  const calls: SubgraphCall[] = []
  for (const toolCall of toolCalls) {
    if (!isSubgraphCall(toolCall.name)) {
      continue
    }

    calls.push({
      subgraph: toolCall.name === GENERATE_PALACE_TOOL ? 'palace' : 'mindmap',
      toolCallId: toolCall.id ?? '',
      toolName: toolCall.name,
    })
  }

  return calls
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
