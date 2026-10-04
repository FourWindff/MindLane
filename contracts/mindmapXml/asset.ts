/**
 * asset helpers: data URL ↔ MindLaneAsset (sha256 as the dedup key).
 * Images are converted to embedded base64 at insert/generation time (PRD 4.1),
 * so files are self-contained.
 */

import type { MindLaneAsset } from './types.js'

/** Parse a data URL → { mime, data(base64) }; returns null for a non-data URL. */
export function parseDataUrl(dataUrl: string): { mime: string; data: string } | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match) return null
  return { mime: match[1] || 'image/png', data: match[3] ?? '' }
}

/** sha256 hex (renderer crypto.subtle / main-process node:crypto). */
async function sha256Hex(data: string): Promise<string> {
  const globalNode = globalThis as { require?: (id: string) => unknown }
  if (typeof globalNode.require === 'function') {
    const crypto = globalNode.require('node:crypto') as {
      createHash: (alg: string) => { update: (d: string) => { digest: (enc: string) => string } }
    }
    return crypto.createHash('sha256').update(data).digest('hex')
  }
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const bytes = new TextEncoder().encode(data)
    const digest = await subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  throw new Error('sha256 is not supported in this environment')
}

/** Build an asset from a data URL (the caller decides/dedupes the id). */
export async function assetFromDataUrl(dataUrl: string): Promise<MindLaneAsset | null> {
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) return null
  return {
    id: crypto.randomUUID(),
    mime: parsed.mime,
    sha256: await sha256Hex(parsed.data),
    data: parsed.data,
  }
}

/** Renderer DataURL: reassemble the asset into a form usable by `<img src>`. */
export function assetToDataUrl(asset: Pick<MindLaneAsset, 'mime' | 'data'>): string {
  return `data:${asset.mime};base64,${asset.data}`
}
