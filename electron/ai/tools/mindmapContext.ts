import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'
import type { MindLaneNode, MindLaneEdge } from '../../../src/shared/lib/fileFormat.js'

export interface ContextNodeInfo {
  id: string
  type: 'topic' | 'palace' | 'document'
  label: string
  extra?: Record<string, unknown>
}

export interface WorkspaceFileInfo {
  name: string
  filePath: string
}

export interface MindmapContextData {
  mindmapSummary?: string
  selectedNodes?: ContextNodeInfo[]
  allNodes?: MindLaneNode[]
  allEdges?: MindLaneEdge[]
  filePath?: string
  fileTitle?: string
  hasDocumentOpen?: boolean
  workspacePath?: string
  workspaceFiles?: WorkspaceFileInfo[]
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
    const parts: string[] = []

    if (ctx.workspacePath) {
      parts.push(`工作区路径: ${ctx.workspacePath}`)
      if (ctx.workspaceFiles && ctx.workspaceFiles.length > 0) {
        parts.push(`工作区文件列表:\n${ctx.workspaceFiles.map((f) => `- ${f.name} (${f.filePath})`).join('\n')}`)
      } else {
        parts.push('工作区中没有文件。')
      }
    } else {
      parts.push('当前没有打开任何工作区。')
    }

    if (!ctx.hasDocumentOpen && !ctx.mindmapSummary && (!ctx.allNodes || ctx.allNodes.length === 0)) {
      parts.push('\n当前没有打开的思维导图。')
      return parts.join('\n\n')
    }

    if (ctx.fileTitle) parts.push(`当前文件标题: ${ctx.fileTitle}`)
    if (ctx.filePath) parts.push(`当前文件路径: ${ctx.filePath}`)
    if (ctx.mindmapSummary) parts.push(`导图结构:\n${ctx.mindmapSummary}`)
    if (ctx.selectedNodes && ctx.selectedNodes.length > 0) {
      parts.push(`当前选中节点:\n${ctx.selectedNodes.map(formatNodeForLLM).join('\n')}`)
    }
    return parts.join('\n\n')
  },
  {
    name: 'getMindmapContext',
    description: '获取用户当前的完整上下文，包括：工作区路径和文件列表、当前打开的思维导图内容和结构、选中的节点。',
    schema: z.object({}),
  },
)

export const listWorkspaceFilesTool = tool(
  async () => {
    const ctx = currentContext
    if (!ctx.workspacePath) return '当前没有打开任何工作区。'
    if (!ctx.workspaceFiles || ctx.workspaceFiles.length === 0) {
      return `工作区（${ctx.workspacePath}）中没有 .mindlane 文件。`
    }
    const lines = ctx.workspaceFiles.map((f) => `- ${f.name} (${f.filePath})`)
    return `工作区: ${ctx.workspacePath}\n共 ${ctx.workspaceFiles.length} 个文件:\n${lines.join('\n')}`
  },
  {
    name: 'listWorkspaceFiles',
    description: '列出当前工作区目录中的所有文件，包括文件名和路径。',
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
