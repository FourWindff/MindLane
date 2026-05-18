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

/**
 * 创建路由决策工具。
 *
 * func 是占位符 —— 该工具的实际调用在 MindLaneAgent.invoke() 中被拦截处理，
 * 永远不会进入 ToolNode 执行。DynamicStructuredTool 要求 func 非空，故返回空字符串。
 */
export function createRouteDecisionTool(hasPalace: boolean): DynamicStructuredTool {
  const routes = [
    '当用户想要生成思维导图或梳理知识结构时设置 target="mindmap"',
  ]
  if (hasPalace) {
    routes.push('当用户想要生成记忆宫殿或进行记忆训练时设置 target="palace"')
  }
  routes.push('如果只是普通问答，不要调用此工具，直接回复用户即可。')

  return new DynamicStructuredTool({
    name: 'routeDecision',
    description: '根据用户请求决定执行的操作。' + routes.join('；') + '。',
    schema: RouteDecisionSchema,
    func: async () => '',
  })
}
