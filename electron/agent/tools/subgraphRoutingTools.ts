import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

export const GENERATE_MINDMAP_FRAGMENT_TOOL = 'generateMindmapFragment'
export const GENERATE_PALACE_TOOL = 'generatePalace'

export function createGenerateMindmapFragmentTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: GENERATE_MINDMAP_FRAGMENT_TOOL,
    description:
      '从当前附加文档或用户输入生成一个思维导图 XML 片段（<node type="text" content="…"> 嵌套）。该工具不需要参数；系统会自动从当前上下文选择输入来源。得到结果后你需要根据当前思维导图上下文再调用 insertXmlFragment 选择插入位置。' +
      '何时用本工具：需要解析附件文档、URL，或需要归纳长文本时。' +
      '何时不用：短内容（一句需求、几个要点）自己直接写出 XML 并调用 insertXmlFragment 落图，不必等这一整套流程。',
    schema: z.object({}).strict(),
    func: async () => '',
  })
}

export function createGeneratePalaceTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: GENERATE_PALACE_TOOL,
    description:
      '根据当前选中的节点、用户输入或附加文档生成记忆宫殿设计。该工具不需要参数；系统会自动从当前上下文选择输入来源，生成完成后按选中节点所在的层级自动落图（你不需要再调用 insertXmlFragment 放置宫殿，只需向用户说明结果）。',
    schema: z.object({}).strict(),
    func: async () => '',
  })
}
