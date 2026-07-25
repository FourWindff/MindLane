import fs from 'node:fs'
import path from 'node:path'
import { atomicWrite } from '../../fs/atomicWrite.js'

export class MemoryManager {
  private dir: string
  private indexPath: string

  constructor(userDataPath: string) {
    this.dir = path.join(userDataPath, 'mindlanememory')
    this.indexPath = path.join(this.dir, 'MEMORY.md')
  }

  async loadIndex(): Promise<string> {
    try {
      return await fs.promises.readFile(this.indexPath, 'utf-8')
    } catch {
      return ''
    }
  }

  async loadMemoriesForTags(tags: string[]): Promise<string[]> {
    const files = await this.listFiles()
    const results: string[] = []
    for (const file of files) {
      const content = await fs.promises.readFile(path.join(this.dir, file), 'utf-8')
      const { tag } = this.parseFrontmatter(content)
      if (tag && tags.some((t) => tag.startsWith(t))) {
        const body = this.extractBody(content)
        results.push(`--- ${tag} ---\n${body}`)
      }
    }
    return results
  }

  async writeMemory(
    tag: string,
    description: string,
    content: string,
    options?: { skipIndexRebuild?: boolean },
  ): Promise<void> {
    await fs.promises.mkdir(this.dir, { recursive: true })
    const fp = path.join(this.dir, `${tag}.md`)
    let body = ''
    try {
      body = this.extractBody(await fs.promises.readFile(fp, 'utf-8'))
    } catch {
      /* new file */
    }
    const newBody = body ? `${body}\n\n${content}` : content
    await atomicWrite(fp, `---\ntag: ${tag}\ndescription: ${description}\n---\n\n${newBody}`)
    if (!options?.skipIndexRebuild) {
      await this.rebuildIndex()
    }
  }

  async rebuildIndex(): Promise<void> {
    const lines: string[] = []
    for (const file of await this.listFiles()) {
      const content = await fs.promises.readFile(path.join(this.dir, file), 'utf-8')
      const { tag, description } = this.parseFrontmatter(content)
      if (tag && description) lines.push(`- [${tag}](${file}) — ${description}`)
    }
    await atomicWrite(this.indexPath, lines.join('\n') + '\n')
  }

  /** List all existing memory tags (from file frontmatter), for subTag reuse-first prompting. */
  async listTags(): Promise<string[]> {
    const tags: string[] = []
    for (const file of await this.listFiles()) {
      const content = await fs.promises.readFile(path.join(this.dir, file), 'utf-8')
      const { tag } = this.parseFrontmatter(content)
      if (tag) tags.push(tag)
    }
    return tags
  }

  private async listFiles(): Promise<string[]> {
    try {
      return (await fs.promises.readdir(this.dir)).filter(
        (e) => e.endsWith('.md') && e !== 'MEMORY.md',
      )
    } catch {
      return []
    }
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
}
