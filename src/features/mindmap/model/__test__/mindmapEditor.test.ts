import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMindmapStore } from '../mindmapStore'
import { MindmapHistory } from '../mindmapHistory'
import { MindmapEditor } from '../mindmapEditor'

describe('MindmapEditor', () => {
  let store: ReturnType<typeof createMindmapStore>
  let history: MindmapHistory
  let editor: MindmapEditor

  beforeEach(() => {
    store = createMindmapStore()
    history = new MindmapHistory()
    editor = new MindmapEditor(store, history)
    editor.newFile('测试')
  })

  function rootId(): string {
    return store.getState().nodes[0]!.id
  }

  describe('addNode / addChild / addSibling', () => {
    it('should add a child node and record history', () => {
      const { nodeId } = editor.addChild(rootId())

      expect(store.getState().nodes.some((n) => n.id === nodeId)).toBe(true)
      expect(store.getState().canUndo).toBe(true)
      expect(store.getState().dirty).toBe(true)
    })

    it('should undo addNode and remove the node and edge', () => {
      const beforeNodeCount = store.getState().nodes.length
      const beforeEdgeCount = store.getState().edges.length

      editor.addChild(rootId())
      expect(store.getState().nodes.length).toBe(beforeNodeCount + 1)
      expect(store.getState().edges.length).toBe(beforeEdgeCount + 1)

      editor.undo()
      expect(store.getState().nodes.length).toBe(beforeNodeCount)
      expect(store.getState().edges.length).toBe(beforeEdgeCount)
      expect(store.getState().canUndo).toBe(false)
      expect(store.getState().canRedo).toBe(true)
    })

    it('should redo addNode and restore the same structure', () => {
      const { nodeId } = editor.addChild(rootId())
      editor.undo()

      editor.redo()
      expect(store.getState().nodes.some((n) => n.id === nodeId)).toBe(true)
      expect(store.getState().canUndo).toBe(true)
      expect(store.getState().canRedo).toBe(false)
    })

    it('should add a sibling under the same parent', () => {
      const { nodeId: childId } = editor.addChild(rootId())
      const result = editor.addSibling(childId)

      expect(result).not.toBeNull()
      const edge = store.getState().edges.find((e) => e.target === result!.nodeId)
      expect(edge?.source).toBe(rootId())
    })

    it('should return null when adding sibling to root', () => {
      const result = editor.addSibling(rootId())
      expect(result).toBeNull()
    })
  })

  describe('updateNode', () => {
    it('should update node label and allow undo/redo', () => {
      editor.updateNode(rootId(), (n) => ({ ...n, data: { ...n.data, label: '已更新' } }))

      expect((store.getState().nodes[0]!.data as { label: string }).label).toBe('已更新')

      editor.undo()
      expect((store.getState().nodes[0]!.data as { label: string }).label).toBe('中心主题')

      editor.redo()
      expect((store.getState().nodes[0]!.data as { label: string }).label).toBe('已更新')
    })
  })

  describe('deleteSubtree', () => {
    it('should delete a subtree after the exit animation', () => {
      vi.useFakeTimers()
      const { nodeId: childId } = editor.addChild(rootId())
      const beforeNodeCount = store.getState().nodes.length

      editor.deleteSubtree(childId)
      expect(store.getState().nodes.some((n) => n.id === childId && n.data.exiting)).toBe(true)

      vi.advanceTimersByTime(300)
      expect(store.getState().nodes.length).toBe(beforeNodeCount - 1)
      expect(store.getState().nodes.some((n) => n.id === childId)).toBe(false)

      editor.undo()
      expect(store.getState().nodes.length).toBe(beforeNodeCount)
      expect(store.getState().nodes.some((n) => n.id === childId)).toBe(true)

      vi.useRealTimers()
    })
  })

  describe('moveNode', () => {
    it('should move a node and allow undo/redo', () => {
      const { nodeId } = editor.addChild(rootId())
      const beforeX = store.getState().nodes.find((n) => n.id === nodeId)!.position.x

      editor.moveNode(nodeId, { x: beforeX + 100, y: 0 })
      expect(store.getState().nodes.find((n) => n.id === nodeId)!.position.x).toBe(beforeX + 100)

      editor.undo()
      expect(store.getState().nodes.find((n) => n.id === nodeId)!.position.x).toBe(beforeX)
    })
  })

  describe('addEdge / removeEdge', () => {
    it('should add and remove an edge', () => {
      const { nodeId: a } = editor.addChild(rootId())
      const { nodeId: b } = editor.addChild(rootId())
      const edgeId = `e_${a}_${b}`

      editor.addEdge({ id: edgeId, source: a, target: b, type: 'mindmap' })
      expect(store.getState().edges.some((e) => e.id === edgeId)).toBe(true)

      editor.removeEdge(edgeId)
      expect(store.getState().edges.some((e) => e.id === edgeId)).toBe(false)

      editor.undo()
      expect(store.getState().edges.some((e) => e.id === edgeId)).toBe(true)
    })
  })

  describe('native change routing', () => {
    it('should record position changes as moveNode and allow undo', () => {
      const { nodeId } = editor.addChild(rootId())
      const beforeX = store.getState().nodes.find((n) => n.id === nodeId)!.position.x

      editor.applyNativeNodeChanges(
        [{ id: nodeId, type: 'position', position: { x: beforeX + 100, y: 0 } }],
        'logic',
      )

      expect(store.getState().nodes.find((n) => n.id === nodeId)!.position.x).toBe(beforeX + 100)
      expect(store.getState().canUndo).toBe(true)

      editor.undo()
      expect(store.getState().nodes.find((n) => n.id === nodeId)!.position.x).toBe(beforeX)
    })

    it('should apply edge remove and connect through native changes', () => {
      const { nodeId: a } = editor.addChild(rootId())
      const { nodeId: b } = editor.addChild(rootId())
      const edgeId = `e_${a}_${b}`

      editor.applyNativeConnect({ source: a, target: b, sourceHandle: null, targetHandle: null })
      expect(store.getState().edges.some((e) => e.source === a && e.target === b)).toBe(true)

      editor.applyNativeEdgeChanges([{ id: edgeId, type: 'remove' }])
      expect(store.getState().edges.some((e) => e.id === edgeId)).toBe(false)

      editor.undo()
      expect(store.getState().edges.some((e) => e.id === edgeId)).toBe(true)
    })
  })

  describe('batch', () => {
    it('should group multiple commands into a single undo step', () => {
      const beforeNodeCount = store.getState().nodes.length

      editor.batch([
        {
          type: 'addNode',
          node: { id: 'batch-a', type: 'text', position: { x: 0, y: 0 }, data: { label: 'A' } },
        },
        {
          type: 'addNode',
          node: { id: 'batch-b', type: 'text', position: { x: 0, y: 0 }, data: { label: 'B' } },
        },
      ])

      expect(store.getState().nodes.length).toBe(beforeNodeCount + 2)
      expect(store.getState().canUndo).toBe(true)

      editor.undo()
      expect(store.getState().nodes.length).toBe(beforeNodeCount)
      expect(store.getState().canRedo).toBe(true)
    })
  })

  describe('insertFromYaml', () => {
    it('should insert a YAML fragment as a single batch', () => {
      const beforeNodeCount = store.getState().nodes.length
      editor.insertFromYaml(
        `
- "子主题 A":
  - "子主题 A1"
- "子主题 B"
`,
        { parentId: rootId() },
      )

      const labels = store.getState().nodes.map((n) => (n.data as { label: string }).label)
      expect(labels).toContain('子主题 A')
      expect(labels).toContain('子主题 A1')
      expect(labels).toContain('子主题 B')
      expect(store.getState().nodes.length).toBe(beforeNodeCount + 3)

      editor.undo()
      expect(store.getState().nodes.length).toBe(beforeNodeCount)
    })
  })

  describe('transient UI helpers', () => {
    it('should set editing flag without recording history', () => {
      editor.setNodeEditing(rootId(), true)
      expect(store.getState().nodes[0]!.data.editing).toBe(true)
      expect(store.getState().canUndo).toBe(false)

      editor.setNodeEditing(rootId(), false)
      expect(store.getState().nodes[0]!.data.editing).toBeUndefined()
    })

    it('should commit label change as a recorded update and leave escape transient', () => {
      // 模拟 Escape：仅清除 editing 标记，不创建事务
      editor.setNodeEditing(rootId(), true)
      editor.setNodeEditing(rootId(), false)
      expect(store.getState().canUndo).toBe(false)

      // 模拟提交：调用 updateNode 创建事务
      editor.updateNode(rootId(), (n) => ({ ...n, data: { ...n.data, label: '已提交' } }))
      expect(store.getState().canUndo).toBe(true)
      expect((store.getState().nodes[0]!.data as { label: string }).label).toBe('已提交')

      editor.undo()
      expect((store.getState().nodes[0]!.data as { label: string }).label).toBe('中心主题')
    })

    it('should clear node flag without recording history', () => {
      store.setState((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === rootId() ? { ...n, data: { ...n.data, justAdded: true } } : n,
        ),
      }))
      editor.clearNodeFlag(rootId(), 'justAdded')
      expect(store.getState().nodes[0]!.data.justAdded).toBeUndefined()
      expect(store.getState().canUndo).toBe(false)
    })
  })

  describe('reset', () => {
    it('should reset graph and clear history', () => {
      editor.addChild(rootId())
      editor.reset()

      expect(store.getState().nodes.length).toBe(1)
      expect(store.getState().canUndo).toBe(false)
      expect(store.getState().canRedo).toBe(false)
    })
  })
})
