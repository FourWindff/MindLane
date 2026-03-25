import fs from 'node:fs'
import path from 'node:path'
import type { WorkspaceFileEntry } from './types.js'

const SUPPORTED_EXTENSIONS = new Set(['.mindlane'])

export class WorkspaceManager {
  isSupportedFile(filePath: string): boolean {
    return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase())
  }

  async listFiles(workspacePath: string): Promise<WorkspaceFileEntry[]> {
    const resolvedPath = path.resolve(workspacePath)
    const stats = await fs.promises.stat(resolvedPath)
    if (!stats.isDirectory()) {
      throw new Error('工作目录不存在')
    }

    const entries = await fs.promises.readdir(resolvedPath, { withFileTypes: true })
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && this.isSupportedFile(entry.name))
        .map(async (entry) => {
          const filePath = path.join(resolvedPath, entry.name)
          const fileStats = await fs.promises.stat(filePath)
          return {
            filePath,
            name: entry.name,
            lastModifiedAt: fileStats.mtime.toISOString(),
          } satisfies WorkspaceFileEntry
        }),
    )

    return files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }

  async createDirectory(parentPath: string, name: string): Promise<string> {
    const trimmedName = name.trim()
    if (!trimmedName) {
      throw new Error('仓库名称不能为空')
    }
    if (trimmedName === '.' || trimmedName === '..' || trimmedName.includes('/') || trimmedName.includes('\\')) {
      throw new Error('仓库名称包含非法字符')
    }

    const targetPath = path.resolve(parentPath, trimmedName)
    if (fs.existsSync(targetPath)) {
      throw new Error('目标目录已存在')
    }

    await fs.promises.mkdir(targetPath, { recursive: false })
    return targetPath
  }

  isWithinWorkspace(filePath: string, workspacePath: string): boolean {
    const resolvedWorkspacePath = path.resolve(workspacePath)
    const resolvedFilePath = path.resolve(filePath)
    const relativePath = path.relative(resolvedWorkspacePath, resolvedFilePath)
    return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
  }
}
