import type { LLMProvider } from '../providers/index.js'
import type { AgentState } from '../state.js'
import { buildImagePromptGeneratorMessages } from './prompts/textToPalace.js'
import { buildPalaceImagePrompt } from './prompts/nodesToPalace.js'

export class ImageGenAgent {
  constructor(private provider: LLMProvider) {}

  async invoke(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
    if (!state.palace || state.error) return {}

    try {
      let imagePrompt: string

      if (state.palace.sceneBrief && state.palace.routeStyle) {
        imagePrompt = buildPalaceImagePrompt({
          theme: state.palace.theme,
          sceneBrief: state.palace.sceneBrief,
          routeStyle: state.palace.routeStyle as 'arc' | 's_curve' | 'zigzag' | 'loop' | 'stairs',
          stations: state.palace.stations,
        })
      } else {
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
    } catch {
      return {
        imagePrompt: '',
        imageUrls: [],
      }
    }
  }
}
