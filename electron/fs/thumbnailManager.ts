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

  /** Save a thumbnail and return its DataURL */
  async save(filePath: string, imageData: string): Promise<string> {
    const targetPath = this.thumbnailPath(filePath)
    // imageData format: data:image/png;base64,iVBORw0KGgo...
    const base64Data = imageData.replace(/^data:image\/png;base64,/, '')
    await fs.promises.writeFile(targetPath, base64Data, 'base64')
    return imageData
  }

  /** Get the thumbnail DataURL, or null when it does not exist */
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

  /** Delete the thumbnail of the given file */
  async delete(filePath: string): Promise<void> {
    const targetPath = this.thumbnailPath(filePath)
    try {
      await fs.promises.unlink(targetPath)
    } catch {
      // Silently ignore deletion failures
    }
  }
}
