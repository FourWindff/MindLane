import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'

// AI 操作 Mindmap 节点的工具集
// 方案一：AI 返回操作指令，前端执行

// ========== 添加 Text 节点 ==========
const addTextNodeTool = tool(
  async ({ parentId, label, palaceId }) => {
    if (!label.trim()) {
      return { ok: false, error: '节点标签不能为空' }
    }

    return {
      ok: true,
      action: 'addNode',
      data: {
        type: 'text' as const,
        parentId: parentId || undefined,
        nodeData: {
          label: label.trim(),
          ...(palaceId && { palaceId }),
        },
      },
    }
  },
  {
    name: 'addTextNode',
    description: '在思维导图中添加一个新的文本节点。应该使用当前选中的节点ID作为父节点（通过 context.selectedNodes 获取），如果没有选中节点则不提供 parentId。',
    schema: z.object({
      parentId: z.string().optional().describe('父节点ID，应该从 context.selectedNodes[0].id 获取，不提供则添加到根节点'),
      label: z.string().describe('节点显示文本（必填）'),
      palaceId: z.string().optional().describe('关联的记忆宫殿ID（可选）'),
    }),
  }
)

// ========== 添加 Palace 节点 ==========
const addPalaceNodeTool = tool(
  async ({ parentId, label, imageUrl, stations, sourceNodeIds }) => {
    if (!label.trim()) {
      return { ok: false, error: '宫殿名称不能为空' }
    }
    if (!stations || stations.length === 0) {
      return { ok: false, error: '宫殿必须包含至少一个站点' }
    }

    return {
      ok: true,
      action: 'addNode',
      data: {
        type: 'palace' as const,
        parentId: parentId || undefined,
        nodeData: {
          label: label.trim(),
          imageUrl: imageUrl || '',
          stations: stations.map((s, index) => ({
            order: s.order ?? index + 1,
            content: s.content,
            anchorVisual: s.anchorVisual || '',
            association: s.association,
            x: s.x ?? 0,
            y: s.y ?? 0,
            linkedNodeId: s.linkedNodeId,
          })),
          sourceNodeIds: sourceNodeIds || [],
        },
      },
    }
  },
  {
    name: 'addPalaceNode',
    description: '在思维导图中添加一个记忆宫殿节点。记忆宫殿包含多个站点，每个站点关联一个记忆内容。',
    schema: z.object({
      parentId: z.string().optional().describe('父节点ID，不提供则添加到根节点'),
      label: z.string().describe('宫殿名称（必填）'),
      imageUrl: z.string().optional().describe('宫殿图片URL'),
      stations: z.array(z.object({
        order: z.number().optional().describe('站点顺序号'),
        content: z.string().describe('站点记忆内容'),
        anchorVisual: z.string().optional().describe('锚点视觉形象'),
        association: z.string().optional().describe('联想关联内容'),
        x: z.number().optional().describe('在图片中的X坐标'),
        y: z.number().optional().describe('在图片中的Y坐标'),
        linkedNodeId: z.string().describe('关联的节点ID'),
      })).describe('宫殿站点列表（必填）'),
      sourceNodeIds: z.array(z.string()).optional().describe('来源节点ID列表'),
    }),
  }
)

