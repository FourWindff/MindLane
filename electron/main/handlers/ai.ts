import { ipcMain } from 'electron'
import crypto from 'node:crypto'
import { getRegisteredProviders } from '../../agent/providers/index.js'
import type { StreamRequest } from '../../agent/streamManager.js'
import type {
  ChatContext,
  EphemeralRunRequest,
  MindmapReadResponse,
  MindmapWriteResponse,
} from '../../ipc.js'
import { IPC } from '../../ipc.js'
import { logger } from '../../shared/logger.js'
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
          sessionId: payload.threadId || crypto.randomUUID(),
          message: payload.message ?? '',
          workspaceUuid,
          context: payload.context,
          documentRef: payload.context?.attachedDocument,
          ephemeral: payload.ephemeral,
        }

        const streamManager = ctx.getStreamManager()
        if (!streamManager) return aiNotReadyResponse()

        return {
          ok: true,
          streamId: streamManager.startStream(request),
        }
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

  // Renderer -> main process: save-to-disk response (the invoke side of the reverse channel,
  // same pattern as mindmap read).
  // An unknown requestId (already timed out / answered) is a no-op.
  ipcMain.handle(IPC.AiMindmapWriteRespond, (_e, payload: MindmapWriteResponse) => {
    ctx.mindmapWriteRequester.respond(payload)
  })

  // One-way (send, not invoke): renderer never awaits. Resolve workspaceUuid
  // here so the renderer only needs workspacePath + fileUuid.
  ipcMain.on(
    IPC.EditlogAppend,
    (
      _e,
      payload: {
        workspacePath?: string
        fileUuid?: string
        nodeId?: string
        before?: string
        after?: string
      },
    ) => {
      void (async () => {
        try {
          if (!ctx.isAiServiceReady()) return
          const editLogStore = ctx.editLogStore
          if (!editLogStore) return
          const { workspacePath, fileUuid, nodeId, before, after } = payload ?? {}
          if (!workspacePath || !fileUuid || !nodeId || before == null || after == null) return
          const workspaceState = await fsService.workspace.load(workspacePath)
          if (!workspaceState.ok) return
          const workspaceUuid = workspaceState.data.workspaceUuid
          if (!workspaceUuid) return
          await editLogStore.append(workspaceUuid, fileUuid, {
            ts: Date.now(),
            nodeId,
            before,
            after,
          })
        } catch (err) {
          appLog.warn('editlog append failed:', err)
        }
      })()
    },
  )

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
