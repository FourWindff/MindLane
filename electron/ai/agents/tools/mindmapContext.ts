import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'
import type { MindLaneNode, MindLaneEdge } from '../../../../src/shared/lib/fileFormat.js'

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

export function createMindmapContextTools(context: MindmapContextData) {
  const getMindmapContextTool = tool(
    async () => {
      const parts: string[] = []

      if (context.workspacePath) {
        parts.push(`工作区路径: ${context.workspacePath}`)
        if (context.workspaceFiles && context.workspaceFiles.length > 0) {
          parts.push(`工作区文件列表:\n${context.workspaceFiles.map((f) => `- ${f.name} (${f.filePath})`).join('\n')}`)
        } else {
          parts.push('工作区中没有文件。')
        }
      } else {
        parts.push('当前没有打开任何工作区。')
      }

      if (!context.hasDocumentOpen && !context.mindmapSummary && (!context.allNodes || context.allNodes.length === 0)) {
        parts.push('\n当前没有打开的思维导图。')
        return parts.join('\n\n')
      }

      if (context.fileTitle) parts.push(`当前文件标题: ${context.fileTitle}`)
      if (context.filePath) parts.push(`当前文件路径: ${context.filePath}`)
      if (context.mindmapSummary) parts.push(`导图结构:\n${context.mindmapSummary}`)
      if (context.selectedNodes && context.selectedNodes.length > 0) {
        parts.push(`当前选中节点:\n${context.selectedNodes.map(formatNodeForLLM).join('\n')}`)
      }
      return parts.join('\n\n')
    },
    {
      name: 'getMindmapContext',
      description: '获取用户当前的完整上下文，包括：工作区路径和文件列表、当前打开的思维导图内容和结构、选中的节点。',
      schema: z.object({}),
    },
  )

  const listWorkspaceFilesTool = tool(
    async () => {
      if (!context.workspacePath) return '当前没有打开任何工作区。'
      if (!context.workspaceFiles || context.workspaceFiles.length === 0) {
        return `工作区（${context.workspacePath}）中没有 .mindlane 文件。`
      }
      const lines = context.workspaceFiles.map((f) => `- ${f.name} (${f.filePath})`)
      return `工作区: ${context.workspacePath}\n共 ${context.workspaceFiles.length} 个文件:\n${lines.join('\n')}`
    },
    {
      name: 'listWorkspaceFiles',
      description: '列出当前工作区目录中的所有文件，包括文件名和路径。',
      schema: z.object({}),
    },
  )

  const getSelectedNodesTool = tool(
    async () => {
      const nodes = context.selectedNodes
      if (!nodes || nodes.length === 0) return '用户当前没有选中任何节点。'

      return nodes.map(formatNodeForLLM).join('\n')
    },
    {
      name: 'getSelectedNodes',
      description: '获取用户在思维导图中当前选中的节点详细信息，包含节点类型（主题/宫殿/文档）、标签和ID。',
      schema: z.object({}),
    },
  )

  return { getMindmapContextTool, getSelectedNodesTool, listWorkspaceFilesTool }
}
