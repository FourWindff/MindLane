import { useCallback } from 'react'
import { Landmark, Move, PenLine, Plus, Trash2 } from 'lucide-react'
import type { Edge, Node } from '@xyflow/react'
import { useActiveMindmapEditor } from '@/features/mindmap/hooks/useActiveMindmapEditor'
import { useActiveMindmapStore } from '@/features/mindmap/hooks/useActiveMindmapStore'
import { selectCurrentChatBusy, useAiStore } from '@/features/chat/model/aiStore'
import { reportRendererError } from '@/shared/lib/reportRendererError'
import { findParentId, getChildIdsOrdered, newId } from '@/shared/lib/mindmapTree'
import { assetFromDataUrl } from '@/shared/lib/mindmapXml/asset'
import { VISUAL_VARIANTS } from '@/features/mindmap/style/presets'
import type { VisualVariant } from '@/features/mindmap/style/types'
import type { MindmapCommand } from '@/features/mindmap/model/types'
import type { MindmapState } from '@/features/mindmap/model/mindmapStore'
import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'

/**
 * Agent 写操作的模拟面板（开发调试用）：四个写操作按钮分别走与 AI 写工具完全相同的
 * 编辑器入口（insertFromXml / replaceNodeFromXml / moveSubtree / deleteSubtree），
 * 用于不调用真实 AI 的情况下肉眼观察级联入场/粒子/滑翔动画。不进入任何
 * 历史以外的状态（动画标记为瞬态，与真实写操作一致）。
 *
 * 第五个按钮「模拟宫殿」重放「生成记忆宫殿」的整条用户操作：占位节点插在选中节点
 * 原位、选中节点挂到宫殿下并打处理标记、等假子图返回后内嵌图片并展开。编排是
 * usePalaceGeneration 的 dev 副本——生产 hook 不为此留接缝，代价是两者可能漂移。
 */

const INSERT_FRAGMENT = `<node type="text" content="模拟分支A">
  <node type="text" content="A1" />
  <node type="text" content="A2"><node type="text" content="A21" /></node>
</node>
<node type="text" content="模拟分支B">
  <node type="text" content="B1" />
</node>`

// ─── 记忆宫殿模拟：（假子图 + 整体编排）─────────────────────────────────────

/** 假子图的耗时；够看清「生成中…」占位与处理标记。 */
const PALACE_SIM_GENERATION_MS = 2400
const PALACE_SIM_LABEL = '模拟记忆宫殿'

/**
 * ASCII-only SVG so `btoa` can encode it; no text inside (palace images forbid labels).
 * The three landmarks sit at the station pin positions below.
 */
