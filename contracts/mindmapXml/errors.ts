import { MindmapXmlError } from './types.js'

/**
 * Format any error into a model-readable message; MindmapXmlError gets `[code] message`.
 * Recovery strategy lives in the `<MINDLANE_XML_CONTRACT>` system-prompt section, so it is
 * deliberately not repeated on every tool result.
 *
 * The main-process write service formats every landing failure with this, so the model
 * reads one vocabulary regardless of which write path failed.
 */
export function formatXmlError(err: unknown): string {
  if (err instanceof MindmapXmlError) {
    return `[${err.code}] ${err.message}`
  }
  return err instanceof Error ? err.message : String(err)
}
