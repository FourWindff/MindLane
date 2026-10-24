import { ipcMain } from 'electron'
import { IPC } from '../../ipc.js'
import { aiNotReadyResponse } from './helpers.js'
import type { HandlerContext } from './context.js'
import type { ChatMessage } from '../../../contracts/fileFormat.js'

export function registerChatHandlers(ctx: HandlerContext): void {
  const fsService = ctx.fsService

  ipcMain.handle(
    IPC.ChatListSessions,
    async (
      _e,
      payload: { workspacePath: string; fileUuid?: string; limit?: number; offset?: number },
    ) => {
      if (!ctx.isAiServiceReady()) return aiNotReadyResponse()
      const sessionManager = ctx.sessionManager
      if (!sessionManager) return aiNotReadyResponse()
      try {
        const workspaceState = await fsService.workspace.load(payload.workspacePath)
        if (!workspaceState.ok) return workspaceState
        const sessions = await sessionManager.runInWorkspace(
          workspaceState.data.workspaceUuid,
          () =>
            sessionManager.listSessions({
              fileUuid: payload.fileUuid,
              limit: payload.limit,
              offset: payload.offset,
            }),
        )
        return { ok: true, data: { sessions } }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(IPC.ChatListCapsuleFiles, async (_e, payload: { workspacePath: string }) => {
    if (!ctx.isAiServiceReady()) return aiNotReadyResponse()
    const sessionManager = ctx.sessionManager
    if (!sessionManager) return aiNotReadyResponse()
    try {
      const workspaceState = await fsService.workspace.load(payload.workspacePath)
      if (!workspaceState.ok) return workspaceState
      const files = await sessionManager.runInWorkspace(workspaceState.data.workspaceUuid, () =>
        sessionManager.listCapsuleFiles(),
      )
      return { ok: true, data: { files } }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IPC.ChatLoadSession,
    async (_e, payload: { workspacePath: string; sessionId: string }) => {
      const sessionResult = (messages: ChatMessage[]) => ({
        ok: true as const,
        data: { sessionId: payload.sessionId, messages },
      })
      if (!ctx.isAiServiceReady()) return sessionResult([])
      const sessionManager = ctx.sessionManager
      if (!sessionManager) return sessionResult([])
      try {
        const workspaceState = await fsService.workspace.load(payload.workspacePath)
        if (!workspaceState.ok) throw new Error(workspaceState.error)
        const messages = await sessionManager.runInWorkspace(
          workspaceState.data.workspaceUuid,
          () => sessionManager.loadSessionMessages(payload.sessionId),
        )
        return sessionResult(messages)
      } catch {
        return sessionResult([])
      }
    },
  )

  ipcMain.handle(
    IPC.ChatDeleteSession,
    async (_e, payload: { workspacePath: string; sessionId: string }) => {
      if (!ctx.isAiServiceReady()) return aiNotReadyResponse()
      const sessionManager = ctx.sessionManager
      if (!sessionManager) return aiNotReadyResponse()
      try {
        const workspaceState = await fsService.workspace.load(payload.workspacePath)
        if (!workspaceState.ok) return workspaceState
        // The store's delete drops the session row, its messages and the
        // active-session mapping in one transaction.
        await sessionManager.runInWorkspace(workspaceState.data.workspaceUuid, () =>
          sessionManager.deleteSession(payload.sessionId),
        )
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )
}
