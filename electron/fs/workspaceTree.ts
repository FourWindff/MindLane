import fs from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import { ThumbnailManager } from './thumbnailManager.js'
import type { FsResult, WorkspaceFileEntry, WorkspaceTreeEntry } from './types.js'

const SUPPORTED_EXTENSIONS = new Set(['.mindlane'])
const IGNORED_NAMES = new Set(['.git', '.DS_Store', 'node_modules', 'Thumbs.db'])

export class WorkspaceTree {
  private thumbnails?: ThumbnailManager

  setThumbnailManager(thumbnails: ThumbnailManager): void {
    this.thumbnails = thumbnails
  }

  isSupportedFile(filePath: string): boolean {
    return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase())
  }

  async listFiles(workspacePath: string): Promise<FsResult<WorkspaceFileEntry[]>> {
    return this.guard(async () => {
      const resolvedPath = path.resolve(workspacePath)
      if (!fs.existsSync(resolvedPath)) {
        throw new Error('工作目录不存在')
      }
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
    })
  }

  async listTree(workspacePath: string): Promise<FsResult<WorkspaceTreeEntry[]>> {
    return this.guard(async () => {
      const resolvedPath = path.resolve(workspacePath)
      return this.readDirectoryRecursive(resolvedPath)
    })
  }

  private async readDirectoryRecursive(dirPath: string): Promise<WorkspaceTreeEntry[]> {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    const results: WorkspaceTreeEntry[] = []

    const dirs: WorkspaceTreeEntry[] = []
    const files: WorkspaceTreeEntry[] = []

    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name) || entry.name.startsWith('.')) continue

      const fullPath = path.join(dirPath, entry.name)

      if (entry.isDirectory()) {
        const children = await this.readDirectoryRecursive(fullPath)
        const dirStats = await fs.promises.stat(fullPath)
        dirs.push({
          name: entry.name,
          path: fullPath,
          type: 'directory',
          lastModifiedAt: dirStats.mtime.toISOString(),
          children,
        })
      } else if (entry.isFile() && this.isSupportedFile(entry.name)) {
        const fileStats = await fs.promises.stat(fullPath)
        const previewUrl = this.thumbnails ? await this.thumbnails.get(fullPath) : undefined
        files.push({
          name: entry.name,
          path: fullPath,
          type: 'file',
          lastModifiedAt: fileStats.mtime.toISOString(),
          previewUrl: previewUrl ?? undefined,
        })
      }
    }

    dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    results.push(...dirs, ...files)
    return results
  }

  async createDirectory(parentPath: string, name: string): Promise<FsResult<string>> {
    return this.guard(() => {
      const trimmedName = name.trim()
      if (!trimmedName) {
        throw new Error('仓库名称不能为空')
      }
      if (
        trimmedName === '.' ||
        trimmedName === '..' ||
        trimmedName.includes('/') ||
        trimmedName.includes('\\')
      ) {
        throw new Error('仓库名称包含非法字符')
      }

      const targetPath = path.resolve(parentPath, trimmedName)
      if (fs.existsSync(targetPath)) {
        throw new Error('目标目录已存在')
      }

      return fs.promises.mkdir(targetPath, { recursive: false }).then(() => targetPath)
    })
  }

  async createSubdirectory(
    parentPath: string,
    name: string,
    workspacePath: string,
  ): Promise<FsResult<string>> {
    return this.guard(() => {
      const trimmedName = name.trim()
      if (!trimmedName) {
        throw new Error('文件夹名称不能为空')
      }
      if (trimmedName === '.' || trimmedName === '..' || /[\\/]/.test(trimmedName)) {
        throw new Error('文件夹名称包含非法字符')
      }

      const resolvedParent = path.resolve(parentPath)
      const targetPath = path.join(resolvedParent, trimmedName)

      if (
        !this.isWithinWorkspace(targetPath, workspacePath) &&
        path.resolve(targetPath) !== path.resolve(workspacePath)
      ) {
        throw new Error('目标路径不在工作区内')
      }
      if (fs.existsSync(targetPath)) {
        throw new Error('文件夹已存在')
      }

      return fs.promises.mkdir(targetPath, { recursive: false }).then(() => targetPath)
    })
  }

  async deleteItem(targetPath: string, workspacePath: string): Promise<FsResult<void>> {
    return this.guard(async () => {
      const resolved = path.resolve(targetPath)
      if (!this.isWithinWorkspace(resolved, workspacePath)) {
        throw new Error('目标路径不在工作区内')
      }
      if (!fs.existsSync(resolved)) {
        throw new Error('目标不存在')
      }
      await shell.trashItem(resolved)
    })
  }

  async rename(oldPath: string, newName: string, workspacePath: string): Promise<FsResult<string>> {
    return this.guard(async () => {
      const trimmedName = newName.trim()
      if (!trimmedName) {
        throw new Error('名称不能为空')
      }
      if (trimmedName === '.' || trimmedName === '..' || /[\\/]/.test(trimmedName)) {
        throw new Error('名称包含非法字符')
      }

      const resolvedOld = path.resolve(oldPath)
      if (!this.isWithinWorkspace(resolvedOld, workspacePath)) {
        throw new Error('目标路径不在工作区内')
      }
      if (!fs.existsSync(resolvedOld)) {
        throw new Error('目标不存在')
      }

      const parentDir = path.dirname(resolvedOld)
      const stats = await fs.promises.stat(resolvedOld)
      const finalName =
        stats.isFile() && this.isSupportedFile(resolvedOld) && !trimmedName.endsWith('.mindlane')
          ? `${trimmedName}.mindlane`
          : trimmedName

      const newPath = path.join(parentDir, finalName)
      if (fs.existsSync(newPath)) {
        throw new Error('同名文件或文件夹已存在')
      }

      await fs.promises.rename(resolvedOld, newPath)
      return newPath
    })
  }

  async move(
    sourcePath: string,
    targetDirPath: string,
    workspacePath: string,
  ): Promise<FsResult<string>> {
    return this.guard(async () => {
      const resolvedSource = path.resolve(sourcePath)
      const resolvedTarget = path.resolve(targetDirPath)

      if (!this.isWithinWorkspace(resolvedSource, workspacePath)) {
        throw new Error('源路径不在工作区内')
      }

      const targetIsWorkspaceRoot = resolvedTarget === path.resolve(workspacePath)
      if (!targetIsWorkspaceRoot && !this.isWithinWorkspace(resolvedTarget, workspacePath)) {
        throw new Error('目标目录不在工作区内')
      }

      if (!fs.existsSync(resolvedSource)) {
        throw new Error('源文件或文件夹不存在')
      }

      const targetStats = await fs.promises.stat(resolvedTarget)
      if (!targetStats.isDirectory()) {
        throw new Error('目标路径不是一个文件夹')
      }

      const baseName = path.basename(resolvedSource)
      const newPath = path.join(resolvedTarget, baseName)

      if (resolvedSource === newPath) {
        return newPath
      }
      if (fs.existsSync(newPath)) {
        throw new Error('目标目录中已存在同名文件或文件夹')
      }

      // Prevent moving a directory into itself
      const sourceStats = await fs.promises.stat(resolvedSource)
      if (sourceStats.isDirectory()) {
        const rel = path.relative(resolvedSource, resolvedTarget)
        if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
          throw new Error('不能将文件夹移动到其自身内部')
        }
      }

      await fs.promises.rename(resolvedSource, newPath)
      return newPath
    })
  }

  isWithinWorkspace(filePath: string, workspacePath: string): boolean {
    const resolvedWorkspacePath = path.resolve(workspacePath)
    const resolvedFilePath = path.resolve(filePath)
    const relativePath = path.relative(resolvedWorkspacePath, resolvedFilePath)
    return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
  }

  private async guard<T>(action: () => Promise<T>): Promise<FsResult<T>> {
    try {
      const data = await action()
      return { ok: true, data }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}
