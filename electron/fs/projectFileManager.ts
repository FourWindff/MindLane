import fs from 'node:fs'
import path from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import type { FsResult } from './types.js'
import type { MindLaneFile } from '../../src/shared/lib/fileFormat'
import { atomicWrite } from './atomicWrite.js'

export class ProjectFileManager {
  private backupsDir: string
  private maxBackups: number

  constructor(userDataPath: string, maxBackups = 5) {
    this.backupsDir = path.join(userDataPath, 'backups')
    this.maxBackups = maxBackups
  }

  async initialize(): Promise<void> {
    await fs.promises.mkdir(this.backupsDir, { recursive: true })
  }

  async open(
    win: BrowserWindow,
    options?: { defaultPath?: string },
  ): Promise<FsResult<{ filePath: string; data: MindLaneFile }>> {
    const result = await dialog.showOpenDialog(win, {
      title: '打开 MindLane 文件',
      defaultPath: options?.defaultPath,
      filters: [
        { name: 'MindLane 文件', extensions: ['mindlane'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: '已取消' }
    }
    const filePath = result.filePaths[0]!
    return this.loadFromPath(filePath)
  }

  async loadFromPath(
    filePath: string,
  ): Promise<FsResult<{ filePath: string; data: MindLaneFile }>> {
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8')
      const data = JSON.parse(raw) as MindLaneFile
      if (!data.version || !data.mindmap) {
        return { ok: false, error: '文件格式不正确' }
      }
      return { ok: true, data: { filePath, data } }
    } catch (e) {
      return { ok: false, error: `读取失败：${e instanceof Error ? e.message : String(e)}` }
    }
  }

  async save(
    filePath: string | null,
    data: MindLaneFile,
    win: BrowserWindow,
  ): Promise<FsResult<{ filePath: string }>> {
    if (!filePath) {
      return this.saveAs(data, win)
    }
    return this.saveToPath(filePath, data, { createBackup: true })
  }

  async saveToPath(
    filePath: string,
    data: MindLaneFile,
    options?: { createBackup?: boolean; overwrite?: boolean },
  ): Promise<FsResult<{ filePath: string }>> {
    try {
      if (options?.overwrite === false && fs.existsSync(filePath)) {
        return { ok: false, error: '文件已存在' }
      }
      if (options?.createBackup !== false) {
        await this.createBackup(filePath)
      }
      await atomicWrite(filePath, JSON.stringify(data, null, 2))
      return { ok: true, data: { filePath } }
    } catch (e) {
      return { ok: false, error: `保存失败：${e instanceof Error ? e.message : String(e)}` }
    }
  }

  async createInDirectory(
    directoryPath: string,
    name: string,
    data: MindLaneFile,
  ): Promise<FsResult<{ filePath: string }>> {
    const trimmedName = name.trim()
    if (!trimmedName) {
      return { ok: false, error: '文件名不能为空' }
    }
    if (trimmedName === '.' || trimmedName === '..' || /[\\/]/.test(trimmedName)) {
      return { ok: false, error: '文件名包含非法字符' }
    }
    const fileName = trimmedName.endsWith('.mindlane') ? trimmedName : `${trimmedName}.mindlane`
    const filePath = path.join(directoryPath, fileName)
    return this.saveToPath(filePath, data, { createBackup: false, overwrite: false })
  }

  async saveAs(
    data: MindLaneFile,
    win: BrowserWindow,
    options?: { defaultDirectory?: string | null },
  ): Promise<FsResult<{ filePath: string }>> {
    const defaultFilename = `${data.metadata.title || '未命名'}.mindlane`
    const defaultPath = options?.defaultDirectory
      ? path.join(options.defaultDirectory, defaultFilename)
      : defaultFilename
    const result = await dialog.showSaveDialog(win, {
      title: '另存为',
      defaultPath,
      filters: [{ name: 'MindLane 文件', extensions: ['mindlane'] }],
    })
    if (result.canceled || !result.filePath) {
      return { ok: false, error: '已取消' }
    }
    try {
      await atomicWrite(result.filePath, JSON.stringify(data, null, 2))
      return { ok: true, data: { filePath: result.filePath } }
    } catch (e) {
      return { ok: false, error: `保存失败：${e instanceof Error ? e.message : String(e)}` }
    }
  }

  private async createBackup(filePath: string): Promise<void> {
    try {
      if (!fs.existsSync(filePath)) return
      const basename = path.basename(filePath, '.mindlane')
      const backupName = `${basename}.${Date.now()}.mindlane.bak`
      const backupPath = path.join(this.backupsDir, backupName)
      await fs.promises.copyFile(filePath, backupPath)
      await this.cleanOldBackups(basename)
    } catch {
      /* best-effort */
    }
  }

  private async cleanOldBackups(basename: string): Promise<void> {
    try {
      const entries = await fs.promises.readdir(this.backupsDir)
      const matching = entries
        .filter((e) => e.startsWith(basename + '.') && e.endsWith('.mindlane.bak'))
        .sort()
        .reverse()
      const toRemove = matching.slice(this.maxBackups)
      for (const name of toRemove) {
        await fs.promises.unlink(path.join(this.backupsDir, name)).catch(() => {})
      }
    } catch {
      /* best-effort */
    }
  }
}
