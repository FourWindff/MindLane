/**
 * asset 工具：data URL ↔ MindlaneAsset（sha256 去重键）。
 * 图片在插入/生成时即转 base64 内嵌（PRD 4.1）；文件因此自包含。
 */

import type { MindlaneAsset } from './types.js'

/** 解析 data URL → { mime, data(base64) }；非 data URL 返回 null。 */
export function parseDataUrl(dataUrl: string): { mime: string; data: string } | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match) return null
  return { mime: match[1] || 'image/png', data: match[3] ?? '' }
}

/** sha256 hex（渲染层 crypto.subtle / 主进程 node:crypto）。 */
export async function sha256Hex(data: string): Promise<string> {
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
  throw new Error('当前环境不支持 sha256')
}

/** 从 data URL 构建 asset（id 由调用方决定/去重）。 */
export async function assetFromDataUrl(dataUrl: string): Promise<MindlaneAsset | null> {
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) return null
  return {
    id: crypto.randomUUID(),
    mime: parsed.mime,
    sha256: await sha256Hex(parsed.data),
    data: parsed.data,
  }
}

/** 渲染层 DataURL：把 asset 拼回 `<img src>` 可用形式。 */
export function assetToDataUrl(asset: Pick<MindlaneAsset, 'mime' | 'data'>): string {
  return `data:${asset.mime};base64,${asset.data}`
}
