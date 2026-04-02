import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'
import { runTextToPalace } from '../../workflows/textToPalace.js'
import type { LLMProvider } from '../providers/index.js'

export function createGeneratePalaceTool(apiKey: string, model: string, runtime: LLMProvider) {
  return tool(
    async ({ content }) => {
      try {
        const messages = [
          { role: 'user' as const, content },
        ]
        const result = await runTextToPalace({ apiKey, model, messages, runtime })

        if (!result.ok) return `生成记忆宫殿失败: ${result.error}`

        return JSON.stringify({
          success: true,
          content: result.content,
          hasImage: !!result.imageUrls?.length,
          stationCount: result.memoryRoute?.length ?? 0,
        })
      } catch (err) {
        return `生成记忆宫殿异常: ${err instanceof Error ? err.message : String(err)}`
      }
    },
    {
      name: 'generatePalace',
      description:
        '根据文本内容生成记忆宫殿。当用户要求使用记忆宫殿法、空间记忆法来记忆内容时使用。会生成包含场景图片和记忆站点的宫殿。',
      schema: z.object({
        content: z.string().describe('要生成记忆宫殿的内容'),
      }),
    },
  )
}
