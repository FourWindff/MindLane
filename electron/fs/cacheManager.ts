import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export class CacheManager {
  private imagesDir: string
  private documentsDir: string

  constructor(cacheDir: string) {
    this.imagesDir = path.join(cacheDir, 'images')
    this.documentsDir = path.join(cacheDir, 'documents')
  }

  async initialize(): Promise<void> {
    await fs.promises.mkdir(this.imagesDir, { recursive: true })
    await fs.promises.mkdir(this.documentsDir, { recursive: true })
  }

  async cacheImage(remoteUrl: string): Promise<string> {
    const ext = this.extractExt(remoteUrl, '.png')
    const hash = this.hashString(remoteUrl)
    const filename = `${hash}${ext}`
    const localPath = path.join(this.imagesDir, filename)

    if (fs.existsSync(localPath)) return localPath

    const res = await fetch(remoteUrl)
    if (!res.ok) throw new Error(`Failed to download image: HTTP ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    await fs.promises.writeFile(localPath, buffer)
    return localPath
  }

  getImagePath(hash: string): string {
    return path.join(this.imagesDir, hash)
  }

  async cacheDocumentText(docId: string, text: string): Promise<string> {
    const filePath = path.join(this.documentsDir, `${docId}.txt`)
    await fs.promises.writeFile(filePath, text, 'utf-8')
    return filePath
  }

  async readDocumentText(docId: string): Promise<string | null> {
    const filePath = path.join(this.documentsDir, `${docId}.txt`)
    try {
      return await fs.promises.readFile(filePath, 'utf-8')
    } catch {
      return null
    }
  }

  async pruneOldCache(maxAgeDays: number): Promise<{ removed: number }> {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    let removed = 0
    for (const dir of [this.imagesDir, this.documentsDir]) {
      try {
        const entries = await fs.promises.readdir(dir)
        for (const entry of entries) {
          const fullPath = path.join(dir, entry)
          try {
            const stat = await fs.promises.stat(fullPath)
            if (stat.mtimeMs < cutoff) {
              await fs.promises.unlink(fullPath)
              removed++
            }
          } catch {
            /* skip */
          }
        }
      } catch {
        /* directory may not exist */
      }
    }
    return { removed }
  }

  async getCacheSize(): Promise<number> {
    let total = 0
    for (const dir of [this.imagesDir, this.documentsDir]) {
      try {
        const entries = await fs.promises.readdir(dir)
        for (const entry of entries) {
          try {
            const stat = await fs.promises.stat(path.join(dir, entry))
            total += stat.size
          } catch {
            /* skip */
          }
        }
      } catch {
        /* skip */
      }
    }
    return total
  }

  private hashString(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16)
  }

  private extractExt(url: string, fallback: string): string {
    try {
      const pathname = new URL(url).pathname
      const ext = path.extname(pathname)
      if (ext && ext.length <= 5) return ext
    } catch {
      /* ignore */
    }
    return fallback
  }
}
