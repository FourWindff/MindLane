import type { Edge, Node } from '@xyflow/react'
import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'
import type { MindmapCommand } from '@/features/mindmap/model/types'
import { CHILD_OFFSET_X, findParentId, newId } from '@/shared/lib/mindmapTree'
import {
  MindmapXmlError,
  buildValidationContext,
  formatXmlError,
  isValidSvgArtwork,
  parseXmlFragment,
  serializeTreeFragment,
  type MindlaneAsset,
  validateMove,
} from '@/shared/lib/mindmapXml'
import { assetFromDataUrl, parseDataUrl } from '@/shared/lib/mindmapXml/asset'
import type {
  MindmapWriteRequest,
  MindmapWriteResponse,
  WriteAction,
  WriteActionArgs,
} from '../../../../electron/ipc'

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
  /** 可恢复的落图降级写入排障日志。 */
  warn: (message: string) => void
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
      const data = await applyWriteAction(request.action, request.args, editor, deps.warn)
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
const PALACE_TYPE = 'palace'

function decodeBase64Utf8(data: string): string | null {
  try {
    const binary = atob(data)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

async function materializePalaceArtwork(
  xml: string,
  editor: MindmapEditor,
  warn: (message: string) => void,
): Promise<{ xml: string; nodeCount: number; rootId: string; assets: MindlaneAsset[] }> {
  const parsed = await parseXmlFragment(xml)
  const assets: MindlaneAsset[] = []
  let changed = false

  for (const node of parsed.nodes) {
    if (node.type !== PALACE_TYPE) continue
    const data = node.data as Record<string, unknown>
    if (typeof data.assetId === 'string' && data.assetId) continue
    if (typeof data.imageUrl !== 'string') continue

    const dataUrl = parseDataUrl(data.imageUrl)
    if (!dataUrl) continue
    if (dataUrl.mime.toLowerCase() === 'image/svg+xml') {
      const svg = decodeBase64Utf8(dataUrl.data)
      const stationCount = Array.isArray(data.stations) ? data.stations.length : 0
      if (!svg || !isValidSvgArtwork(svg, stationCount)) {
        delete data.imageUrl
        changed = true
        warn('宫殿画面未通过闸门，使用无图宫殿')
        continue
      }
    }

    const asset = await assetFromDataUrl(data.imageUrl)
    if (!asset) continue
    const existingAsset = [...editor.getState().assets, ...assets].find(
      (candidate) => candidate.sha256 === asset.sha256,
    )
    data.assetId = existingAsset?.id ?? asset.id
    if (!existingAsset) assets.push(asset)
    delete data.imageUrl
    changed = true
  }

  return {
    xml: changed ? serializeTreeFragment(parsed.nodes, parsed.edges) : xml,
    nodeCount: parsed.nodes.length,
    rootId: parsed.rootIds[0]!,
    assets,
  }
}

/**
 * MindmapEditor.batch + editor.getState().addAsset use the same store: this
 * responder is the sole writer for both, so it can leave the batch
 * bookkeeping to the editor.
 */
function clearProcessingCommands(sourceNodeIds: string[]): MindmapCommand[] {
  return sourceNodeIds.map((nodeId) => ({
    type: 'updateNode' as const,
    nodeId,
    patch: (node: Node) => ({ ...node, data: { ...node.data, processing: undefined } }),
  }))
}

/**
 * Deterministic palace placement (CONTEXT.md「确定性落图」): under the parent of
 * the first source node, at that node's position (so the palace takes the slot
 * and the source nodes move under it). No source nodes → a new child of root.
 */
function palacePlacement(
  editor: MindmapEditor,
  sourceNodeIds: string[],
): { parentId: string; position: { x: number; y: number } } {
  const { nodes, edges } = editor.getState()
  const firstSource = sourceNodeIds[0]
    ? nodes.find((node) => node.id === sourceNodeIds[0])
    : undefined
  const parentId = (firstSource ? findParentId(edges, firstSource.id) : null) ?? 'root'
  if (firstSource) return { parentId, position: firstSource.position }
  const parentNode = nodes.find((node) => node.id === parentId)
  return {
    parentId,
    position: {
      x: (parentNode?.position.x ?? 0) + CHILD_OFFSET_X,
      y: parentNode?.position.y ?? 0,
    },
  }
}

/**
 * 手动运行的占位宫殿：payload 还没生成时先给出进度与「继续」入口。放置代码与
 * 落图的插入分支共用，所以占位节点与最终宫殿落在同一位置。
 * 返回节点 id（渲染层运行登记表按它定位）。
 */
export function insertPalacePlaceholder(
  editor: MindmapEditor,
  sourceNodeIds: string[],
): { nodeId: string } {
  const palaceId = newId()
  const { parentId, position } = palacePlacement(editor, sourceNodeIds)
  for (const nodeId of sourceNodeIds) editor.setNodeFlag(nodeId, 'processing', true)
  editor.batch([
    {
      type: 'addNode',
      node: {
        id: palaceId,
        type: PALACE_TYPE,
        position,
        data: {
          label: '生成中…',
          imageUrl: '',
          stations: [],
          sourceNodeIds,
          generating: true,
        },
      },
      edge: {
        id: `e-${parentId}-${palaceId}`,
        source: parentId,
        target: palaceId,
        type: 'mindmap',
        className: 'mindmap-edge',
      },
    },
    ...placeSourceNodesCommands(editor, palaceId, sourceNodeIds),
  ])
  return { nodeId: palaceId }
}

/**
 * Rewire: parent → palace → each source node. Every incoming edge of a source
 * node is replaced (whichever parent it had), so the selection can span several
 * parents without breaking the pure-tree invariant. The root anchor is never
 * reparented — it stays the tree's root.
 */
function placeSourceNodesCommands(
  editor: MindmapEditor,
  palaceId: string,
  sourceNodeIds: string[],
): MindmapCommand[] {
  const { edges, nodes } = editor.getState()
  const live = new Set(nodes.map((node) => node.id))
  // A source node deleted mid-run must not leave a dangling edge behind.
  const sourceIds = new Set(sourceNodeIds.filter((nodeId) => nodeId !== 'root' && live.has(nodeId)))
  const childEdges: Edge[] = [...sourceIds].map((nodeId) => ({
    id: `e-${palaceId}-${nodeId}`,
    source: palaceId,
    target: nodeId,
    type: 'mindmap',
    className: 'mindmap-edge',
  }))
  return [
    ...childEdges.map((edge) => ({ type: 'addEdge' as const, edge })),
    ...edges
      .filter((edge) => sourceIds.has(edge.target))
      .map((edge) => ({ type: 'removeEdge' as const, edgeId: edge.id })),
  ]
}

/**
 * The manual run's placeholder for these source nodes — found by content, so the
 * landing request stays identical for both trigger surfaces (no placeholder id
 * rides over IPC). Two concurrent palaces from the same selection would collide;
 * that is not a reachable user flow (one run per file at a time).
 */
function findPalacePlaceholder(editor: MindmapEditor, sourceNodeIds: string[]): Node | undefined {
  const key = [...sourceNodeIds].sort().join('\0')
  return editor.getState().nodes.find((node) => {
    if (node.type !== PALACE_TYPE || node.data.generating !== true) return false
    const ids = Array.isArray(node.data.sourceNodeIds) ? (node.data.sourceNodeIds as string[]) : []
    return [...ids].sort().join('\0') === key
  })
}

/**
 * 宫殿落图（写动作 landPalace）：XML 由代码从子图 payload 序列化而来（模型不复述
 * 图片 data URL）。占位节点按 sourceNodeIds 就地更新；没有占位节点则新建，并按
 * 「新宫殿 → 选中节点」重挂父边。图片资源在此物化（与 insertXmlFragment 同一闸门）。
 */
async function applyPalaceLanding(
  editor: MindmapEditor,
  materialized: Awaited<ReturnType<typeof materializePalaceArtwork>>,
): Promise<{ nodeId: string; updatedPlaceholder: boolean; sourceNodeIds: string[] }> {
  const parsed = await parseXmlFragment(materialized.xml)
  const palaceNode = parsed.nodes.find((node) => node.type === PALACE_TYPE)
  if (!palaceNode) {
    throw new MindmapXmlError('invalid_type', '落图片段缺少 palace 节点')
  }
  const data = palaceNode.data as {
    label?: unknown
    assetId?: unknown
    stations?: unknown
    sourceNodeIds?: unknown
  }
  const sourceNodeIds = Array.isArray(data.sourceNodeIds) ? (data.sourceNodeIds as string[]) : []
  const landedData: Record<string, unknown> = {
    label: typeof data.label === 'string' ? data.label : '',
    stations: Array.isArray(data.stations) ? data.stations : [],
    sourceNodeIds,
    expanded: true,
  }
  if (typeof data.assetId === 'string' && data.assetId) landedData.assetId = data.assetId

  // Assets become live before the node points at them, same as insertFromXml.
  for (const asset of materialized.assets) editor.getState().addAsset(asset)

  const placeholder = findPalacePlaceholder(editor, sourceNodeIds)
  if (placeholder) {
    // The run's own transient flags live only on the placeholder; a fresh node
    // never carries them.
    const clearedFlags = {
      generating: undefined,
      runStage: undefined,
      runStopped: undefined,
    }
    editor.batch([
      {
        type: 'updateNode',
        nodeId: placeholder.id,
        patch: (node: Node) => ({
          ...node,
          data: { ...node.data, ...clearedFlags, ...landedData },
        }),
      },
      ...clearProcessingCommands(sourceNodeIds),
    ])
    return { nodeId: placeholder.id, updatedPlaceholder: true, sourceNodeIds }
  }

  const { parentId, position } = palacePlacement(editor, sourceNodeIds)
  const palaceId = materialized.rootId
  editor.batch([
    {
      type: 'addNode',
      node: { id: palaceId, type: PALACE_TYPE, position, data: landedData },
      edge: {
        id: `e-${parentId}-${palaceId}`,
        source: parentId,
        target: palaceId,
        type: 'mindmap',
        className: 'mindmap-edge',
      },
    },
    ...placeSourceNodesCommands(editor, palaceId, sourceNodeIds),
    ...clearProcessingCommands(sourceNodeIds),
  ])
  return { nodeId: palaceId, updatedPlaceholder: false, sourceNodeIds }
}

/**
 * 原子校验 + 落图：校验失败抛 MindmapXmlError（错误码 + 恢复策略由 formatXmlError
 * 统一格式化），不触碰编辑器；成功返回 `data` 载荷（ack 的一部分）。
 * 校验顺序与主进程快照校验一致（01 移入共享库后同一词汇表）。
 */
async function applyWriteAction(
  action: WriteAction,
  args: Record<string, unknown>,
  editor: MindmapEditor,
  warn: (message: string) => void,
): Promise<unknown> {
  switch (action) {
    case 'landPalace': {
      const { xml } = args as WriteActionArgs['landPalace']
      if (typeof xml !== 'string') {
        throw new MindmapXmlError('empty_xml', 'xml 参数缺失')
      }
      const materialized = await materializePalaceArtwork(xml, editor, warn)
      return applyPalaceLanding(editor, materialized)
    }

    case 'insertXmlFragment': {
      const { xml, parentId, position } = args as WriteActionArgs['insertXmlFragment']
      if (typeof xml !== 'string') {
        throw new MindmapXmlError('empty_xml', 'xml 参数缺失')
      }
      if (typeof position !== 'undefined' && !INSERT_POSITIONS.has(position)) {
        throw new Error(`position 参数无效：${String(position)}，只能是 root/child/after/before`)
      }
      const materialized = await materializePalaceArtwork(xml, editor, warn)
      const state = editor.getState()
      const { ctx } = buildValidationContext(state.nodes, state.edges, state.assets)
      const pos = position ?? DEFAULT_POSITION
      if (pos !== 'root' && parentId && !ctx.nodeIds.has(parentId)) {
        throw new MindmapXmlError('block_not_found', `定位节点「${parentId}」不存在`)
      }
      // insertFromXml re-runs validateFragmentForInsert on the live editor state,
      // so a structural failure surfaces as the same MindmapXmlError from there.
      if (materialized.assets.length > 0) {
        await editor.insertFromXml(
          materialized.xml,
          { parentId, position: pos },
          materialized.assets,
        )
      } else {
        await editor.insertFromXml(materialized.xml, { parentId, position: pos })
      }
      return { nodeCount: materialized.nodeCount, parentId: parentId ?? null, position: pos }
    }

    case 'updateMindmapNode': {
      const { xml } = args as WriteActionArgs['updateMindmapNode']
      if (typeof xml !== 'string') {
        throw new MindmapXmlError('empty_xml', 'xml 参数缺失')
      }
      const materialized = await materializePalaceArtwork(xml, editor, warn)
      if (materialized.assets.length > 0) {
        await editor.replaceNodeFromXml(materialized.xml, materialized.assets)
      } else {
        await editor.replaceNodeFromXml(materialized.xml)
      }
      return {
        xml: materialized.xml,
        nodeId: materialized.rootId,
        nodeCount: materialized.nodeCount,
      }
    }

    case 'moveMindmapNode': {
      const { nodeId, targetId, position } = args as WriteActionArgs['moveMindmapNode']
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
      const { nodeId, confirmDeleteSubtree } = args as WriteActionArgs['deleteNode']
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

    default: {
      // The WriteAction union is exhaustive; this arm is unreachable and only
      // guards against adding a new action without a responder case.
      const neverAction: never = action
      throw new Error(`未知的落盘动作：${neverAction}`)
    }
  }
}
