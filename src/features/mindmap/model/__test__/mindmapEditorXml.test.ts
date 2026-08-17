import { describe, it, expect, beforeEach } from 'vitest'
import { createMindmapStore, type MindmapState } from '../mindmapStore'
import { MindmapHistory } from '../mindmapHistory'
import { MindmapEditor } from '../mindmapEditor'
import { serializeMindlaneFile } from '@/shared/lib/mindmapXml'
import { MindmapXmlError } from '@/shared/lib/mindmapXml'

describe('MindmapEditor XML 集成', () => {
  let store: ReturnType<typeof createMindmapStore>
  let history: MindmapHistory
  let editor: MindmapEditor

  beforeEach(() => {
    store = createMindmapStore()
    history = new MindmapHistory()
    editor = new MindmapEditor(store, history)
    editor.newFile('测试')
  })

  describe('insertFromXml', () => {
    it('inserts a nested fragment under the target parent with derived edges', async () => {
      await editor.insertFromXml(
        `<node type="text" content="分支A">
           <node type="text" content="子节点1" />
           <node type="text" content="子节点2" />
         </node>`,
        { parentId: 'root' },
      )

      const state = store.getState()
      expect(state.nodes).toHaveLength(4) // root + 3
      expect(state.edges).toHaveLength(3)
      const labels = new Map(state.nodes.map((n) => [n.id, (n.data as { label: string }).label]))
      expect(labels.get('root')).toBe('中心主题')
      const childIds = state.edges.filter((e) => e.source === 'root').map((e) => e.target)
      expect(childIds).toHaveLength(1)
      expect(labels.get(childIds[0]!)).toBe('分支A')

      // 走命令历史：可撤销
      expect(state.canUndo).toBe(true)
      editor.undo()
      expect(store.getState().nodes).toHaveLength(1)
      expect(store.getState().edges).toHaveLength(0)
    })

    it('supports multi-root fragments aggregated under the parent', async () => {
      await editor.insertFromXml(
        `<node type="text" content="A" /><node type="text" content="B" />`,
        { parentId: 'root' },
      )
      const state = store.getState()
      const childIds = state.edges.filter((e) => e.source === 'root').map((e) => e.target)
      expect(childIds).toHaveLength(2)
    })

    it('falls back to selected node then root when parentId omitted', async () => {
      await editor.insertFromXml(`<node type="text" content="A" />`)
      const state = store.getState()
      const childIds = state.edges.filter((e) => e.source === 'root').map((e) => e.target)
      expect(childIds).toHaveLength(1)
    })

    it('rejects fragments colliding with existing ids (tree_invalid) without partial mount', async () => {
      const { nodeId } = editor.addChild('root', { label: '已有' })
      const before = store.getState().nodes.length

      await expect(
        editor.insertFromXml(`<node id="${nodeId}" type="text" content="x" />`, {
          parentId: 'root',
        }),
      ).rejects.toBeInstanceOf(MindmapXmlError)

      expect(store.getState().nodes.length).toBe(before)
      expect(store.getState().edges).toHaveLength(1) // 仅原有的加子边
    })

    it('rejects fragments referencing missing assets (asset_not_found)', async () => {
      await expect(
        editor.insertFromXml(`<node type="image" asset="ghost" />`, { parentId: 'root' }),
      ).rejects.toMatchObject({ code: 'asset_not_found' })
    })

    it('accepts image fragments referencing existing assets', async () => {
      const assetId = store.getState().addAsset({
        id: 'a1',
        mime: 'image/png',
        sha256: 'h1',
        data: 'iVBORw0KGgo=',
      })
      await editor.insertFromXml(`<node type="image" asset="${assetId}" alt="图" width="200" />`, {
        parentId: 'root',
      })
      const node = store.getState().nodes.find((n) => n.type === 'image')!
      expect((node.data as { assetId: string }).assetId).toBe('a1')
    })

    it('inserts collapsed state from fragments', async () => {
      await editor.insertFromXml(
        `<node type="text" content="折叠分支" collapsed="true"><node type="text" content="隐藏" /></node>`,
        { parentId: 'root' },
      )
      const node = store
        .getState()
        .nodes.find((n) => (n.data as { label: string }).label === '折叠分支')!
      expect((node.data as { collapsed?: boolean }).collapsed).toBe(true)
    })
  })

  describe('纯树约束', () => {
    it('deleteSubtree ignores root', () => {
      const before = store.getState().nodes.length
      editor.deleteSubtree('root')
      expect(store.getState().nodes).toHaveLength(before)
    })

    it('moveSubtree moves a subtree and re-parents it (single batch history)', async () => {
      const { nodeId: a } = editor.addChild('root', { label: 'A' })
      const { nodeId: b } = editor.addChild('root', { label: 'B' })
      const { nodeId: a1 } = editor.addChild(a, { label: 'A1' })

      editor.moveSubtree(a, b)
      const state = store.getState()
      const parentOfA = state.edges.find((e) => e.target === a)!.source
      expect(parentOfA).toBe(b)
      expect(state.edges.find((e) => e.target === a1)!.source).toBe(a)

      // 单条 batch 历史：一次 undo 全部还原
      editor.undo()
      const after = store.getState()
      expect(after.edges.find((e) => e.target === a)!.source).toBe('root')
      expect(after.nodes.some((n) => n.id === a1)).toBe(true)
    })

    it('moveSubtree refuses root and cycles', () => {
      const { nodeId: a } = editor.addChild('root', { label: 'A' })
      const { nodeId: a1 } = editor.addChild(a, { label: 'A1' })
      const edgesBefore = store.getState().edges.length

      editor.moveSubtree('root', a) // root 不可移动
      editor.moveSubtree(a, a1) // 移入自己子树（环）
      editor.moveSubtree(a, a) // 自身

      expect(store.getState().edges).toHaveLength(edgesBefore)
    })
  })

  describe('collapsed 折叠', () => {
    it('setNodeCollapsed goes through history and marks dirty', () => {
      const { nodeId } = editor.addChild('root', { label: '子' })
      editor.setNodeCollapsed(nodeId, true)
      expect(
        (store.getState().nodes.find((n) => n.id === nodeId)!.data as { collapsed?: boolean })
          .collapsed,
      ).toBe(true)
      expect(store.getState().dirty).toBe(true)
      editor.undo()
      expect(
        (store.getState().nodes.find((n) => n.id === nodeId)!.data as { collapsed?: boolean })
          .collapsed,
      ).toBeUndefined()
    })

    it('collapsed persists through XML roundtrip and load', () => {
      const { nodeId } = editor.addChild('root', { label: '子' })
      editor.setNodeCollapsed(nodeId, true)

      const file = store.getState().toMindLaneFile()
      const xml = serializeMindlaneFile(file)
      expect(xml).toContain(`collapsed="true"`)

      // 重新加载（打开文件 → 布局重算 → 保持折叠态）
      const editor2 = new MindmapEditor(createMindmapStore(), new MindmapHistory())
      editor2.loadFile('/tmp/x.mindlane', file, null)
      const restored = editor2['store'].getState().nodes.find((n) => n.id === nodeId)!
      expect((restored.data as { collapsed?: boolean }).collapsed).toBe(true)
    })

    it('layout treats collapsed nodes as leaves (children keep stale positions)', () => {
      const { nodeId: a } = editor.addChild('root', { label: 'A' })
      editor.addChild(a, { label: 'A1' })
      const childBefore = store
        .getState()
        .nodes.find((n) => (n.data as { label: string }).label === 'A1')!
      expect(childBefore.position.x).toBeGreaterThan(0)

      editor.setNodeCollapsed(a, true)
      const childAfter = store
        .getState()
        .nodes.find((n) => (n.data as { label: string }).label === 'A1')!
      // 折叠后子节点不再被布局：位置停留在折叠前的值
      expect(childAfter.position).toEqual(childBefore.position)

      editor.setNodeCollapsed(a, false)
      const childExpanded = store
        .getState()
        .nodes.find((n) => (n.data as { label: string }).label === 'A1')!
      expect(childExpanded.position.x).toBeGreaterThan(0)
    })
  })

  describe('文件 roundtrip', () => {
    it('editor state → XML → deserialize → reload keeps structure/style/attr', async () => {
      const { nodeId: a } = editor.addChild('root', { label: 'A & <B>' })
      editor.addChild(a, { label: '叶子' })
      editor.setNodeCollapsed(a, true)
      store.getState().addAsset({ id: 'a1', mime: 'image/png', sha256: 'h', data: 'QUJD' })
      store.getState().setViewport({ x: 5, y: 6, zoom: 0.9 })

      const file = store.getState().toMindLaneFile()
      const xml = serializeMindlaneFile(file)

      const { deserializeMindlaneFile } = await import('@/shared/lib/mindmapXml')
      const parsed = await deserializeMindlaneFile(xml)
      expect(parsed.metadata.title).toBe('测试')
      expect(parsed.mindmap.viewport).toEqual({ x: 5, y: 6, zoom: 0.9 })
      expect(parsed.mindmap.style).toEqual(file.mindmap.style)
      expect(parsed.assets).toHaveLength(1)
      expect(parsed.mindmap.nodes).toHaveLength(3)

      const editor2 = new MindmapEditor(createMindmapStore(), new MindmapHistory())
      editor2.loadFile('/tmp/x.mindlane', parsed, null)
      const state2 = editor2['store'].getState()
      expect(state2.assets).toHaveLength(1)
      const labels = new Map(state2.nodes.map((n) => [n.id, (n.data as { label: string }).label]))
      expect(labels.get(a)).toBe('A & <B>')
      expect(
        (state2.nodes.find((n) => n.id === a)!.data as { collapsed?: boolean }).collapsed,
      ).toBe(true)
      // 打开时布局重算：位置不再为 {0,0}
      expect(state2.nodes.find((n) => n.id === a)!.position.x).toBeGreaterThan(0)
    })
  })

  describe('replaceNodeFromXml 保序', () => {
    /** 插入三个根级兄弟 A/B/C，返回 { aId, bId, cId } 与 label 映射。 */
    async function seedSiblings() {
      await editor.insertFromXml(
        `<node type="text" content="A" /><node type="text" content="B" /><node type="text" content="C" />`,
        { parentId: 'root' },
      )
      const state = store.getState()
      const labels = new Map(state.nodes.map((n) => [n.id, (n.data as { label: string }).label]))
      const [aId, bId, cId] = state.edges.filter((e) => e.source === 'root').map((e) => e.target)
      expect([aId, bId, cId].map((id) => labels.get(id!))).toEqual(['A', 'B', 'C'])
      return { aId: aId!, bId: bId!, cId: cId!, labels }
    }

    function rootChildOrder(state: MindmapState) {
      return state.edges.filter((e) => e.source === 'root').map((e) => e.target)
    }

    function yOrder(state: MindmapState) {
      return rootChildOrder(state)
        .map((id) => ({ id, y: state.nodes.find((n) => n.id === id)!.position.y }))
        .sort((a, b) => a.y - b.y)
        .map((x) => x.id)
    }

    it('重挂后兄弟顺序保持原位（edges 顺序与 y 布局）', async () => {
      const { bId, labels } = await seedSiblings()

      await editor.replaceNodeFromXml(`<node id="${bId}" type="text" content="B-更新" />`)
      const state = store.getState()
      const labelOf = (id: string) =>
        (state.nodes.find((n) => n.id === id)!.data as { label: string }).label

      // edges 顺序（= XML 序列化/保存顺序）
      expect(rootChildOrder(state).map(labelOf)).toEqual(['A', 'B-更新', 'C'])
      // 视觉布局顺序（y 升序）
      expect(yOrder(state).map(labelOf)).toEqual(['A', 'B-更新', 'C'])
      // 内容确实被替换
      expect(labelOf(bId)).toBe('B-更新')
      expect(labels.get(bId)).toBe('B')
    })

    it('带子树的节点更新后原位保持，子树顺序由 XML 决定', async () => {
      const { bId } = await seedSiblings()

      await editor.replaceNodeFromXml(
        `<node id="${bId}" type="text" content="B-更新">
           <node type="text" content="B1" />
           <node type="text" content="B2" />
         </node>`,
      )
      const state = store.getState()
      const labelOf = (id: string) =>
        (state.nodes.find((n) => n.id === id)!.data as { label: string }).label

      expect(rootChildOrder(state).map(labelOf)).toEqual(['A', 'B-更新', 'C'])
      expect(yOrder(state).map(labelOf)).toEqual(['A', 'B-更新', 'C'])
      // 子树内部顺序：按 XML 声明顺序（B1 在 B2 前）
      const b1 = state.edges.find((e) => e.source === bId)!.target
      const b2 = state.edges.filter((e) => e.source === bId)[1]!.target
      expect(labelOf(b1)).toBe('B1')
      expect(labelOf(b2)).toBe('B2')
    })

    it('保存→重载 roundtrip 后顺序仍保持（序列化顺序 = edges 顺序）', async () => {
      const { bId } = await seedSiblings()
      await editor.replaceNodeFromXml(`<node id="${bId}" type="text" content="B-更新" />`)

      const file = store.getState().toMindLaneFile()
      const xml = serializeMindlaneFile(file)
      const { deserializeMindlaneFile } = await import('@/shared/lib/mindmapXml')
      const parsed = await deserializeMindlaneFile(xml)

      const editor2 = new MindmapEditor(createMindmapStore(), new MindmapHistory())
      editor2.loadFile('/tmp/order.mindlane', parsed, null)
      const state2 = editor2['store'].getState()
      const labelOf = (id: string) =>
        (state2.nodes.find((n) => n.id === id)!.data as { label: string }).label
      const order = state2.edges.filter((e) => e.source === 'root').map((e) => labelOf(e.target))
      expect(order).toEqual(['A', 'B-更新', 'C'])
      // 重载后 position 全部重算（y 归零退化排序）也不得改变顺序
      const ySorted = state2.edges
        .filter((e) => e.source === 'root')
        .map((e) => ({ id: e.target, y: state2.nodes.find((n) => n.id === e.target)!.position.y }))
        .sort((a, b) => a.y - b.y)
        .map((x) => labelOf(x.id))
      expect(ySorted).toEqual(['A', 'B-更新', 'C'])
    })

    it('undo 整单还原（含顺序）', async () => {
      const { bId } = await seedSiblings()
      await editor.replaceNodeFromXml(`<node id="${bId}" type="text" content="B-更新" />`)

      editor.undo()
      const state = store.getState()
      const labelOf = (id: string) =>
        (state.nodes.find((n) => n.id === id)!.data as { label: string }).label
      expect(rootChildOrder(state).map(labelOf)).toEqual(['A', 'B', 'C'])

      editor.redo()
      const after = store.getState()
      const labelAfter = (id: string) =>
        (after.nodes.find((n) => n.id === id)!.data as { label: string }).label
      expect(rootChildOrder(after).map(labelAfter)).toEqual(['A', 'B-更新', 'C'])
    })
  })
})
