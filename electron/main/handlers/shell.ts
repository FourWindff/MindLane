import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { DocumentRef } from '../../../src/shared/lib/fileFormat.js'
import { IPC } from '../../ipc.js'
import { resolveDocumentRef } from '../documentRef.js'
import type { HandlerContext } from './context.js'

export function registerShellHandlers(ctx: HandlerContext): void {
  ipcMain.handle(IPC.ShellOpenDocumentRef, async (_e, doc: DocumentRef) => {
    const resolved = resolveDocumentRef(doc, ctx.userDataPath)
    if (!resolved.ok) {
      return { ok: false, error: resolved.error }
    }

    if (doc.type === 'text' && !fs.existsSync(resolved.target)) {
      return { ok: false, error: '缓存文件不存在' }
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
}
