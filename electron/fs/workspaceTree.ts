import fs from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import { isWithinWorkspace } from './paths.js'
import { assertEntryName } from './entryName.js'
import { isMindLaneFile, MINDLANE_EXTENSION } from './constants.js'
import { guard } from './ipcResult.js'
import type { ThumbnailManager } from './thumbnailManager.js'
import type { IpcResult, WorkspaceTreeEntry } from './types.js'

const IGNORED_NAMES = new Set(['node_modules', 'Thumbs.db'])

export class WorkspaceTree {
  constructor(private readonly thumbnails: ThumbnailManager) {}

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

    dirs.sort((a, b) => a.name.localeCompare(b.name, 'en-US'))
    files.sort((a, b) => a.name.localeCompare(b.name, 'en-US'))
    results.push(...dirs, ...files)
    return results
  }

  async createDirectory(parentPath: string, name: string): Promise<IpcResult<string>> {
    return guard(() => {
      const trimmedName = assertEntryName(name, 'Workspace name')

      const targetPath = path.resolve(parentPath, trimmedName)
      if (fs.existsSync(targetPath)) {
        throw new Error('Target directory already exists')
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
      const trimmedName = assertEntryName(name, 'Folder name')

      const resolvedParent = path.resolve(parentPath)
      const targetPath = path.join(resolvedParent, trimmedName)

      if (
        !isWithinWorkspace(targetPath, workspacePath) &&
        path.resolve(targetPath) !== path.resolve(workspacePath)
      ) {
        throw new Error('Target path is not inside the workspace')
      }
      if (fs.existsSync(targetPath)) {
        throw new Error('Folder already exists')
      }

      return fs.promises.mkdir(targetPath, { recursive: false }).then(() => targetPath)
    })
  }

  async deleteItem(targetPath: string, workspacePath: string): Promise<IpcResult<void>> {
    return guard(async () => {
      const resolved = path.resolve(targetPath)
      if (!isWithinWorkspace(resolved, workspacePath)) {
        throw new Error('Target path is not inside the workspace')
      }
      if (!fs.existsSync(resolved)) {
        throw new Error('Target does not exist')
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
      const trimmedName = assertEntryName(newName, 'Name')

      const resolvedOld = path.resolve(oldPath)
      if (!isWithinWorkspace(resolvedOld, workspacePath)) {
        throw new Error('Target path is not inside the workspace')
      }
      if (!fs.existsSync(resolvedOld)) {
        throw new Error('Target does not exist')
      }

      const parentDir = path.dirname(resolvedOld)
      const stats = await fs.promises.stat(resolvedOld)
      const finalName =
        stats.isFile() && isMindLaneFile(resolvedOld) && !trimmedName.endsWith(MINDLANE_EXTENSION)
          ? `${trimmedName}.mindlane`
          : trimmedName

      const newPath = path.join(parentDir, finalName)
      if (fs.existsSync(newPath)) {
        throw new Error('A file or folder with the same name already exists')
      }

      await fs.promises.rename(resolvedOld, newPath)
      return newPath
    })
  }
}