// ========== 更新节点 ==========
const updateNodeTool = tool(
  async ({ nodeId, nodeType, changes }) => {
    if (!nodeId.trim()) {
      return { ok: false, error: '节点ID不能为空' }
    }

    // 根据节点类型验证字段
    const validatedChanges: Record<string, unknown> = {}

    switch (nodeType) {
      case 'text': {
        const textChanges = changes as { label?: string; palaceId?: string }
        if (textChanges.label !== undefined) {
          validatedChanges.label = textChanges.label
        }
        if (textChanges.palaceId !== undefined) {
          validatedChanges.palaceId = textChanges.palaceId
        }
        break
      }
      case 'palace': {
        const palaceChanges = changes as {
          label?: string
          imageUrl?: string
          stations?: unknown[]
          sourceNodeIds?: string[]
        }
        if (palaceChanges.label !== undefined) {
          validatedChanges.label = palaceChanges.label
        }
        if (palaceChanges.imageUrl !== undefined) {
          validatedChanges.imageUrl = palaceChanges.imageUrl
        }
        if (palaceChanges.stations !== undefined) {
          validatedChanges.stations = palaceChanges.stations
        }
        if (palaceChanges.sourceNodeIds !== undefined) {
          validatedChanges.sourceNodeIds = palaceChanges.sourceNodeIds
        }
        break
      }
      default:
        return { ok: false, error: `不支持的节点类型: ${nodeType}` }
    }

    return {
      ok: true,
      action: 'updateNode',
      data: { nodeId, nodeType, changes: validatedChanges },
    }
  },
  {
    name: 'updateMindmapNode',
    description: '更新指定思维导图节点的属性。根据节点类型不同，可更新的字段也不同。',
    schema: z.object({
      nodeId: z.string().describe('要更新的节点ID（必填）'),
      nodeType: z.enum(['text', 'palace']).describe('节点类型（必填）'),
      changes: z.record(z.unknown()).describe('要更新的字段对象'),
    }),
  }
)

// ========== 删除节点 ==========
const deleteNodeTool = tool(
  async ({ nodeId, confirmDeleteSubtree }) => {
    if (!nodeId.trim()) {
      return { ok: false, error: '节点ID不能为空' }
    }

    return {
      ok: true,
      action: 'deleteNode',
      data: {
        nodeId,
        confirmDeleteSubtree: confirmDeleteSubtree ?? true,
      },
    }
  },
  {
    name: 'deleteMindmapNode',
    description: '删除指定的思维导图节点。如果该节点有子节点，默认会一并删除其子树。',
    schema: z.object({
      nodeId: z.string().describe('要删除的节点ID（必填）'),
      confirmDeleteSubtree: z.boolean().optional().describe('是否确认删除子树，默认为true'),
    }),
  }
)

// ========== 批量操作 ==========
const batchAddNodesTool = tool(
  async ({ nodes, edges }) => {
    if (!nodes || nodes.length === 0) {
      return { ok: false, error: '节点列表不能为空' }
    }

    return {
      ok: true,
      action: 'batchAddNodes',
      data: {
        nodes: nodes.map(n => ({
          type: n.type,
          parentId: n.parentId,
          nodeData: n.nodeData,
        })),
        edges: edges || [],
      },
    }
  },
  {
    name: 'batchAddMindmapNodes',
    description: '批量添加多个节点和边，用于生成完整的思维导图结构。',
    schema: z.object({
      nodes: z.array(z.object({
        type: z.enum(['text', 'palace']).describe('节点类型'),
        parentId: z.string().optional().describe('父节点ID'),
        nodeData: z.record(z.unknown()).describe('节点数据'),
      })).describe('节点列表'),
      edges: z.array(z.object({
        source: z.string().describe('源节点ID'),
        target: z.string().describe('目标节点ID'),
      })).optional().describe('边列表'),
    }),
  }
)

// 导出工具创建函数
export function createMindmapActionTools() {
  return {
    addTextNodeTool,
    addPalaceNodeTool,
    updateNodeTool,
    deleteNodeTool,
    batchAddNodesTool,
  }
}

// 导出类型供前端使用
export type MindmapActionResult =
  | { ok: true; action: 'addNode'; data: { type: string; parentId?: string; nodeData: Record<string, unknown> } }
  | { ok: true; action: 'updateNode'; data: { nodeId: string; nodeType: string; changes: Record<string, unknown> } }
  | { ok: true; action: 'deleteNode'; data: { nodeId: string; confirmDeleteSubtree: boolean } }
  | { ok: true; action: 'batchAddNodes'; data: { nodes: unknown[]; edges?: unknown[] } }
  | { ok: false; error: string }
