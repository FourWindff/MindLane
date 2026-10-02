import fs from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import { isWithinWorkspace } from './paths.js'
import { assertEntryName } from './entryName.js'
import { isMindLaneFile, MINDLANE_EXTENSION } from './constants.js'
import { guard } from './ipcResult.js'
import type { ThumbnailManager } from './thumbnailManager.js'
import type { IpcResult, WorkspaceFileEntry, WorkspaceTreeEntry } from './types.js'

const IGNORED_NAMES = new Set(['node_modules', 'Thumbs.db'])

export class WorkspaceTree {
  constructor(private readonly thumbnails: ThumbnailManager) {}

  async listFiles(workspacePath: string): Promise<IpcResult<WorkspaceFileEntry[]>> {
    return guard(async () => {
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
          .filter((entry) => entry.isFile() && isMindLaneFile(entry.name))
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

  async listTree(workspacePath: string): Promise<IpcResult<WorkspaceTreeEntry[]>> {
    return guard(async () => {
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
      } else if (entry.isFile() && isMindLaneFile(entry.name)) {
        const fileStats = await fs.promises.stat(fullPath)
        const previewUrl = await this.thumbnails.get(fullPath)
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

  async createDirectory(parentPath: string, name: string): Promise<IpcResult<string>> {
    return guard(() => {
      const trimmedName = assertEntryName(name, '仓库名称')

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
  ): Promise<IpcResult<string>> {
    return guard(() => {
      const trimmedName = assertEntryName(name, '文件夹名称')

      const resolvedParent = path.resolve(parentPath)
      const targetPath = path.join(resolvedParent, trimmedName)

      if (
        !isWithinWorkspace(targetPath, workspacePath) &&
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

  async deleteItem(targetPath: string, workspacePath: string): Promise<IpcResult<void>> {
    return guard(async () => {
      const resolved = path.resolve(targetPath)
      if (!isWithinWorkspace(resolved, workspacePath)) {
        throw new Error('目标路径不在工作区内')
      }
      if (!fs.existsSync(resolved)) {
        throw new Error('目标不存在')
      }
      await shell.trashItem(resolved)
    })
  }

  async rename(
    oldPath: string,
    newName: string,
    workspacePath: string,
  ): Promise<IpcResult<string>> {
    return guard(async () => {
      const trimmedName = assertEntryName(newName, '名称')

      const resolvedOld = path.resolve(oldPath)
      if (!isWithinWorkspace(resolvedOld, workspacePath)) {
        throw new Error('目标路径不在工作区内')
      }
      if (!fs.existsSync(resolvedOld)) {
        throw new Error('目标不存在')
      }

      const parentDir = path.dirname(resolvedOld)
      const stats = await fs.promises.stat(resolvedOld)
      const finalName =
        stats.isFile() && isMindLaneFile(resolvedOld) && !trimmedName.endsWith(MINDLANE_EXTENSION)
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
  ): Promise<IpcResult<string>> {
    return guard(async () => {
      const resolvedSource = path.resolve(sourcePath)
      const resolvedTarget = path.resolve(targetDirPath)

      if (!isWithinWorkspace(resolvedSource, workspacePath)) {
        throw new Error('源路径不在工作区内')
      }

      const targetIsWorkspaceRoot = resolvedTarget === path.resolve(workspacePath)
      if (!targetIsWorkspaceRoot && !isWithinWorkspace(resolvedTarget, workspacePath)) {
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
}
