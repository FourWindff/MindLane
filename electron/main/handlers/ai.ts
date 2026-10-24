import { ipcMain } from 'electron'
import crypto from 'node:crypto'
import { getRegisteredProviders } from '../../agent/providers/index.js'
import type { StreamRequest } from '../../agent/streamManager.js'
import type { ChatContext, EphemeralRunRequest, MindmapReadResponse } from '../../ipc.js'
import { IPC } from '../../ipc.js'
import { logger } from '../../shared/logger.js'
import { recordNodeEdit, type EditLogAppendPayload } from '../editLogRecord.js'
import { aiNotReadyResponse } from './helpers.js'
import type { HandlerContext } from './context.js'

const appLog = logger.withContext('app')

export function registerAiHandlers(ctx: HandlerContext): void {
  const fsService = ctx.fsService

  // Read-only bare boolean (not wrapped in an IpcResult envelope): a read that cannot fail, per the bridge contract.
  ipcMain.handle(IPC.AiIsReady, () => {
    return ctx.isAiServiceReady()
  })

  ipcMain.handle(
    IPC.AiChatStream,
    async (
      _e,
      payload: {
        streamId: string
        threadId: string
        message: string
        context: ChatContext
        ephemeral?: EphemeralRunRequest
      },
    ) => {
      if (!ctx.isAiServiceReady()) {
        return aiNotReadyResponse()
      }

      try {
        // The renderer owns the stream identity: the mapping is already in place
        // when the first event leaves the main process, so the id must arrive here.
        if (!payload.streamId) {
          return { ok: false, error: 'Chat stream request is missing the stream id' }
        }

        // Ephemeral runs (manual palace) may carry an empty message: the palace
        // subgraph takes its input from the selection, and a resume re-runs the
        // private thread with empty input.
        if (!payload.message?.trim() && !payload.ephemeral) {
          return { ok: false, error: 'Message cannot be empty' }
        }

        const workspacePath = payload.context.workspacePath
        // Source invariant: a send always has an active file (the fileUuid exists
        // from creation). The workspace path is what session persistence needs
        // (workspaceUuid resolution); an ephemeral run writes no session record,
        // so a standalone file outside any workspace can still run.
        let workspaceUuid = ''
        if (workspacePath) {
          const workspaceState = await fsService.workspace.load(workspacePath)
          if (!workspaceState.ok) return workspaceState
          workspaceUuid = workspaceState.data.workspaceUuid
          if (!workspaceUuid) return { ok: false, error: 'Workspace is missing a stable identity' }
        } else if (!payload.ephemeral) {
          return { ok: false, error: 'Chat context is missing the workspace path' }
        }

        const request: StreamRequest = {
          streamId: payload.streamId,
          sessionId: payload.threadId || crypto.randomUUID(),
          message: payload.message ?? '',
          workspaceUuid,
          context: payload.context,
          documentRef: payload.context?.attachedDocument,
          ephemeral: payload.ephemeral,
        }

        const streamManager = ctx.getStreamManager()
        if (!streamManager) return aiNotReadyResponse()

        streamManager.startStream(request)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  ipcMain.handle(IPC.AiChatStreamStop, (_e, payload: { streamId: string }) => {
    return { ok: ctx.getStreamManager()?.stopStream(payload.streamId) ?? false }
  })

  // Renderer -> main process: mindmap read response (the invoke side of the reverse channel).
  // The renderer passes the requestId back verbatim; the requester resolves the pending
  // request with it; an unknown requestId (already timed out / answered) is a no-op.
  ipcMain.handle(IPC.AiMindmapReadRespond, (_e, payload: MindmapReadResponse) => {
    ctx.mindmapReadRequester.respond(payload)
  })

  // One-way (send, not invoke): renderer never awaits. Resolve workspaceUuid
  // here so the renderer only needs workspacePath + fileUuid. The row lands in
  // the internal store; the legacy per-file editlog directory is gone.
  ipcMain.on(IPC.EditlogAppend, (_e, payload: EditLogAppendPayload) => {
    void (async () => {
      try {
        if (!ctx.isAiServiceReady()) return
        const stateStore = ctx.stateStore
        if (!stateStore) return
        await recordNodeEdit({ stateStore, workspace: fsService.workspace }, payload ?? {})
      } catch (err) {
        appLog.warn('editlog append failed:', err)
      }
    })()
  })

  // -- Provider management --
  ipcMain.handle(IPC.AiGetProviders, async () => {
    return {
      ok: true,
      providers: getRegisteredProviders().map((meta) => ({
        id: meta.id,
        displayName: meta.displayName,
        capabilities: meta.capabilities,
        models: meta.defaultModels,
      })),
    }
  })
}
