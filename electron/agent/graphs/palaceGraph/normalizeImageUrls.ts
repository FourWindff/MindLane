import { urlToDataUrl } from '../../providers/index.js'
import type { PalaceSubgraphStateType } from '../../state.js'

/**
 * Convert every remote image URL in the Palace subgraph into a data URL.
 *
 * - URLs already starting with data: are kept as is
 * - A failed conversion keeps the original URL as a fallback
 * - An errored state returns the original imageUrls unchanged
 * - An empty imageUrls returns an empty array
 */
export async function normalizePalaceImageUrls(
  state: Pick<PalaceSubgraphStateType, 'palaceError' | 'imageUrls'>,
): Promise<Pick<PalaceSubgraphStateType, 'imageUrls'>> {
  if (state.palaceError || state.imageUrls.length === 0) {
    return { imageUrls: state.imageUrls }
  }

  const normalized = await Promise.all(
    state.imageUrls.map(async (url) => {
      if (url.startsWith('data:')) return url
      try {
        return await urlToDataUrl(url)
      } catch {
        return url
      }
    }),
  )

  return { imageUrls: normalized }
}
