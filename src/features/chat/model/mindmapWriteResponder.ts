import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'
import {
  MindmapXmlError,
  buildValidationContext,
  formatXmlError,
  parseXmlFragment,
  validateFragmentForInsert,
  validateMove,
} from '@/shared/lib/mindmapXml'
import type { MindmapWriteRequest, MindmapWriteResponse } from '../../../../electron/ipc'

/**
 * 渲染层落盘应答器（PRD：即时落盘 · 下半段）。
 *
 * 订阅主进程的落盘请求通道（01 契约：requestId + fileUuid + action + args），
 * 按 fileUuid 解析活编辑器，原子校验 + 落图，返回结构化 `{ok, action, data}`
 * 或错误——该结果即 ack，主进程原样作为工具结果回给模型。
 * 校验复用共享 mindmapXml 库（错误码 + 恢复策略文案与主进程同一词汇表）。
 *
 * 并发工具调用不得交错修改同一编辑器：按 fileUuid 串行化落盘队列，
 * 逐文件排队执行；不同 fileUuid 互不阻塞。超时语义归主进程，这里只保证单次应答。
 */
export interface MindmapWriteResponderDependencies {
  /** 订阅主进程落盘请求通道（返回取消订阅函数）。 */
  subscribe: (listener: (request: MindmapWriteRequest) => void) => () => void
  /** fileUuid → 活编辑器；未打开返回 undefined。 */
  resolveEditor: (fileUuid: string) => MindmapEditor | undefined
  /** 落盘成功后的持久化回调（fire-and-forget，如 saveMindmapInstance）。 */
  persistFile: (fileUuid: string) => void
  /** 渲染层 → 主进程落盘应答（未知 requestId 为 no-op）。 */
  respond: (payload: MindmapWriteResponse) => void | Promise<void>
}

export function createMindmapWriteResponder(deps: MindmapWriteResponderDependencies) {
  // 按 fileUuid 的串行队列：同一文件的请求逐条排队，不同文件各自独立链。
  const queues = new Map<string, Promise<void>>()
  let unsubscribe: (() => void) | null = null

  function enqueue(request: MindmapWriteRequest): void {
    const previous = queues.get(request.fileUuid) ?? Promise.resolve()
    const task = previous.catch(() => undefined).then(() => handleRequest(request))
    queues.set(request.fileUuid, task)
    void task.finally(() => {
      // 只清空仍指向本任务的槽位：后续排队的请求不应被本任务清理。
      if (queues.get(request.fileUuid) === task) queues.delete(request.fileUuid)
    })
  }

  async function handleRequest(request: MindmapWriteRequest): Promise<void> {
    try {
      const editor = deps.resolveEditor(request.fileUuid)
      if (!editor) {
        await deps.respond({
          requestId: request.requestId,
          ok: false,
          error: '该文件未打开，无法落盘',
        })
        return
      }
      const data = await applyWriteAction(request.action, request.args, editor)
      deps.persistFile(request.fileUuid)
      await safeRespond({
        requestId: request.requestId,
        ok: true,
        action: request.action,
        data,
      })
    } catch (err) {
      await safeRespond({
        requestId: request.requestId,
        ok: false,
        error: formatXmlError(err),
      })
    }
  }

  function safeRespond(payload: MindmapWriteResponse): Promise<void> {
    // The ack channel has nowhere to report failures (timeout semantics belong
    // to the main process); only avoid an unhandled rejection here.
    return Promise.resolve(deps.respond(payload)).catch(() => undefined)
  }

  return {
    start(): () => void {
      unsubscribe?.()
      unsubscribe = deps.subscribe((request) => void enqueue(request))
      return () => {
        unsubscribe?.()
        unsubscribe = null
        queues.clear()
      }
    },
  }
}

const DEFAULT_POSITION = 'child'
const INSERT_POSITIONS = new Set(['root', 'child', 'after', 'before'])
const MOVE_POSITIONS = new Set(['child', 'after', 'before'])

