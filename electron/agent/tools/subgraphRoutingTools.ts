import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

export const GENERATE_MINDMAP_FRAGMENT_TOOL = 'generateMindmapFragment'
export const GENERATE_PALACE_TOOL = 'generatePalace'

export function createGenerateMindmapFragmentTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: GENERATE_MINDMAP_FRAGMENT_TOOL,
    description:
      'Generate a mindmap XML fragment (nested <node type="text" content="…">) from the current attached document or the user input. The tool takes no arguments; the system picks the input source from the current context automatically. Once you have the result, call insertXmlFragment to choose the insertion position based on the current mindmap context.' +
      'When to use this tool: you need to parse an attached document or URL, or you need to summarize long text.' +
      'When not to use it: short content (a one-line request, a few bullet points) - write the XML yourself and call insertXmlFragment to land it, without waiting for the whole pipeline.',
    schema: z.object({}).strict(),
    func: async () => '',
  })
}

export function createGeneratePalaceTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: GENERATE_PALACE_TOOL,
    description:
      'Generate a memory palace design from the currently selected nodes, the user input or an attached document. The tool takes no arguments; the system picks the input source from the current context automatically, and once generation finishes it lands the palace at the level of the selected nodes (you do not need to call insertXmlFragment to place the palace; just explain the result to the user).',
    schema: z.object({}).strict(),
    func: async () => '',
  })
}
