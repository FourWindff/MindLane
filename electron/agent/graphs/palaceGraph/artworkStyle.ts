import { ProviderCapability } from '../../providers/index.js'
import type { PalaceArtworkStyle } from '../../state.js'

/** Resolve the requested palace carrier against the active provider's abilities. */
export function resolveArtworkStyle(
  preference: PalaceArtworkStyle | undefined,
  capabilities: ReadonlySet<string>,
): PalaceArtworkStyle {
  if (preference === 'raster' && capabilities.has(ProviderCapability.ImageGen)) {
    return 'raster'
  }
  return 'vector'
}
