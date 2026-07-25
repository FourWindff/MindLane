import fs from 'node:fs'
import path from 'node:path'
import { atomicWrite } from '../../fs/atomicWrite.js'

export interface EditLogEntry {
  ts: number
  nodeId: string
  before: string
  after: string
}

/** Ring cap: once reached, the oldest entries are dropped on append. */
export const EDITLOG_MAX_ENTRIES = 200

/**
 * Append-only JSONL store of user node-text edits, located at
 * `memory/editlog/{workspaceUuid}/{fileUuid}.jsonl` under userData.
 *
 * Entries are consumed by memory extraction on consolidation; the file is
 * deleted after a successful extraction.
 */
export class EditLogStore {
  private readonly baseDir: string
  /** Per-file append queue: serializes read-modify-write so rapid commits never lose entries. */
  private readonly appendTails = new Map<string, Promise<void>>()

  constructor(userDataPath: string) {
    this.baseDir = path.join(userDataPath, 'memory', 'editlog')
  }

  private filePath(workspaceUuid: string, fileUuid: string): string {
    return path.join(this.baseDir, workspaceUuid, `${fileUuid}.jsonl`)
  }

  async append(workspaceUuid: string, fileUuid: string, entry: EditLogEntry): Promise<void> {
    const key = `${workspaceUuid}/${fileUuid}`
    const tail = this.appendTails.get(key) ?? Promise.resolve()
    const next = tail.then(() => this.appendNow(workspaceUuid, fileUuid, entry))
    this.appendTails.set(
      key,
      next.catch(() => {}),
    )
    return next
  }

  private async appendNow(
    workspaceUuid: string,
    fileUuid: string,
    entry: EditLogEntry,
  ): Promise<void> {
    const entries = await this.read(workspaceUuid, fileUuid)
    entries.push(entry)
    const capped =
      entries.length > EDITLOG_MAX_ENTRIES ? entries.slice(-EDITLOG_MAX_ENTRIES) : entries
    const content = capped.map((e) => JSON.stringify(e)).join('\n') + '\n'
    await atomicWrite(this.filePath(workspaceUuid, fileUuid), content)
  }

  async read(workspaceUuid: string, fileUuid: string): Promise<EditLogEntry[]> {
    let content: string
    try {
      content = await fs.promises.readFile(this.filePath(workspaceUuid, fileUuid), 'utf-8')
    } catch {
      return []
    }
    const entries: EditLogEntry[] = []
    for (const line of content.split(/\r?\n/)) {
      if (!line) continue
      try {
        entries.push(JSON.parse(line) as EditLogEntry)
      } catch {
        // skip corrupted line
      }
    }
    return entries
  }

  async delete(workspaceUuid: string, fileUuid: string): Promise<void> {
    await fs.promises.rm(this.filePath(workspaceUuid, fileUuid), { force: true })
  }
}
