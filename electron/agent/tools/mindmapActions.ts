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
    description: '在思维导图中添加一个新的文本节点。parentId 可以从上下文的思维导图节点树中推断（每个节点都标注了 id），如果没有明确的父节点则不提供 parentId（会添加到根节点）。',
    schema: z.object({
      parentId: z.string().optional().describe('父节点ID，可以从上下文的节点树中根据节点标签推断得到，不提供则添加到根节点'),
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
      parentId: z.string().optional().describe('父节点ID，可以从上下文的节点树中根据节点标签推断得到，不提供则添加到根节点'),
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
    description: '更新指定思维导图节点的属性。nodeId 可以从上下文的思维导图节点树中推断（每个节点都标注了 id）。',
    schema: z.object({
      nodeId: z.string().describe('要更新的节点ID，可以从上下文的节点树中根据节点标签推断得到'),
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
    description: '删除指定的思维导图节点。nodeId 可以从上下文的思维导图节点树中推断（每个节点都标注了 id）。如果该节点有子节点，默认会一并删除其子树。',
    schema: z.object({
      nodeId: z.string().describe('要删除的节点ID，可以从上下文的节点树中根据节点标签推断得到'),
      confirmDeleteSubtree: z.boolean().optional().describe('是否确认删除子树，默认为true'),
    }),
  }
)

// ========== 批量操作 ==========
const batchAddNodesTool = tool(
  async ({ yamlFragment, parentId }) => {
    if (!yamlFragment || !yamlFragment.trim()) {
      return { ok: false, error: 'YAML 片段不能为空' }
    }

    return {
      ok: true,
      action: 'batchAddNodes',
      data: {
        yamlFragment: yamlFragment.trim(),
        parentId: parentId || undefined,
      },
    }
  },
  {
    name: 'batchAddMindmapNodes',
    description: `批量添加多个节点到思维导图中。你只需提供一个 YAML 格式的大纲片段，系统会自动解析并插入到指定父节点下方。

重要规则：
1. 如果要扩展现有节点，YAML 片段应直接列出要添加的子节点，不要包含父节点本身的名称。
2. 可以直接提供子节点列表（不需要顶层根节点包裹）。

扩展现有节点的正确示例（parentId 指向已有节点）：
- "Z-Score 标准化":
    - "公式：z = (x-μ)/σ"
    - "适用场景"
- "Min-Max 归一化"

错误示例（不要这样写，会导致父节点重复）：
- "标准化数值变量":       ← 不要包含父节点本身
    - "Z-Score 标准化"

每个条目是一个字符串（无子节点）或一个键值对（键为节点标签，值为子节点数组）。
如果不提供 parentId，节点将插入到当前选中的节点或根节点下方。`,
    schema: z.object({
      yamlFragment: z.string().describe('YAML 格式的大纲片段，描述要添加的节点结构'),
      parentId: z.string().optional().describe('父节点ID，不提供则插入到当前选中节点或根节点'),
    }),
  }
)

export type MindmapActionTools = {
  addTextNodeTool: typeof addTextNodeTool
  updateNodeTool: typeof updateNodeTool
  deleteNodeTool: typeof deleteNodeTool
  batchAddNodesTool: typeof batchAddNodesTool
  addPalaceNodeTool?: typeof addPalaceNodeTool
}

// 导出工具创建函数
export function createMindmapActionTools(hasPalace = true): MindmapActionTools {
  const tools: MindmapActionTools = {
    addTextNodeTool,
    updateNodeTool,
    deleteNodeTool,
    batchAddNodesTool,
  }
  if (hasPalace) {
    tools.addPalaceNodeTool = addPalaceNodeTool
  }
  return tools
}

