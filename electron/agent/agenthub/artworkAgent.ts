import type { PalaceSubgraphStateType } from '../state.js'
import { resolveArtworkStyle } from '../../../contracts/palaceArtworkStyle.js'
import { parseXmlStrict } from '../../../contracts/mindmapXml/parser.js'
import { urlToDataUrl } from '../providers/index.js'
import { buildSvgArtworkMessages } from './prompts/svgArtwork.js'
import { buildImagePromptGeneratorMessages } from './prompts/textToPalace.js'
import { buildPalaceImagePrompt } from './prompts/nodesToPalace.js'
import type { RouteStyle } from './palaceLayout.js'
import { PalaceAgent } from './base.js'
import { messageContentToString, formatAgentError } from '../utils.js'
import { logger } from '../../shared/logger.js'

/** The palace design the artwork is drawn from (stations + scene description). */
type PalaceDesign = NonNullable<PalaceSubgraphStateType['palace']>

/**
 * Pull the first SVG block out of a model reply. There is no viewBox or
 * station-marker requirement left (the gates are gone); the artwork is only
 * decoration.
 */
export function extractSvgArtwork(text: string): string | null {
  const match = text.match(/<svg\b[\s\S]*?<\/svg>/i)
  return match ? match[0] : null
}

/** The one check left: a block that cannot even be parsed is not artwork. */
function isParseableSvg(svg: string): boolean {
  try {
    parseXmlStrict(svg)
    return true
  } catch {
    return false
  }
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}

/**
 * Data URL form of the artwork reference, or undefined when it cannot be read:
 * a palace without artwork is a successful palace.
 */
export async function toArtworkDataUrl(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined
  if (url.startsWith('data:')) return url
  try {
    return await urlToDataUrl(url)
  } catch {
    return undefined
  }
}

/**
 * ArtworkAgent - the palace's single artwork pipeline.
 *
 * The artwork is optional decoration: it carries no station coordinates (the
 * canonical layout is the only coordinate producer) and no validation gate.
 * Whichever ingredient is configured — the chat model's schematic drawing or the
 * image model's background — the output is at most one image, and every failure
 * degrades to "no artwork" without failing the run.
 */
export class ArtworkAgent extends PalaceAgent {
  async invoke(state: PalaceSubgraphStateType): Promise<Partial<PalaceSubgraphStateType>> {
    if (!state.palace || state.palaceError) return {}

    const style = resolveArtworkStyle(state.artworkStyle, this.provider.capabilities)
    try {
      const raw =
        style === 'raster'
          ? await this.generateBitmap(state.palace)
          : await this.drawVector(state.palace)
      return { imageUrl: await toArtworkDataUrl(raw) }
    } catch (error) {
      logger
        .withContext('ArtworkAgent')
        .warn(
          'artwork generation failed; landing a palace without an image:\n',
          formatAgentError(error),
        )
      return { imageUrl: undefined }
    }
  }

  /** Vector carrier: the chat model draws a schematic; only an SVG block is kept. */
  private async drawVector(palace: PalaceDesign): Promise<string | undefined> {
    const response = await this.provider.model.invoke(
      buildSvgArtworkMessages({
        theme: palace.theme,
        sceneBrief: palace.sceneBrief,
        routeStyle: palace.routeStyle,
        stations: palace.stations,
      }),
    )
    const svg = extractSvgArtwork(messageContentToString(response.content))
    if (!svg || !isParseableSvg(svg)) {
      logger
        .withContext('ArtworkAgent')
        .warn('no usable SVG block in the drawing reply; landing a palace without an image')
      return undefined
    }
    return svgToDataUrl(svg)
  }

  /** Bitmap carrier: the image model produces one background picture. */
  private async generateBitmap(palace: PalaceDesign): Promise<string | undefined> {
    let imagePrompt: string
    if (palace.sceneBrief && palace.routeStyle) {
      imagePrompt = buildPalaceImagePrompt({
        theme: palace.theme,
        sceneBrief: palace.sceneBrief,
        routeStyle: palace.routeStyle as RouteStyle,
        stations: palace.stations,
      })
    } else {
      const promptResponse = await this.provider.model.invoke(
        buildImagePromptGeneratorMessages(palace),
      )
      imagePrompt = messageContentToString(promptResponse.content).trim()
    }

    if (!imagePrompt) return undefined

    const imageResult = await this.provider.generateImage({
      prompt: imagePrompt,
      size: '1024*1024',
      n: 1,
    })
    return imageResult.urls[0]
  }
}
