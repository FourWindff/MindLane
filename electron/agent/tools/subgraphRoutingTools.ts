import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

export const GENERATE_MINDMAP_FRAGMENT_TOOL = 'generateMindmapFragment'
export const GENERATE_PALACE_TOOL = 'generatePalace'

const mindmapSourceSchema = z.object({
  type: z.enum(['pdf', 'url', 'text']),
  path: z.string().optional(),
  url: z.string().optional(),
  content: z.string().optional(),
})

const selectedNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
})

export type GenerateMindmapFragmentArgs = {
  source: z.infer<typeof mindmapSourceSchema>
  title?: string
}

export type GeneratePalaceArgs = {
  inputText?: string
  inputNodes?: Array<z.infer<typeof selectedNodeSchema>>
}

export function createGenerateMindmapFragmentTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: GENERATE_MINDMAP_FRAGMENT_TOOL,
    description:
      '从用户附加的文档、URL 或文本生成一个思维导图 YAML 片段。该工具只负责生成片段；得到结果后你需要根据当前思维导图上下文再调用 batchAddMindmapNodes 选择插入位置。',
    schema: z.object({
      source: mindmapSourceSchema.describe('生成思维导图的来源'),
      title: z.string().optional().describe('思维导图标题，可从文件名或用户请求推断'),
    }),
    func: async () => '',
  })
}

export function createGeneratePalaceTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: GENERATE_PALACE_TOOL,
    description:
      '根据文本或选中节点生成记忆宫殿设计。该工具只负责生成宫殿数据；得到结果后你需要根据当前思维导图上下文再调用 addPalaceNode 选择插入位置。',
    schema: z.object({
      inputText: z.string().optional().describe('用于生成记忆宫殿的文本内容'),
      inputNodes: z.array(selectedNodeSchema).optional().describe('用于生成记忆宫殿的选中节点'),
    }),
    func: async () => '',
  })
}

export function isVirtualSubgraphTool(name: string): boolean {
  return name === GENERATE_MINDMAP_FRAGMENT_TOOL || name === GENERATE_PALACE_TOOL
}
