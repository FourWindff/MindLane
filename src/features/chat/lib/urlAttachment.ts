import type { DocumentRef } from '@/shared/lib/fileFormat'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/** Display cap for the paste-validation filename: over-long links truncate mid-way, keeping host and tail. */
const FILENAME_MAX = 28
const FILENAME_HEAD = 14
const FILENAME_TAIL = 12

/**
 * Validate a user-pasted link and normalize it. Returns the normalized URL
 * when constructable and http/https, otherwise null (empty, no scheme,
 * non-http(s) scheme).
 */
export function validateUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null
  return url.href
}

/** Compact display form for the chip: host + path, truncated mid-way when over-long. */
export function formatUrlFilename(url: string): string {
  let display: string
  try {
    const parsed = new URL(url)
    display = parsed.host + parsed.pathname
  } catch {
    display = url
  }
  if (display.length <= FILENAME_MAX) return display
  return `${display.slice(0, FILENAME_HEAD)}…${display.slice(-FILENAME_TAIL)}`
}

/**
 * Build the DocumentRef for a URL attachment. `source` is the full URL,
 * `filename` the compact display form; sha256 is computed by the main-process
 * prepare stage from the fetched content, so it is not provided here.
 */
export function createUrlDocumentRef(url: string): DocumentRef {
  return {
    id: `url_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'url',
    source: url,
    filename: formatUrlFilename(url),
    importedAt: new Date().toISOString(),
  }
}
