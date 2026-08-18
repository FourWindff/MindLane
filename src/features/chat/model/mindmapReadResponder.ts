import { mindmapRegistry } from '@/features/mindmap/model/mindmapRegistry'
import { serializeMindmapSection } from '@/shared/lib/mindmapXml'
import type { MindmapReadQuery, MindmapReadRequest } from '../../../../electron/ipc'

/**
 * 渲染层读导图应答器：应用启动时注册一次。
 *
 * 主进程经反向通道发来请求（requestId + fileUuid + 查询参数），这里按 fileUuid
 * 取对应编辑器，现场以**编辑器活状态**序列化 mindmap 节 XML 回包（不读磁盘）；
 * 只暴露 mindmap 节（metadata/assets/documents 不进 AI 上下文）。文件未打开时
 * 明确报错而非挂起。并发 runner 各自携带自己的 fileUuid 与 requestId，
 * 多文件同时生成互不干扰。
 */
export function connectMindmapReadResponder(): () => void {
  const api = window.mindlane?.ai
  if (!api?.onMindmapReadRequest || !api.respondMindmapRead) {
    return () => {}
  }
  return api.onMindmapReadRequest((request) => {
    void respondMindmapRead(request)
  })
}

async function respondMindmapRead(request: MindmapReadRequest): Promise<void> {
  const api = window.mindlane?.ai
  if (!api?.respondMindmapRead) return

  const instance = mindmapRegistry.getByFileUuid(request.fileUuid)
  if (!instance) {
    await api.respondMindmapRead({
      requestId: request.requestId,
      ok: false,
      error: '该文件未打开，无法读取导图',
    })
    return
  }

  const state = instance.store.getState()
  if (!state.hasDocumentOpen || !state.filePath) {
    await api.respondMindmapRead({
      requestId: request.requestId,
      ok: false,
      error: '该文件未打开，无法读取导图',
    })
    return
  }

  const query = (request.query ?? {}) as MindmapReadQuery

  const summary = serializeMindmapSection(state.nodes, state.edges, {
    ...(query.scope === 'subtree' && query.subtreeId ? { subtreeId: query.subtreeId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.textContains ? { textContains: query.textContains } : {}),
    ...(typeof query.maxDepth === 'number' ? { maxDepth: query.maxDepth } : {}),
  })
  await api.respondMindmapRead({ requestId: request.requestId, ok: true, summary })
}
