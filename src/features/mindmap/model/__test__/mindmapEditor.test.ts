import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMindmapStore } from '../mindmapStore'
import { MindmapHistory } from '../mindmapHistory'
import { MindmapEditor } from '../mindmapEditor'
import { getChildIdsOrdered } from '@/shared/lib/mindmapTree'
import { createEmptyFile } from '@/shared/lib/fileFormat'

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

  function childOrder(parentId: string): string[] {
    const { nodes, edges } = store.getState()
    return getChildIdsOrdered(nodes, edges, parentId)
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

  describe('sibling insertion position', () => {
    it('inserts a child at the end of the existing children', () => {
      editor.addChild(rootId())
      editor.addChild(rootId())
      const before = childOrder(rootId())
      const { nodeId } = editor.addChild(rootId())
      expect(childOrder(rootId())).toEqual([...before, nodeId])
    })

    it('inserts a sibling at the end of all siblings by default', () => {
      editor.addChild(rootId())
      const b = editor.addChild(rootId()).nodeId
      editor.addChild(rootId())
      const { nodeId } = editor.addSibling(b)!
      expect(childOrder(rootId()).at(-1)).toBe(nodeId)
    })

    it('inserts a sibling above the selected node', () => {
      const a = editor.addChild(rootId()).nodeId
      const b = editor.addChild(rootId()).nodeId
      const { nodeId } = editor.addSibling(b, undefined, 'above')!
      expect(childOrder(rootId())).toEqual([a, nodeId, b])
    })

    it('inserts a sibling below the selected node', () => {
      const a = editor.addChild(rootId()).nodeId
      const b = editor.addChild(rootId()).nodeId
      const c = editor.addChild(rootId()).nodeId
      const { nodeId } = editor.addSibling(b, undefined, 'below')!
      expect(childOrder(rootId())).toEqual([a, b, nodeId, c])
    })
  })

  describe('addParent', () => {
    it('creates a parent above the node and re-parents the node under it', () => {
      const a = editor.addChild(rootId()).nodeId
      const b = editor.addChild(rootId()).nodeId
      const { nodeId: parent } = editor.addParent(b)!
      const { nodes, edges } = store.getState()
      expect(edges.find((e) => e.target === parent)?.source).toBe(rootId())
      expect(edges.find((e) => e.target === b)?.source).toBe(parent)
      expect(childOrder(rootId())).toEqual([a, parent])
      expect(nodes.find((n) => n.id === parent)?.data.label).toBe('新主题')
    })

    it('returns null for root and supports undo/redo', () => {
      expect(editor.addParent(rootId())).toBeNull()
      const a = editor.addChild(rootId()).nodeId
      const nodeCount = store.getState().nodes.length

      editor.addParent(a)
      expect(store.getState().canUndo).toBe(true)
      expect(store.getState().edges.find((e) => e.target === a)?.source).not.toBe(rootId())

      editor.undo()
      expect(store.getState().edges.find((e) => e.target === a)?.source).toBe(rootId())
      expect(store.getState().nodes.length).toBe(nodeCount)

      editor.redo()
      expect(store.getState().edges.find((e) => e.target === a)?.source).not.toBe(rootId())
    })

    it('keeps the branch color (branchIndex) when adding a parent to a root child', () => {
      editor.addChild(rootId())
      const b = editor.addChild(rootId()).nodeId
      const branchOf = (id: string) =>
        store.getState().nodes.find((n) => n.id === id)?.data.branchIndex
      const bBranch = branchOf(b) as number
      expect(typeof bBranch).toBe('number')

      const parent = editor.addParent(b)!.nodeId

      // The new parent takes over the branch head, inheriting the same branchIndex;
      // the original node keeps the same branch too (just one level deeper).
      expect(branchOf(parent)).toBe(bBranch)
      expect(branchOf(b)).toBe(bBranch)
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

    it('should apply edge removal through native changes', () => {
      const { nodeId: a } = editor.addChild(rootId())
      const edgeId = `e_${a}_${a}`

      // 纯树约束（ADR-0015）：任意连线入口已移除，边只能由加子/加兄弟产生。
      const edgesBefore = store.getState().edges.length
      editor.applyNativeEdgeChanges([{ id: edgeId, type: 'remove' }])
      expect(store.getState().edges.length).toBe(edgesBefore)

      // 通过 addChild 产生的边可以被原生 remove 移除
      const childEdge = store.getState().edges.find((e) => e.target === a)!
      editor.applyNativeEdgeChanges([{ id: childEdge.id, type: 'remove' }])
      expect(store.getState().edges.some((e) => e.id === childEdge.id)).toBe(false)
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

  describe('insertFromXml', () => {
    it('lays out an inserted fragment in place so it never overlaps existing children', async () => {
      const root = rootId()
      editor.addChild(root)
      await editor.insertFromXml(
        '<node type="text" content="AI A"><node type="text" content="A1"/><node type="text" content="A2"/></node>',
        { parentId: root, position: 'child' },
      )

      const snapshot = (): string[] =>
        store
          .getState()
          .nodes.map((n) => `${n.id}:${n.position.x},${n.position.y}`)
          .sort()

      // The insert must already be in its final layout: a later reflow (the
      // dimensions-driven one that only arrives once an AI stream ends and the
      // canvas re-enables) changes nothing, so the map is correct mid-stream.
      const asInserted = snapshot()
      editor.reflow()
      expect(snapshot()).toEqual(asInserted)

      // The fragment no longer stacks on the parent's existing first child.
      const rootChildren = store
        .getState()
        .nodes.filter((n) =>
          store.getState().edges.some((e) => e.source === root && e.target === n.id),
        )
      const childYs = rootChildren.map((n) => n.position.y)
      expect(new Set(childYs).size).toBe(rootChildren.length)
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

  describe('collapse', () => {
    it('setNodeCollapsed toggles the generic collapsed flag with undo/redo', () => {
      editor.addChild(rootId())
      editor.setNodeCollapsed(rootId(), true)
      expect(store.getState().nodes[0]!.data.collapsed).toBe(true)
      expect(store.getState().canUndo).toBe(true)

      editor.undo()
      expect(store.getState().nodes[0]!.data.collapsed).toBeUndefined()
      editor.redo()
      expect(store.getState().nodes[0]!.data.collapsed).toBe(true)
    })

    it('setNodeSideCollapsed toggles only the requested side flag', () => {
      editor.setStructureType('mindmap')
      editor.addChild(rootId())
      editor.addChild(rootId())

      editor.setNodeSideCollapsed(rootId(), 'left', true)
      const data = store.getState().nodes[0]!.data as Record<string, unknown>
      expect(data.leftCollapsed).toBe(true)
      expect(data.rightCollapsed).toBeUndefined()

      editor.undo()
      expect(store.getState().nodes[0]!.data.leftCollapsed).toBeUndefined()
    })

    it('expanding one side of a whole-collapsed root clears collapsed and keeps the other side folded via its flag', () => {
      editor.setStructureType('mindmap')
      editor.addChild(rootId())
      editor.addChild(rootId())
      editor.setNodeCollapsed(rootId(), true)
      expect(store.getState().nodes[0]!.data.collapsed).toBe(true)

      editor.setNodeSideCollapsed(rootId(), 'left', false)
      const data = store.getState().nodes[0]!.data as Record<string, unknown>
      expect(data.collapsed).toBeUndefined()
      expect(data.leftCollapsed).toBeUndefined()
      expect(data.rightCollapsed).toBe(true)
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

  describe('loadFile', () => {
    it('should initialize structureType from the loaded file style', () => {
      const file = createEmptyFile('导图')
      file.mindmap.style = {
        structureType: 'mindmap',
        visualVariant: 'minimal',
        colorScheme: 'ocean',
      }

      editor.loadFile('/test/mindmap.mindlane', file, null)

      expect(store.getState().style.structureType).toBe('mindmap')
      expect(store.getState().dirty).toBe(false)
    })

    it('should fall back to default style when file has no style field', () => {
      const file = createEmptyFile('旧文件')

      editor.loadFile('/test/legacy.mindlane', file, null)

      expect(store.getState().style).toEqual({
        structureType: 'logic',
        visualVariant: 'card',
        colorScheme: 'default',
      })
    })
  })
})
