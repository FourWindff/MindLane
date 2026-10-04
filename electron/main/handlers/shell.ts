import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { DocumentRef } from '../../../contracts/fileFormat.js'
import { IPC } from '../../ipc.js'
import { logger } from '../../shared/logger.js'
import { resolveDocumentRef } from '../documentRef.js'
import type { HandlerContext } from './context.js'

/** Renderer-reported errors: fixed context, no streamId is guaranteed at the report site. */
const rendererLog = logger.withContext('renderer')

export function registerShellHandlers(ctx: HandlerContext): void {
  ipcMain.handle(IPC.ShellOpenDocumentRef, async (_e, doc: DocumentRef) => {
    const resolved = resolveDocumentRef(doc, ctx.userDataPath)
    if (!resolved.ok) {
      return { ok: false, error: resolved.error }
    }

    if (doc.type === 'text' && !fs.existsSync(resolved.target)) {
      return { ok: false, error: 'Cached file does not exist' }
    }

    try {
      if (resolved.external) {
        await shell.openExternal(resolved.target)
      } else {
        const error = await shell.openPath(resolved.target)
        if (error) {
          return { ok: false, error }
        }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.ShellOpenLogs, () => {
    shell.showItemInFolder(path.join(ctx.userDataPath, 'logs', 'mindlane.log'))
    return { ok: true }
  })

  ipcMain.on(IPC.ShellLogError, (_e, message: unknown) => {
    if (typeof message !== 'string' || message.length === 0) return
    rendererLog.error('%s', message)
  })

  ipcMain.on(IPC.ShellLogWarning, (_e, message: unknown) => {
    if (typeof message !== 'string' || message.length === 0) return
    rendererLog.warn('%s', message)
  })

  ipcMain.handle(IPC.ShellOpenExternal, (_e, payload: { url: string }) => {
    // Allow http/https only, so the renderer cannot hand arbitrary commands to openExternal
    let url: URL
    try {
      url = new URL(payload.url)
    } catch {
      return { ok: false, error: 'Invalid link' }
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { ok: false, error: 'Only http/https links can be opened' }
    }
    void shell.openExternal(url.toString())
    return { ok: true }
  })
}
