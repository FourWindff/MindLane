import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

const RouteDecisionSchema = z.object({
  target: z.enum(['qa', 'mindmap', 'palace']),
  reason: z.string().optional(),
  parameters: z
    .object({
      mindmapInput: z.string().optional(),
      mindmapTitle: z.string().optional(),
      palaceInput: z.string().optional(),
    })
    .optional(),
})

export type RouteDecision = z.infer<typeof RouteDecisionSchema>

export const routeDecisionTool = new DynamicStructuredTool({
  name: 'routeDecision',
  description:
    '根据用户请求决定执行的操作。当用户想要生成思维导图或梳理知识结构时设置 target="mindmap"；' +
    '当用户想要生成记忆宫殿或进行记忆训练时设置 target="palace"；' +
    '如果只是普通问答，不要调用此工具，直接回复用户即可。',
  schema: RouteDecisionSchema,
  func: async () => '路由决策已记录',
})
