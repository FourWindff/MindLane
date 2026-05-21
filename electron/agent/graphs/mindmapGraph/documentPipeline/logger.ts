import fs from 'node:fs/promises'
import path from 'node:path'
import type { WorkflowLogEntry } from './types.js'

export class LabLogger {
  private initialized = false

  constructor(
    private logPath: string,
    private debugEnabled: boolean,
  ) {}

  async info(message: string): Promise<WorkflowLogEntry> {
    return this.write('info', message)
  }

  async warn(message: string): Promise<WorkflowLogEntry> {
    return this.write('warn', message)
  }

  async error(message: string): Promise<WorkflowLogEntry> {
    return this.write('error', message)
  }

  async debug(message: string): Promise<WorkflowLogEntry> {
    if (!this.debugEnabled) {
      return { timestamp: new Date().toISOString(), level: 'debug', message }
    }
    return this.write('debug', message)
  }

  async flush(): Promise<void> {
    // No-op: writes are now synchronous with fs.appendFile
    // Keeping this method for API compatibility
  }

  private async ensureDir(): Promise<void> {
    if (this.initialized) return
    await fs.mkdir(path.dirname(this.logPath), { recursive: true })
    this.initialized = true
  }

  private async write(
    level: WorkflowLogEntry['level'],
    message: string,
  ): Promise<WorkflowLogEntry> {
    const entry: WorkflowLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    }

    const line = `${entry.timestamp} [${level.toUpperCase()}] ${message}\n`
    const target = level === 'error' ? console.error : console.log
    target(line.trimEnd())

    await this.ensureDir()
    await fs.appendFile(this.logPath, line, 'utf-8')

    return entry
  }
}
