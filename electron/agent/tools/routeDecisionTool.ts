import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

type RouteTarget = 'qa' | 'mindmap' | 'palace'

function createRouteDecisionSchema(hasPalace: boolean) {
  const targets: RouteTarget[] = hasPalace
    ? ['qa', 'mindmap', 'palace']
    : ['qa', 'mindmap']
  return z.object({
    target: z.enum(targets as [RouteTarget, ...RouteTarget[]]),
    reason: z.string().optional(),
    parameters: z
      .object({
        mindmapInput: z.string().optional(),
        mindmapTitle: z.string().optional(),
        palaceInput: z.string().optional(),
        mindmapSource: z
          .object({
            type: z.enum(['pdf', 'url']),
            path: z.string().optional(),
            url: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
  })
}

export type RouteDecision = {
  target: RouteTarget
  reason?: string
  parameters?: {
    mindmapInput?: string
    mindmapTitle?: string
    palaceInput?: string
    mindmapSource?: { type: 'pdf' | 'url'; path?: string; url?: string }
  }
}

/**
 * 创建路由决策工具。
 *
 * func 是占位符 —— 该工具的实际调用在 MindLaneAgent.invoke() 中被拦截处理，
 * 永远不会进入 ToolNode 执行。DynamicStructuredTool 要求 func 非空，故返回空字符串。
 */
export function createRouteDecisionTool(hasPalace: boolean): DynamicStructuredTool {
  const routes = [
    '当用户想要生成思维导图、梳理知识结构，或已附加文档需要基于文档内容生成思维导图时设置 target="mindmap"',
  ]
  if (hasPalace) {
    routes.push('当用户想要生成记忆宫殿或进行记忆训练时设置 target="palace"')
  }
  routes.push('如果只是普通问答，不要调用此工具，直接回复用户即可。')

  return new DynamicStructuredTool({
    name: 'routeDecision',
    description: '根据用户请求决定执行的操作。' + routes.join('；') + '。',
    schema: createRouteDecisionSchema(hasPalace),
    func: async () => '',
  })
}
