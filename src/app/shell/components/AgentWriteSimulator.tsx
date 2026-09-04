import { useCallback } from 'react'
import { Move, PenLine, Plus, Trash2 } from 'lucide-react'
import { useActiveMindmapEditor } from '@/features/mindmap/hooks/useActiveMindmapEditor'
import { useActiveMindmapStore } from '@/features/mindmap/hooks/useActiveMindmapStore'
import { getChildIdsOrdered } from '@/shared/lib/mindmapTree'
import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'

/**
 * Agent 写操作的模拟面板（开发调试用）：四个按钮分别走与 AI 写工具完全相同的
 * 编辑器入口（insertFromXml / replaceNodeFromXml / moveSubtree / deleteSubtree），
 * 用于不调用真实 AI 的情况下肉眼观察级联入场/粒子/滑翔动画。不进入任何
 * 历史以外的状态（动画标记为瞬态，与真实写操作一致）。
 */

const INSERT_FRAGMENT = `<node type="text" content="模拟分支A">
  <node type="text" content="A1" />
  <node type="text" content="A2"><node type="text" content="A21" /></node>
</node>
<node type="text" content="模拟分支B">
  <node type="text" content="B1" />
</node>`

function rootChildIds(editor: MindmapEditor): string[] {
  const { nodes, edges } = editor.getState()
  return getChildIdsOrdered(nodes, edges, 'root')
}

export function AgentWriteSimulator() {
  const editor = useActiveMindmapEditor()
  // Primitive selectors only: zustand v5 useStore compares selector output with
  // Object.is, so an object-literal selector here loops useSyncExternalStore
  // into an infinite re-render (white screen).
  const nodes = useActiveMindmapStore((s) => s.nodes)
  const edges = useActiveMindmapStore((s) => s.edges)
  const rootChildren = getChildIdsOrdered(nodes, edges, 'root')
  const canUpdate = rootChildren.length >= 1
  const canMove = rootChildren.length >= 2
  const canDelete = rootChildren.length >= 1

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
    </div>
  )
}