/**
 * 原子校验 + 落图：校验失败抛 MindmapXmlError（错误码 + 恢复策略由 formatXmlError
 * 统一格式化），不触碰编辑器；成功返回 `data` 载荷（ack 的一部分）。
 * 校验顺序与主进程快照校验一致（01 移入共享库后同一词汇表）。
 */
async function applyWriteAction(
  action: string,
  args: Record<string, unknown>,
  editor: MindmapEditor,
): Promise<unknown> {
  switch (action) {
    case 'insertXmlFragment': {
      const { xml, parentId, position } = args as {
        xml?: unknown
        parentId?: string
        position?: 'root' | 'child' | 'after' | 'before'
      }
      if (typeof xml !== 'string') {
        throw new MindmapXmlError('empty_xml', 'xml 参数缺失')
      }
      if (typeof position !== 'undefined' && !INSERT_POSITIONS.has(position)) {
        throw new Error(`position 参数无效：${String(position)}，只能是 root/child/after/before`)
      }
      const parsed = await parseXmlFragment(xml)
      const state = editor.getState()
      const { ctx } = buildValidationContext(state.nodes, state.edges, state.assets)
      validateFragmentForInsert(parsed, ctx)
      const pos = position ?? DEFAULT_POSITION
      if (pos !== 'root' && parentId && !ctx.nodeIds.has(parentId)) {
        throw new MindmapXmlError('block_not_found', `定位节点「${parentId}」不存在`)
      }
      await editor.insertFromXml(xml, { parentId, position: pos })
      return { nodeCount: parsed.nodes.length, parentId: parentId ?? null, position: pos }
    }

    case 'updateMindmapNode': {
      const { xml } = args as { xml?: unknown }
      if (typeof xml !== 'string') {
        throw new MindmapXmlError('empty_xml', 'xml 参数缺失')
      }
      const parsed = await parseXmlFragment(xml)
      await editor.replaceNodeFromXml(xml)
      return { xml, nodeId: parsed.rootIds[0], nodeCount: parsed.nodes.length }
    }

    case 'moveMindmapNode': {
      const { nodeId, targetId, position } = args as {
        nodeId?: unknown
        targetId?: unknown
        position?: 'child' | 'after' | 'before'
      }
      if (typeof nodeId !== 'string' || !nodeId.trim()) {
        throw new MindmapXmlError('block_not_found', 'nodeId 参数缺失')
      }
      if (typeof position !== 'undefined' && !MOVE_POSITIONS.has(position)) {
        throw new Error(`position 参数无效：${String(position)}，只能是 child/after/before`)
      }
      const target = typeof targetId === 'string' && targetId.trim() ? targetId : 'root'
      const state = editor.getState()
      const { ctx, childrenOf } = buildValidationContext(state.nodes, state.edges, state.assets)
      validateMove(nodeId, target, { nodeIds: ctx.nodeIds, childrenOf })
      const pos = position ?? DEFAULT_POSITION
      editor.moveSubtree(nodeId, target, pos)
      return { nodeId, targetId: target, position: pos }
    }

    case 'deleteNode': {
      const { nodeId, confirmDeleteSubtree } = args as {
        nodeId?: unknown
        confirmDeleteSubtree?: unknown
      }
      if (typeof nodeId !== 'string' || !nodeId.trim()) {
        throw new MindmapXmlError('block_not_found', 'nodeId 参数缺失')
      }
      if (nodeId === 'root') {
        throw new MindmapXmlError('tree_invalid', 'root 是导图锚点，不可删除')
      }
      // The renderer responder is now the sole validator (main-process snapshot
      // validation was removed): a missing node must fail with block_not_found
      // instead of silently no-oping and acing a false success.
      const state = editor.getState()
      const { ctx } = buildValidationContext(state.nodes, state.edges, state.assets)
      if (!ctx.nodeIds.has(nodeId)) {
        throw new MindmapXmlError(
          'block_not_found',
          `节点「${nodeId}」不存在，请先 readMindmap 重新定位`,
        )
      }
      if (confirmDeleteSubtree === false) {
        return { nodeId, deleted: false }
      }
      editor.deleteSubtree(nodeId)
      return { nodeId, deleted: true }
    }

    default:
      throw new Error(`未知的落盘动作：${action}`)
  }
}
