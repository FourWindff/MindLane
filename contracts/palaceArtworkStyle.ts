export type PalaceArtworkStyle = 'vector' | 'raster'

/** Resolve the requested palace carrier against the active provider's abilities. */
export function resolveArtworkStyle(
  preference: PalaceArtworkStyle | undefined,
  capabilities: ReadonlySet<string>,
): PalaceArtworkStyle {
  return preference === 'raster' && capabilities.has('imageGen') ? 'raster' : 'vector'
}
