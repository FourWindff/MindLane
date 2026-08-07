import { ipcMain } from 'electron'
import { IPC } from '../../ipc.js'
import type { HandlerContext } from './context.js'

export function registerWindowHandlers(ctx: HandlerContext): void {
  ipcMain.handle(IPC.WindowMinimize, () => {
    ctx.getWindow()?.minimize()
  })

  ipcMain.handle(IPC.WindowToggleMaximize, () => {
    const win = ctx.getWindow()
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.handle(IPC.WindowClose, () => {
    ctx.getWindow()?.close()
  })

  ipcMain.handle(IPC.WindowCloseConfirmed, () => {
    ctx.setForceClose(true)
    ctx.getWindow()?.close()
  })

  ipcMain.handle(IPC.WindowOpenDevtools, () => {
    ctx.getWindow()?.webContents.openDevTools()
  })
}
