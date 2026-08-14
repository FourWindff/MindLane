import { ipcMain } from 'electron'
import crypto from 'node:crypto'
import {
  urlToDataUrl,
  getProviderMeta,
  getRegisteredProviders,
  resolveChatProvider,
} from '../../agent/providers/index.js'
import type { SelectedNodeContent } from '../../agent/state.js'
import type { StreamRequest } from '../../agent/streamManager.js'
import type { ChatContext, MindmapReadResponse } from '../../ipc.js'
import { IPC } from '../../ipc.js'
import { logger } from '../../shared/logger.js'
import { readFileTags } from '../fileTags.js'
import { aiNotReadyResponse } from './helpers.js'
import type { HandlerContext } from './context.js'

const appLog = logger.withContext('app')

export function registerAiHandlers(ctx: HandlerContext): void {
  const fsService = ctx.fsService

  // 只读裸布尔返回（不包 IpcResult 信封）：必然成功的读取，符合桥约定。
  ipcMain.handle(IPC.AiIsReady, () => {
    return ctx.isAiServiceReady()
  })

  ipcMain.handle(
    IPC.AiChatStream,
    async (_e, payload: { threadId: string; message: string; context: ChatContext }) => {
      if (!ctx.isAiServiceReady()) {
        return aiNotReadyResponse()
      }

      try {
        if (!payload.message?.trim()) {
          return { ok: false, error: '消息不能为空' }
        }

        let fileTags: string[] | undefined
        if (payload.context?.filePath) {
          fileTags = await readFileTags(payload.context.filePath)
        }

        const workspacePath = payload.context.workspacePath
        // 源头不变量：发送必有活动文件（fileUuid 创建即存在），下游不做存在性检查。
        // 工作区路径仍是持久化前提（workspaceUuid 解析），此处保留。
        if (!workspacePath) {
          return { ok: false, error: '聊天上下文缺少工作区路径' }
        }
        let workspaceUuid: string
        {
          const workspaceState = await fsService.workspace.load(workspacePath)
          if (!workspaceState.ok) return workspaceState
          workspaceUuid = workspaceState.data.workspaceUuid
          if (!workspaceUuid) return { ok: false, error: '工作区缺少稳定身份' }
        }

        const request: StreamRequest = {
          sessionId: payload.threadId || crypto.randomUUID(),
          message: payload.message,
          workspaceUuid,
          context: {
            ...payload.context,
            selectedNodes: payload.context.selectedNodes?.filter(
              (n) => n.type === 'text' || n.type === 'palace',
            ),
            fileTags,
          },
          documentRef: payload.context?.attachedDocument,
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

  // 渲染层 → 主进程：读导图应答（反向通道的 invoke 侧）。
  // requestId 由渲染层原样带回，请求器据此解析挂起的请求；
  // 未知 requestId（已超时/已应答）是 no-op。
  ipcMain.handle(IPC.AiMindmapReadRespond, (_e, payload: MindmapReadResponse) => {
    ctx.mindmapReadRequester.respond(payload)
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

  // -- Image URL to base64 data URL --
  ipcMain.handle(IPC.ImageUrlToDataUrl, async (_e, payload: { url: string }) => {
    try {
      const dataUrl = await urlToDataUrl(payload.url)
      return { ok: true, data: { dataUrl } }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // -- Nodes to Palace pipeline (multi-agent: Analyze → imageGen → Vision) --
  ipcMain.handle(
    IPC.AiNodesToPalace,
    async (_e, payload: { selectedNodes: SelectedNodeContent[] }) => {
      try {
        const orchestrator = await ctx.getChatOrchestrator()
        if (!orchestrator) return aiNotReadyResponse()
        const settings = await fsService.appState.load()
        const provider = resolveChatProvider(settings)
        return await orchestrator.runPalaceFromNodes(payload.selectedNodes, provider)
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  // -- Provider management --
  ipcMain.handle(IPC.AiListProviders, async () => {
    return {
      chat: getRegisteredProviders().map((meta) => ({
        id: meta.id,
        displayName: meta.displayName,
        models: meta.defaultModels.map((m) => ({ ...m })),
        capabilities: meta.capabilities,
      })),
      image: getRegisteredProviders()
        .filter((meta) => meta.capabilities.includes('imageGen' as never))
        .map((meta) => ({ id: meta.id, displayName: meta.displayName })),
    }
  })

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

  ipcMain.handle(IPC.AiGetCapabilities, async () => {
    try {
      const settings = await fsService.appState.load()
      const providerId = settings.activeProviders.chat || 'dashscope'
      const providerMeta = getProviderMeta(providerId)
      if (!providerMeta) {
        return { ok: false, error: `未知的 provider: ${providerId}` }
      }

      return {
        ok: true,
        capabilities: providerMeta.capabilities,
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
