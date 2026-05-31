import fs from 'node:fs'
import path from 'node:path'

const THRESHOLDS = { maxParagraphs: 50, maxFiles: 30, maxDays: 7 }

export class MemoryManager {
  private dir: string
  private indexPath: string

  constructor(userDataPath: string) {
    this.dir = path.join(userDataPath, 'mindlanememory')
    this.indexPath = path.join(this.dir, 'MEMORY.md')
  }

  async loadIndex(): Promise<string> {
    try { return await fs.promises.readFile(this.indexPath, 'utf-8') }
    catch { return '' }
  }

  async loadMemoriesForTags(tags: string[]): Promise<string[]> {
    const results: string[] = []
    for (const file of await this.listFiles()) {
      const { tag } = await this.readFrontmatter(file)
      if (tag && tags.some(t => tag.startsWith(t))) {
        const body = this.extractBody(await fs.promises.readFile(path.join(this.dir, file), 'utf-8'))
        results.push(`--- ${tag} ---\n${body}`)
      }
    }
    return results
  }

  async writeMemory(tag: string, description: string, content: string): Promise<void> {
    await fs.promises.mkdir(this.dir, { recursive: true })
    const fp = path.join(this.dir, `${tag}.md`)
    let body = ''
    try { body = this.extractBody(await fs.promises.readFile(fp, 'utf-8')) }
    catch { /* new file */ }
    const newBody = body ? `${body}\n\n${content}` : content
    await this.atomicWrite(fp, `---\ntag: ${tag}\ndescription: ${description}\n---\n\n${newBody}`)
    await this.rebuildIndex()
  }

  async rebuildIndex(): Promise<void> {
    const lines: string[] = []
    for (const file of await this.listFiles()) {
      const { tag, description } = await this.readFrontmatter(file)
      if (tag && description) lines.push(`- [${tag}](${file}) — ${description}`)
    }
    await this.atomicWrite(this.indexPath, lines.join('\n') + '\n')
  }

  async shouldConsolidate(): Promise<boolean> {
    const files = await this.listFiles()
    if (files.length > THRESHOLDS.maxFiles) return true
    for (const f of files) {
      const content = await fs.promises.readFile(path.join(this.dir, f), 'utf-8')
      if (this.extractBody(content).split(/\n\n+/).filter(p => p.trim()).length > THRESHOLDS.maxParagraphs)
        return true
    }
    try {
      const stat = await fs.promises.stat(path.join(this.dir, '.last-consolidated'))
      if ((Date.now() - stat.mtimeMs) / 86400000 > THRESHOLDS.maxDays) return true
    } catch { if (files.length > 0) return true }
    return false
  }

  async consolidate(): Promise<void> {
    await fs.promises.writeFile(path.join(this.dir, '.last-consolidated'), String(Date.now()))
  }

  private async listFiles(): Promise<string[]> {
    try { return (await fs.promises.readdir(this.dir)).filter(e => e.endsWith('.md') && e !== 'MEMORY.md') }
    catch { return [] }
  }

  private async readFrontmatter(file: string): Promise<{ tag?: string; description?: string }> {
    try { return this.parseFrontmatter(await fs.promises.readFile(path.join(this.dir, file), 'utf-8')) }
    catch { return {} }
  }

  private parseFrontmatter(content: string): { tag?: string; description?: string } {
    const m = content.match(/^---\n([\s\S]*?)\n---/)
    if (!m) return {}
    const tag = m[1].match(/^tag:\s*(.+)$/m)?.[1]?.trim()
    const description = m[1].match(/^description:\s*(.+)$/m)?.[1]?.trim()
    return { tag, description }
  }

  private extractBody(content: string): string {
    const m = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/)
    return m ? m[1].trim() : content.trim()
  }

  private async atomicWrite(target: string, content: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    const tmp = target + '.tmp.' + Date.now()
    await fs.promises.writeFile(tmp, content, 'utf-8')
    await fs.promises.rename(tmp, target)
  }
}
