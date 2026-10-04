import fs from 'node:fs'
import path from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import type { IpcResult } from './types.js'
import type { MindLaneFile } from '../../contracts/fileFormat'
import { deserializeMindLaneFile, serializeMindLaneFile } from '../../contracts/mindmapXml'
import { atomicWrite } from './atomicWrite.js'
import { assertEntryName } from './entryName.js'
import { MINDLANE_EXTENSION } from './constants.js'
import { fail } from './ipcResult.js'
import type { AppState } from './appState.js'

type SavedProject = { filePath: string; data: MindLaneFile }

export class ProjectFileManager {
  constructor(private readonly appState?: AppState) {}

  async open(
    win: BrowserWindow,
    options?: { defaultPath?: string },
  ): Promise<IpcResult<{ filePath: string; data: MindLaneFile }>> {
    const result = await dialog.showOpenDialog(win, {
      title: 'Open MindLane file',
      defaultPath: options?.defaultPath,
      filters: [
        { name: 'MindLane files', extensions: ['mindlane'] },
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: 'Canceled' }
    }
    const filePath = result.filePaths[0]!
    return this.loadFromPath(filePath)
  }

  async loadFromPath(
    filePath: string,
  ): Promise<IpcResult<{ filePath: string; data: MindLaneFile }>> {
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8')
      // After the migration the app only reads XML (no read-time fallback, no dual-format support); JSON v1.0 is converted by a one-time migration script.
      const data = await deserializeMindLaneFile(raw)
      if (!data.version || !data.mindmap) {
        return { ok: false, error: 'Invalid file format' }
      }
      if (this.appState && data.metadata?.fileUuid) {
        const fileUuid = await this.appState.claimFileUuid(filePath, data.metadata.fileUuid)
        if (fileUuid !== data.metadata.fileUuid) {
          data.metadata.fileUuid = fileUuid
          await atomicWrite(filePath, serializeMindLaneFile(data))
        }
      }
      return { ok: true, data: { filePath, data } }
    } catch (e) {
      return fail(e, 'Read failed')
    }
  }

  async save(
    filePath: string | null,
    data: MindLaneFile,
    win: BrowserWindow,
  ): Promise<IpcResult<SavedProject>> {
    if (!filePath) {
      return this.saveAs(data, win)
    }
    return this.saveToPath(filePath, data)
  }

  async saveToPath(
    filePath: string,
    data: MindLaneFile,
    options?: { overwrite?: boolean },
  ): Promise<IpcResult<SavedProject>> {
    try {
      if (options?.overwrite === false && fs.existsSync(filePath)) {
        return { ok: false, error: 'File already exists' }
      }
      const fileUuid = this.appState
        ? await this.appState.claimFileUuid(filePath, data.metadata.fileUuid)
        : data.metadata.fileUuid
      const savedData =
        fileUuid === data.metadata.fileUuid
          ? data
          : { ...data, metadata: { ...data.metadata, fileUuid } }
      await atomicWrite(filePath, serializeMindLaneFile(savedData))
      return { ok: true, data: { filePath, data: savedData } }
    } catch (e) {
      return fail(e, 'Save failed')
    }
  }

  async createInDirectory(
    directoryPath: string,
    name: string,
    data: MindLaneFile,
  ): Promise<IpcResult<SavedProject>> {
    try {
      const trimmedName = assertEntryName(name, 'File name')
      const fileName = trimmedName.endsWith(MINDLANE_EXTENSION)
        ? trimmedName
        : `${trimmedName}${MINDLANE_EXTENSION}`
      const filePath = path.join(directoryPath, fileName)
      return await this.saveToPath(filePath, data, { overwrite: false })
    } catch (e) {
      return fail(e)
    }
  }

  async saveAs(
    data: MindLaneFile,
    win: BrowserWindow,
    options?: { defaultDirectory?: string | null },
  ): Promise<IpcResult<SavedProject>> {
    const defaultFilename = `${data.metadata.title || 'Untitled'}.mindlane`
    const defaultPath = options?.defaultDirectory
      ? path.join(options.defaultDirectory, defaultFilename)
      : defaultFilename
    const result = await dialog.showSaveDialog(win, {
      title: 'Save As',
      defaultPath,
      filters: [{ name: 'MindLane files', extensions: ['mindlane'] }],
    })
    if (result.canceled || !result.filePath) {
      return { ok: false, error: 'Canceled' }
    }
    try {
      const copiedData: MindLaneFile = {
        ...data,
        metadata: { ...data.metadata, fileUuid: crypto.randomUUID() },
      }
      if (this.appState) {
        copiedData.metadata.fileUuid = await this.appState.claimFileUuid(
          result.filePath,
          copiedData.metadata.fileUuid,
        )
      }
      await atomicWrite(result.filePath, serializeMindLaneFile(copiedData))
      return { ok: true, data: { filePath: result.filePath, data: copiedData } }
    } catch (e) {
      return fail(e, 'Save failed')
    }
  }
}
