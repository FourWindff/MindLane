import { ipcMain, shell } from 'electron'
import type { McpServerStatus } from '../../agent/mcp/types.js'
import { acquireFeishuUat, exchangeFeishuUat } from '../../agent/mcp/feishuUat.js'
import { IPC, type McpConnectPayload, type McpAuthorizeUatPayload } from '../../ipc.js'
import { logger } from '../../shared/logger.js'
import type { FileSystemService } from '../../fs/index.js'
import type { HandlerContext } from './context.js'

const mcpLog = logger.withContext('mcp')

/**
 * MCP user state records the user's authorization intent and only persists
 * connected / disconnected. connecting / failed are session transients - if
 * failed were persisted, one temporary failure would permanently remove the
 * server from the startup reconnect set (the credentials are still there).
 */
export async function persistMcpStatus(
  fsService: FileSystemService,
  serverId: string,
  status: McpServerStatus,
): Promise<void> {
  if (status.state !== 'connected' && status.state !== 'disconnected') return
  try {
    const settings = await fsService.appState.load()
    await fsService.appState.update({
      mcpServers: {
        ...settings.mcpServers,
        [serverId]: {
          state: status.state,
          ...(status.workspaceName ? { workspaceName: status.workspaceName } : {}),
        },
      },
    })
  } catch (err) {
    mcpLog.warn('failed to persist status for %s: %o', serverId, err)
  }
}

export function registerMcpHandlers(ctx: HandlerContext): void {
  ipcMain.handle(IPC.McpConnect, async (_e, payload: McpConnectPayload) => {
    const manager = ctx.getMcpManager()
    if (!manager) return { ok: false, error: 'MCP module is not initialized' }
    try {
      const status = await manager.connect(payload.serverId, payload.credentials)
      if (status.state !== 'connected') {
        return { ok: false, error: status.error ?? 'Connection failed' }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.McpDisconnect, async (_e, payload: { serverId: string }) => {
    const manager = ctx.getMcpManager()
    if (!manager) return { ok: false, error: 'MCP module is not initialized' }
    await manager.disconnect(payload.serverId)
    return { ok: true }
  })

  ipcMain.handle(IPC.McpStatus, async () => {
    return { ok: true, data: ctx.getMcpManager()?.getStatuses() ?? [] }
  })

  ipcMain.handle(IPC.McpGetCredentials, async (_e, payload: { serverId: string }) => {
    const manager = ctx.getMcpManager()
    if (!manager) return { ok: false, error: 'MCP module is not initialized' }
    return { ok: true, data: manager.getSecrets(payload.serverId) }
  })

  ipcMain.handle(IPC.McpAuthorizeUat, async (_e, payload: McpAuthorizeUatPayload) => {
    try {
      if (payload.serverId !== 'feishu') {
        return { ok: false, error: 'This server does not support one-click UAT authorization' }
      }
      if (!payload.appId?.trim() || !payload.appSecret?.trim()) {
        return { ok: false, error: 'Fill in the App ID and App Secret before requesting the UAT' }
      }
      const appId = payload.appId.trim()
      const appSecret = payload.appSecret.trim()
      mcpLog.info('authorize-uat: start on port 44664')
      const result = await acquireFeishuUat({
        appId,
        appSecret,
        openBrowser: (url) => {
          mcpLog.info('authorize-uat: opened browser, waiting callback')
          void shell.openExternal(url)
        },
        // Log every step after the callback to locate where it gets stuck
        exchange: async (a, s, code) => {
          mcpLog.info('authorize-uat: callback received, exchanging token')
          const r = await exchangeFeishuUat(a, s, code)
          mcpLog.info('authorize-uat: got uat')
          return r
        },
        timeoutMs: 3 * 60_000,
      })
      // Persist refresh_token and its expiry so createAuthHeaders can auto-renew when connecting
      ctx.getMcpManager()?.persistSecrets('feishu', {
        uat: result.uat,
        refreshToken: result.refreshToken,
        uatExpiresAt: String(Date.now() + result.expiresIn * 1000),
      })
      return { ok: true, data: { uat: result.uat, expiresIn: result.expiresIn } }
    } catch (err) {
      mcpLog.warn('authorize-uat: failed: %s', err instanceof Error ? err.message : String(err))
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
