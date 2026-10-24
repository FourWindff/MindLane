import { ipcMain } from 'electron'
import { IPC } from '../../ipc.js'
import type { MindmapDocumentService } from '../document/documentService.js'
import type { HandlerContext } from './context.js'

/**
 * The bridge half of the document service: one request channel and one state
 * push channel. Every mutation broadcasts the new versioned state, so the
 * renderer never has to poll or reconstruct what changed.
 */
export function registerDocumentHandlers(
  ctx: HandlerContext,
  documentService: MindmapDocumentService,
): void {
  documentService.subscribe((state) => {
    const win = ctx.getWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send(IPC.MindmapDocumentState, state)
  })

  ipcMain.handle(IPC.MindmapDocumentCommand, (_event, intent) => documentService.handle(intent))
}
