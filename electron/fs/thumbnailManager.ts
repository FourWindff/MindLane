import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export class ThumbnailManager {
  private thumbnailsDir: string

  constructor(userDataPath: string) {
    this.thumbnailsDir = path.join(userDataPath, 'thumbnails')
  }

  async initialize(): Promise<void> {
    await fs.promises.mkdir(this.thumbnailsDir, { recursive: true })
  }

  private hashPath(filePath: string): string {
    return crypto.createHash('sha256').update(filePath).digest('hex')
  }

  private thumbnailPath(filePath: string): string {
    return path.join(this.thumbnailsDir, `${this.hashPath(filePath)}.png`)
  }

  /** 保存缩略图，返回 DataURL */
  async save(filePath: string, imageData: string): Promise<string> {
    const targetPath = this.thumbnailPath(filePath)
    // imageData 格式: data:image/png;base64,iVBORw0KGgo...
    const base64Data = imageData.replace(/^data:image\/png;base64,/, '')
    await fs.promises.writeFile(targetPath, base64Data, 'base64')
    return imageData
  }

  /** 获取缩略图 DataURL，不存在返回 null */
  async get(filePath: string): Promise<string | null> {
    const targetPath = this.thumbnailPath(filePath)
    try {
      const data = await fs.promises.readFile(targetPath)
      const base64 = data.toString('base64')
      return `data:image/png;base64,${base64}`
    } catch {
      return null
    }
  }

  /** 删除指定文件的缩略图 */
  async delete(filePath: string): Promise<void> {
    const targetPath = this.thumbnailPath(filePath)
    try {
      await fs.promises.unlink(targetPath)
    } catch {
      // 静默忽略删除失败
    }
  }

  /** 清理所有孤儿缩略图 */
  async cleanup(validFilePaths: string[]): Promise<void> {
    const validHashes = new Set(validFilePaths.map((p) => this.hashPath(p)))
    try {
      const entries = await fs.promises.readdir(this.thumbnailsDir)
      for (const entry of entries) {
        if (!entry.endsWith('.png')) continue
        const hash = entry.slice(0, -4)
        if (!validHashes.has(hash)) {
          await fs.promises.unlink(path.join(this.thumbnailsDir, entry)).catch(() => {})
        }
      }
    } catch {
      // 静默忽略
    }
  }
}