const PALACE_SIM_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#141c33"/>
      <stop offset="0.6" stop-color="#43395c"/>
      <stop offset="1" stop-color="#8a5c42"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4a3a30"/>
      <stop offset="1" stop-color="#1d1715"/>
    </linearGradient>
    <linearGradient id="stone" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#9a9ab2"/>
      <stop offset="1" stop-color="#4b4960"/>
    </linearGradient>
    <linearGradient id="flame" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#1b6fff"/>
      <stop offset="0.65" stop-color="#59c8ff"/>
      <stop offset="1" stop-color="#e8fbff"/>
    </linearGradient>
    <radialGradient id="pool" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffd9a0" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75">
      <stop offset="0.5" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.5"/>
    </radialGradient>
  </defs>

  <rect width="800" height="500" fill="url(#wall)"/>

  <g fill="#10162b" opacity="0.9">
    <path d="M120 340V200a60 60 0 0 1 120 0v140z"/>
    <path d="M340 340V186a60 60 0 0 1 120 0v154z"/>
    <path d="M560 340V200a60 60 0 0 1 120 0v140z"/>
  </g>
  <g fill="#2b2b45">
    <rect x="252" y="168" width="24" height="172"/>
    <rect x="524" y="168" width="24" height="172"/>
    <rect x="26" y="148" width="30" height="192"/>
    <rect x="744" y="148" width="30" height="192"/>
  </g>

  <rect y="340" width="800" height="160" fill="url(#floor)"/>
  <g stroke="#6b5847" stroke-width="1.5" opacity="0.45" fill="none">
    <path d="M400 340 160 500M400 340 300 500M400 340 400 500M400 340 500 500M400 340 640 500"/>
    <path d="M40 372h720M0 424h800M-40 480h880"/>
  </g>
  <ellipse cx="400" cy="404" rx="340" ry="124" fill="url(#pool)"/>

  <g>
    <g stroke="#c8b06a" stroke-width="3" fill="none">
      <path d="M400 0v72"/>
      <path d="M356 112a44 44 0 0 0 88 0"/>
    </g>
    <circle cx="400" cy="132" r="74" fill="#ffe9b0" opacity="0.16"/>
    <circle cx="400" cy="132" r="42" fill="#ffe9b0" opacity="0.22"/>
    <g fill="#bfe8ff" stroke="#7fb6d6" stroke-width="2">
      <path d="M400 74l26 30-26 26-26-26z"/>
      <path d="M358 108l20 24-20 20-20-20z"/>
      <path d="M442 108l20 24-20 20-20-20z"/>
      <path d="M400 138l18 22-18 18-18-18z"/>
    </g>
    <circle cx="400" cy="124" r="16" fill="#fff6d8" opacity="0.95"/>
  </g>

  <g>
    <ellipse cx="176" cy="356" rx="88" ry="20" fill="#000000" opacity="0.35"/>
    <rect x="150" y="250" width="54" height="48" rx="6" fill="#5a5a74"/>
    <path d="M118 300a58 48 0 0 1 116 0v54h-116z" fill="url(#stone)"/>
    <ellipse cx="176" cy="300" rx="42" ry="32" fill="#241d2c"/>
    <g fill="url(#flame)">
      <path d="M176 250c9 16 20 23 20 38a20 25 0 0 1-40 0c0-15 11-22 20-38z"/>
      <path d="M148 270c6 11 13 15 13 26a13 17 0 0 1-26 0c0-11 7-15 13-26z" opacity="0.85"/>
      <path d="M204 270c6 11 13 15 13 26a13 17 0 0 1-26 0c0-11 7-15 13-26z" opacity="0.85"/>
    </g>
    <path d="M176 296c6 9 11 13 11 19a11 14 0 0 1-22 0c0-6 5-10 11-19z" fill="#eafcff"/>
    <rect x="108" y="352" width="136" height="14" rx="5" fill="#3d3d54"/>
  </g>

  <g>
    <ellipse cx="624" cy="410" rx="96" ry="20" fill="#000000" opacity="0.3"/>
    <path d="M548 360h34v-12h34v-12h34v-12h34v-12h16v100h-152z" fill="#7d6650" stroke="#4a3a2c" stroke-width="2"/>
    <g stroke="#5d8f45" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.9">
      <path d="M566 344c20-26 6-52 34-68"/>
      <path d="M604 336c24-20 14-44 40-56"/>
      <path d="M646 330c16-14 12-32 30-40"/>
    </g>
    <g fill="#8ec46a">
      <circle cx="600" cy="278" r="7"/>
      <circle cx="646" cy="282" r="6"/>
      <circle cx="568" cy="296" r="5"/>
      <circle cx="680" cy="292" r="5"/>
    </g>
  </g>

  <rect width="800" height="500" fill="url(#vignette)"/>
