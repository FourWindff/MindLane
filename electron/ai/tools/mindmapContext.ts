import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'
import type { MindLaneNode, MindLaneEdge } from '../../../src/shared/lib/fileFormat.js'

export interface ContextNodeInfo {
  id: string
  type: 'topic' | 'palace' | 'document'
  label: string
  extra?: Record<string, unknown>
}

export interface MindmapContextData {
  mindmapSummary?: string
  selectedNodes?: ContextNodeInfo[]
  allNodes?: MindLaneNode[]
  allEdges?: MindLaneEdge[]
  filePath?: string
  fileTitle?: string
}

let currentContext: MindmapContextData = {}

export function setMindmapContext(ctx: MindmapContextData): void {
  currentContext = ctx
}

export function getMindmapContextData(): MindmapContextData {
  return currentContext
}

function formatNodeForLLM(n: ContextNodeInfo): string {
  switch (n.type) {
    case 'topic':
      return `[主题] ${n.label} (id: ${n.id})`
    case 'palace': {
      const stationCount = n.extra?.stationCount ?? 0
      return `[记忆宫殿] ${n.label} (id: ${n.id}, ${stationCount}个站点)`
    }
    case 'document': {
      const excerpt = n.extra?.excerpt
        ? ` — ${String(n.extra.excerpt).slice(0, 80)}`
        : ''
      return `[文档] ${n.label} (id: ${n.id})${excerpt}`
    }
    default:
      return `${n.label} (id: ${n.id})`
  }
}

export const getMindmapContextTool = tool(
  async () => {
    const ctx = currentContext
    if (!ctx.mindmapSummary && (!ctx.allNodes || ctx.allNodes.length === 0)) {
      return '当前没有打开的思维导图，或导图为空。'
    }

    const parts: string[] = []
    if (ctx.fileTitle) parts.push(`文件标题: ${ctx.fileTitle}`)
    if (ctx.filePath) parts.push(`文件路径: ${ctx.filePath}`)
    if (ctx.mindmapSummary) parts.push(`导图结构:\n${ctx.mindmapSummary}`)
    if (ctx.selectedNodes && ctx.selectedNodes.length > 0) {
      parts.push(`当前选中节点:\n${ctx.selectedNodes.map(formatNodeForLLM).join('\n')}`)
    }
    return parts.join('\n\n')
  },
  {
    name: 'getMindmapContext',
    description: '获取用户当前打开的思维导图的完整内容和结构，包括所有节点类型（主题/记忆宫殿/文档）及其层级关系。',
    schema: z.object({}),
  },
)

export const getSelectedNodesTool = tool(
  async () => {
    const nodes = currentContext.selectedNodes
    if (!nodes || nodes.length === 0) return '用户当前没有选中任何节点。'

    return nodes.map(formatNodeForLLM).join('\n')
  },
  {
    name: 'getSelectedNodes',
    description: '获取用户在思维导图中当前选中的节点详细信息，包含节点类型（主题/宫殿/文档）、标签和ID。',
    schema: z.object({}),
  },
)
