import { ipcMain } from 'electron'
import { IPC } from '../../ipc.js'
import type { AppSettings } from '../../fs/types.js'
import type { HandlerContext } from './context.js'

export function registerSettingsHandlers(ctx: HandlerContext): void {
  ipcMain.handle(IPC.FileSettingsLoad, async () => {
    return ctx.fsService.appState.load()
  })

  ipcMain.handle(IPC.FileSettingsUpdate, async (_e, partial: Record<string, unknown>) => {
    await ctx.fsService.appState.update(partial as Partial<AppSettings>)
    ctx.invalidateStreamRuntime()
    // API keys may have changed — refresh the redaction list on the file sink.
    const settings = await ctx.fsService.appState.load()
    ctx.refreshLogSecrets(settings)
  })
}
