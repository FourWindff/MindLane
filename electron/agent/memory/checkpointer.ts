import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import path from 'node:path'
import fs from 'node:fs'

export class CheckpointerManager {
  private saver: SqliteSaver | null = null

  /** 初始化并指定数据库文件路径（与 SessionManager 共用同一文件） */
  async initWithDbPath(dbPath: string): Promise<void> {
    const dir = path.dirname(dbPath)
    await fs.promises.mkdir(dir, { recursive: true })
    this.saver = SqliteSaver.fromConnString(dbPath)
  }

  /** 兼容旧初始化方式（使用独立的 checkpoints.db） */
  async init(userDataPath: string): Promise<void> {
    const dir = path.join(userDataPath, 'memory')
    await fs.promises.mkdir(dir, { recursive: true })
    const dbPath = path.join(dir, 'checkpoints.db')
    this.saver = SqliteSaver.fromConnString(dbPath)
  }

  get(): SqliteSaver | null {
    return this.saver
  }

  getAdapter(): BaseCheckpointSaver | undefined {
    return this.saver ?? undefined
  }
}
