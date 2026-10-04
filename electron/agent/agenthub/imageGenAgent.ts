import type { PalaceSubgraphStateType } from '../state.js'
import { buildImagePromptGeneratorMessages } from './prompts/textToPalace.js'
import { buildPalaceImagePrompt } from './prompts/nodesToPalace.js'
import { PalaceAgent } from './base.js'
import { logger } from '../../shared/logger.js'
import { formatAgentError } from '../utils.js'

/**
 * ImageGenAgent - image generation agent.
 *
 * Architectural responsibilities:
 * 1. Generate an image prompt from the memory palace design.
 * 2. Call the LLM provider's image generation capability.
 * 3. Return the URL of the generated image.
 *
 * Stateless design:
 * - No persistent memory access.
 * - All input travels through state.palace.
 * - Outputs imagePrompt and imageUrls.
 */
export class ImageGenAgent extends PalaceAgent {
  async invoke(state: PalaceSubgraphStateType): Promise<Partial<PalaceSubgraphStateType>> {
    if (!state.palace || state.palaceError) return {}

    try {
      let imagePrompt: string

      // With a preset scene brief and route style, build the prompt directly
      if (state.palace.sceneBrief && state.palace.routeStyle) {
        imagePrompt = buildPalaceImagePrompt({
          theme: state.palace.theme,
          sceneBrief: state.palace.sceneBrief,
          routeStyle: state.palace.routeStyle as 'arc' | 's_curve' | 'zigzag' | 'loop' | 'stairs',
          stations: state.palace.stations,
        })
      } else {
        // Otherwise let the LLM generate the prompt
        const promptResponse = await this.provider.model.invoke(
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
      logger.withContext('ImageGenAgent').error('Image generation failed:', formatted)
      return {
        imagePrompt: '',
        imageUrls: [],
        imageError: formatted,
      }
    }
  }
}