</svg>`

/** Embedded as a base64 data URL, so it lands through the same asset path as a real picture. */
const PALACE_SIM_IMAGE_DATA_URL = `data:image/svg+xml;base64,${btoa(PALACE_SIM_IMAGE_SVG)}`

/** Stations land on the SVG landmarks above, so the modal pins line up with the picture. */
const PALACE_SIM_STATIONS = [
  {
    content: '模拟站点：写操作入口',
    anchorVisual: '冒着蓝色火焰的巨型炼金炉',
    association: '炉膛是写入口，蓝焰越旺级联入场越急',
    x: 0.22,
    y: 0.6,
  },
  {
    content: '模拟站点：父先子后',
    anchorVisual: '穹顶垂下的巨型水晶吊灯',
    association: '吊灯逐层点亮，正如父节点先于子节点入场',
    x: 0.5,
    y: 0.26,
  },
  {
    content: '模拟站点：宫殿图片内嵌',
    anchorVisual: '缠满藤蔓的旋转石梯',
    association: '沿石梯盘旋而上，正如沿站点路线巡游',
    x: 0.78,
    y: 0.68,
  },
] as const

export interface PalaceSimInput {
  editor: MindmapEditor
  nodes: Node[]
  edges: Edge[]
  /** 当前选中节点，保持选中顺序 */
  selectedNodes: Array<{ id: string; label: string }>
  visualVariant: VisualVariant
  addAsset: MindmapState['addAsset']
}

/**
 * 重放记忆宫殿的用户操作（不调主进程、不需要 API Key）：与真实流程同序——插占位 →
 * 重挂选中节点 + 处理标记 + busy/analyzing → 假子图等 2.4s → 内嵌图片 → 提交展开。
 * 真实流程的占位与落图都在落图应答器里（`landPalace` 写动作），本 panel 保留一份独立
 * 副本以便脱离主进程演示；站点与图片按选中节点生成，站点内容取自节点标签。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 由本 panel 的测试直接调用，代价只是 HMR 整页刷新
export async function simulatePalaceInsert({
  editor,
  nodes,
  edges,
  selectedNodes,
  visualVariant,
  addAsset,
}: PalaceSimInput): Promise<void> {
  const ai = useAiStore.getState()
  if (selectCurrentChatBusy(ai)) return
  const first = selectedNodes[0]
  if (!first) return

  const palaceId = newId()
  const parentId = findParentId(edges, first.id) ?? 'root'
  const parentNode = nodes.find((node) => node.id === parentId)
  const firstSelected = nodes.find((node) => node.id === first.id)
  const offsetX = VISUAL_VARIANTS[visualVariant].spacing.offsetX
  const selectedIds = selectedNodes.map((node) => node.id)
  const selectedIdSet = new Set(selectedIds)

  // Placeholder sits where the selection is, and takes the selection over as children.
  const placeholderNode: Node = {
    id: palaceId,
    type: 'palace',
    position: {
      x: firstSelected?.position.x ?? (parentNode?.position.x ?? 0) + offsetX,
      y: firstSelected?.position.y ?? parentNode?.position.y ?? 0,
    },
    data: {
      label: '生成中…',
      imageUrl: '',
      stations: [],
      sourceNodeIds: selectedIds,
      generating: true,
    },
  }
  const commands: MindmapCommand[] = [
    {
      type: 'addNode',
      node: placeholderNode,
      edge: {
        id: `e-${parentId}-${palaceId}`,
        source: parentId,
        target: palaceId,
        type: 'mindmap',
        className: 'mindmap-edge',
      },
    },
    ...selectedIds.map((nodeId) => ({
      type: 'addEdge' as const,
      edge: {
        id: `e-${palaceId}-${nodeId}`,
        source: palaceId,
        target: nodeId,
        type: 'mindmap',
        className: 'mindmap-edge',
      },
    })),
    ...edges
      .filter((edge) => edge.source === parentId && selectedIdSet.has(edge.target))
      .map((edge) => ({ type: 'removeEdge' as const, edgeId: edge.id })),
  ]

  for (const nodeId of selectedIds) editor.setNodeFlag(nodeId, 'processing', true)
  editor.batch(commands)
  ai.setBusy(true)

  await new Promise((resolve) => setTimeout(resolve, PALACE_SIM_GENERATION_MS))

  const asset = await assetFromDataUrl(PALACE_SIM_IMAGE_DATA_URL)
  if (!asset) {
    // Same rollback shape as the real flow: one undo plus cleared flags.
    editor.undo()
    for (const nodeId of selectedIds) editor.clearNodeFlag(nodeId, 'processing')
    reportRendererError('模拟宫殿图片解析失败，本次插入已取消')
    ai.setBusy(false)
    return
  }

  const assetId = addAsset(asset)
  editor.batch([
    {
      type: 'updateNode',
      nodeId: palaceId,
      patch: (node) => ({
        ...node,
        data: {
          label: PALACE_SIM_LABEL,
          assetId,
          imageUrl: '',
          // One station per selected node; anchor visuals cycle over the three landmarks
          // the fixture scene actually draws.
          stations: selectedNodes.map((selected, index) => {
            const fixture = PALACE_SIM_STATIONS[index % PALACE_SIM_STATIONS.length]
            return {
              order: index + 1,
              linkedNodeId: selected.id,
              content: selected.label || fixture.content,
              anchorVisual: fixture.anchorVisual,
              association: fixture.association,
              x: fixture.x,
              y: fixture.y,
            }
          }),
          sourceNodeIds: selectedIds,
          expanded: true,
          generating: undefined,
        },
      }),
    },
    ...selectedIds.map((nodeId) => ({
      type: 'updateNode' as const,
      nodeId,
      patch: (node: Node) => ({ ...node, data: { ...node.data, processing: undefined } }),
    })),
  ])
  ai.reset()
}

// ─── 面板 ─────────────────────────────────────────────────────────────────────

function rootChildIds(editor: MindmapEditor): string[] {
  const { nodes, edges } = editor.getState()
  return getChildIdsOrdered(nodes, edges, 'root')
}

export function AgentWriteSimulator() {
  const editor = useActiveMindmapEditor()
  const addAsset = useActiveMindmapStore((s) => s.addAsset)
  // Primitive selectors only: zustand v5 useStore compares selector output with
  // Object.is, so an object-literal selector here loops useSyncExternalStore
  // into an infinite re-render (white screen).
  const nodes = useActiveMindmapStore((s) => s.nodes)
  const edges = useActiveMindmapStore((s) => s.edges)
  const visualVariant = useActiveMindmapStore((s) => s.style.visualVariant)
  const rootChildren = getChildIdsOrdered(nodes, edges, 'root')
  const canUpdate = rootChildren.length >= 1
  const canMove = rootChildren.length >= 2
  const canDelete = rootChildren.length >= 1
  const selectedTopicCount = nodes.filter((n) => n.selected && n.type === 'text').length

  const simulateInsert = useCallback(() => {
    void editor.insertFromXml(INSERT_FRAGMENT, { parentId: 'root' })
  }, [editor])

  const simulateUpdate = useCallback(() => {
    const [targetId] = rootChildIds(editor)
    if (!targetId) return
    const stamp = Date.now() % 100000
    void editor.replaceNodeFromXml(
      `<node id="${targetId}" type="text" content="已更新-${stamp}">
         <node type="text" content="U1" />
         <node type="text" content="U2" />
       </node>`,
    )
  }, [editor])

  const simulateMove = useCallback(() => {
    const [first, second] = rootChildIds(editor)
    if (!first || !second) return
    // move the second subtree under the first so the glide is visible
    editor.moveSubtree(second, first, 'child')
  }, [editor])

  const simulateDelete = useCallback(() => {
    const ids = rootChildIds(editor)
    const last = ids[ids.length - 1]
    if (!last) return
    // delete the last subtree so the reverse cascade exit is visible
    editor.deleteSubtree(last)
  }, [editor])

  const simulatePalace = useCallback(() => {
    const selectedNodes = nodes
      .filter((node) => node.selected && node.type === 'text')
      .map((node) => ({ id: node.id, label: String(node.data?.label ?? '') }))
    if (selectedNodes.length === 0) return
    void simulatePalaceInsert({ editor, nodes, edges, selectedNodes, visualVariant, addAsset })
  }, [addAsset, editor, edges, nodes, visualVariant])

  return (
    <div className="agent-write-sim" aria-label="AI 写操作模拟面板">
      <button
        type="button"
        className="agent-write-sim__btn"
        onClick={simulateInsert}
        title="模拟 insertXmlFragment：插入多级片段，观察父先于子的级联入场与粒子"
      >
        <Plus size={14} strokeWidth={1.5} />
        模拟插入
      </button>
      <button
        type="button"
        className="agent-write-sim__btn"
        onClick={simulateUpdate}
        disabled={!canUpdate}
        title="模拟 updateMindmapNode：替换根下第一个子树，观察新树级联入场"
      >
        <PenLine size={14} strokeWidth={1.5} />
        模拟更新
      </button>
      <button
        type="button"
        className="agent-write-sim__btn"
        onClick={simulateMove}
        disabled={!canMove}
        title="模拟 moveMindmapNode：把第二个根级子树移到第一个之下，观察整棵滑翔"
      >
        <Move size={14} strokeWidth={1.5} />
        模拟移动
      </button>
      <button
        type="button"
        className="agent-write-sim__btn"
        onClick={simulateDelete}
        disabled={!canDelete}
        title="模拟 deleteMindmapNode：删除最后一个根级子树，观察子先父后的反向级联退出"
      >
        <Trash2 size={14} strokeWidth={1.5} />
        模拟删除
      </button>
      <button
        type="button"
        className="agent-write-sim__btn"
        onClick={simulatePalace}
        disabled={selectedTopicCount === 0}
        title={
          selectedTopicCount === 0
            ? '先在导图中选中 1 个及以上文本节点，模拟会像「生成记忆宫殿」一样把宫殿插在它们前面'
            : '模拟生成记忆宫殿：与「生成记忆宫殿」同序——先插入「生成中…」占位节点、把选中节点挂到宫殿下并打上处理标记，等假子图返回后再内嵌图片并展开'
        }
      >
        <Landmark size={14} strokeWidth={1.5} />
        模拟宫殿
      </button>
    </div>
  )
}
