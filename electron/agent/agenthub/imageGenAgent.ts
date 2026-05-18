import type { PalaceSubgraphStateType } from '../state.js'
import { buildImagePromptGeneratorMessages } from './prompts/textToPalace.js'
import { buildPalaceImagePrompt } from './prompts/nodesToPalace.js'
import { PalaceAgent } from './base.js'
import { logger } from '../../shared/logger.js'
import { formatAgentError } from '../utils.js'

/**
 * ImageGenAgent - 图像生成智能体
 *
 * 架构职责：
 * 1. 根据记忆宫殿设计生成图像提示词
 * 2. 调用 LLM Provider 的图像生成功能
 * 3. 返回生成的图像 URL
 *
 * 无状态设计：
 * - 不涉及持久化记忆访问
 * - 所有输入通过 state.palace 传递
 * - 输出 imagePrompt 和 imageUrls
 */
export class ImageGenAgent extends PalaceAgent {
  async invoke(state: PalaceSubgraphStateType): Promise<Partial<PalaceSubgraphStateType>> {
    if (!state.palace || state.error) return {}

    try {
      let imagePrompt: string

      // 如果有预设的场景描述和路线风格，直接构建提示词
      if (state.palace.sceneBrief && state.palace.routeStyle) {
        imagePrompt = buildPalaceImagePrompt({
          theme: state.palace.theme,
          sceneBrief: state.palace.sceneBrief,
          routeStyle: state.palace.routeStyle as 'arc' | 's_curve' | 'zigzag' | 'loop' | 'stairs',
          stations: state.palace.stations,
        })
      } else {
        // 否则使用 LLM 生成提示词
        const promptResponse = await this.provider.reasoningModel.invoke(
          buildImagePromptGeneratorMessages(state.palace),
        )
        imagePrompt =
          typeof promptResponse.content === 'string'
            ? promptResponse.content.trim()
            : String(promptResponse.content).trim()
      }

      if (!imagePrompt) {
        return { imagePrompt: '', imageUrls: [] }
      }

      const imageResult = await this.provider.generateImage({
        prompt: imagePrompt,
        size: '1024*1024',
        n: 1,
      })

      return {
        imagePrompt,
        imageUrls: imageResult.urls,
      }
    } catch (err) {
      const formatted = formatAgentError(err)
      logger.error('[ImageGenAgent] 图像生成失败:', formatted)
      return {
        imagePrompt: '',
        imageUrls: [],
        imageError: formatted,
      }
    }
  }
}
