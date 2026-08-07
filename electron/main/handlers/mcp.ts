import { ipcMain } from 'electron'
import type { McpServerStatus } from '../../mcp/types.js'
import { IPC } from '../../ipc.js'
import { logger } from '../../shared/logger.js'
import type { FileSystemService } from '../../fs/index.js'
import type { HandlerContext } from './context.js'

const mcpLog = logger.withContext('mcp')

/**
 * MCP 用户态记录的是用户的授权意图，只持久化 connected / disconnected。
 * connecting / failed 是会话内瞬态——若把 failed 落盘，一次临时故障会把
 * server 永久移出启动重连集合（凭据其实还在）。
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
  ipcMain.handle(IPC.McpConnect, async (_e, payload: { serverId: string }) => {
    const manager = ctx.getMcpManager()
    if (!manager) return { ok: false, error: 'MCP 模块未初始化' }
    try {
      const status = await manager.connect(payload.serverId)
      if (status.state !== 'connected') {
        return { ok: false, error: status.error ?? '连接失败' }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.McpDisconnect, async (_e, payload: { serverId: string }) => {
    const manager = ctx.getMcpManager()
    if (!manager) return { ok: false, error: 'MCP 模块未初始化' }
    await manager.disconnect(payload.serverId)
    return { ok: true }
  })

  ipcMain.handle(IPC.McpStatus, async () => {
    return { ok: true, data: ctx.getMcpManager()?.getStatuses() ?? [] }
  })
}
