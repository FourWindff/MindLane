import fs from 'node:fs'
import path from 'node:path'
import type { RecentFileEntry } from './types.js'

export class RecentFilesManager {
  private filePath: string
  private maxEntries: number

  constructor(userDataPath: string, maxEntries = 10) {
    this.filePath = path.join(userDataPath, 'recent-files.json')
    this.maxEntries = maxEntries
  }

  async touch(entry: Omit<RecentFileEntry, 'lastOpenedAt'>): Promise<void> {
    const list = await this.list()
    const filtered = list.filter((e) => e.filePath !== entry.filePath)
    filtered.unshift({
      ...entry,
      lastOpenedAt: new Date().toISOString(),
    })
    const trimmed = filtered.slice(0, this.maxEntries)
    await this.save(trimmed)
  }

  async list(): Promise<RecentFileEntry[]> {
    try {
      if (!fs.existsSync(this.filePath)) return []
      const raw = await fs.promises.readFile(this.filePath, 'utf-8')
      const arr = JSON.parse(raw) as unknown
      if (!Array.isArray(arr)) return []
      return arr.filter(
        (e): e is RecentFileEntry =>
          e != null &&
          typeof e === 'object' &&
          typeof (e as Record<string, unknown>).filePath === 'string' &&
          typeof (e as Record<string, unknown>).title === 'string',
      )
    } catch {
      return []
    }
  }

  async prune(): Promise<void> {
    const list = await this.list()
    const valid = list.filter((e) => {
      try {
        return fs.existsSync(e.filePath)
      } catch {
        return false
      }
    })
    if (valid.length !== list.length) {
      await this.save(valid)
    }
  }

  private async save(entries: RecentFileEntry[]): Promise<void> {
    const dir = path.dirname(this.filePath)
    await fs.promises.mkdir(dir, { recursive: true })
    const tmpPath = this.filePath + '.tmp.' + Date.now()
    await fs.promises.writeFile(tmpPath, JSON.stringify(entries, null, 2), 'utf-8')
    await fs.promises.rename(tmpPath, this.filePath)
  }
}
