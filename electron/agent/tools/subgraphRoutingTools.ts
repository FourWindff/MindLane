import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

export const GENERATE_MINDMAP_FRAGMENT_TOOL = 'generateMindmapFragment'
export const GENERATE_PALACE_TOOL = 'generatePalace'

export function createGenerateMindmapFragmentTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: GENERATE_MINDMAP_FRAGMENT_TOOL,
    description:
      '从当前附加文档或用户输入生成一个思维导图 YAML 片段。该工具不需要参数；系统会自动从当前上下文选择输入来源。得到结果后你需要根据当前思维导图上下文再调用 batchAddMindmapNodes 选择插入位置。',
    schema: z.object({}).strict(),
    func: async () => '',
  })
}

export function createGeneratePalaceTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: GENERATE_PALACE_TOOL,
    description:
      '根据当前选中的节点、用户输入或附加文档生成记忆宫殿设计。该工具不需要参数；系统会自动从当前上下文选择输入来源。得到结果后你需要根据当前思维导图上下文再调用 addPalaceNode 选择插入位置。',
    schema: z.object({}).strict(),
    func: async () => '',
  })
}
