import { describe, it, expect, beforeEach } from 'vitest'
import { createMindmapStore, type OpenFileState } from './store'
import { MindmapHistory } from './history'
import { MindmapEditor } from './editor'
import { serializeMindLaneFile } from '@contracts/mindmapXml'
import { MindmapXmlError } from '@contracts/mindmapXml'

describe('MindmapEditor XML integration', () => {
  let store: ReturnType<typeof createMindmapStore>
  let history: MindmapHistory
  let editor: MindmapEditor

  beforeEach(() => {
    store = createMindmapStore()
    history = new MindmapHistory()
    editor = new MindmapEditor(store, history)
    editor.newFile('Test')
  })

  describe('insertFromXml', () => {
    it('inserts a nested fragment under the target parent with derived edges', async () => {
      await editor.insertFromXml(
        `<node type="text" content="Branch A">
           <node type="text" content="Child 1" />
           <node type="text" content="Child 2" />
         </node>`,
        { parentId: 'root' },
      )

      const state = store.getState()
      expect(state.nodes).toHaveLength(4) // root + 3
      expect(state.edges).toHaveLength(3)
      const labels = new Map(state.nodes.map((n) => [n.id, (n.data as { label: string }).label]))
      expect(labels.get('root')).toBe('Central Topic')
      const childIds = state.edges.filter((e) => e.source === 'root').map((e) => e.target)
      expect(childIds).toHaveLength(1)
      expect(labels.get(childIds[0]!)).toBe('Branch A')

      // Goes through command history: undoable
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
      const { nodeId } = editor.addChild('root', { label: 'Existing' })
      const before = store.getState().nodes.length

      await expect(
        editor.insertFromXml(`<node id="${nodeId}" type="text" content="x" />`, {
          parentId: 'root',
        }),
      ).rejects.toBeInstanceOf(MindmapXmlError)

      expect(store.getState().nodes.length).toBe(before)
      expect(store.getState().edges).toHaveLength(1) // Only the pre-existing add-child edge
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
      await editor.insertFromXml(
        `<node type="image" asset="${assetId}" alt="Image" width="200" />`,
        {
          parentId: 'root',
        },
      )
      const node = store.getState().nodes.find((n) => n.type === 'image')!
      expect((node.data as { assetId: string }).assetId).toBe('a1')
    })

    it('inserts collapsed state from fragments', async () => {
      await editor.insertFromXml(
        `<node type="text" content="Collapsed branch" collapsed="true"><node type="text" content="Hidden" /></node>`,
        { parentId: 'root' },
      )
      const node = store
        .getState()
        .nodes.find((n) => (n.data as { label: string }).label === 'Collapsed branch')!
      expect((node.data as { collapsed?: boolean }).collapsed).toBe(true)
    })
  })

  describe('Agent write-path cascade entrance', () => {
    function delayOf(nodeId: string): number {
      const node = store.getState().nodes.find((n) => n.id === nodeId)
      return (node?.data as { cascadeDelay?: number }).cascadeDelay ?? -1
    }

    it('insertFromXml stamps delays with parent strictly before children, first node 0, tick 100ms', async () => {
      await editor.insertFromXml(
        `<node type="text" content="A"><node type="text" content="A1" /><node type="text" content="A2" /></node>`,
        { parentId: 'root' },
      )
      const state = store.getState()
      const labels = new Map(state.nodes.map((n) => [n.id, (n.data as { label: string }).label]))
      const a = state.nodes.find((n) => labels.get(n.id) === 'A')!
      const children = state.edges
        .filter((e) => e.source === a.id)
        .map((e) => e.target)
        .map((id) => state.nodes.find((n) => n.id === id)!)

      // every new node carries the marker (including 0); subtree starts at 0ms
      expect(delayOf(a.id)).toBe(0)
      expect(children.every((c) => delayOf(c.id) >= 0)).toBe(true)

      // parent strictly before children; the three subtree delays are exactly 0/100/200
      for (const child of children) expect(delayOf(child.id)).toBeGreaterThan(delayOf(a.id))
      expect([delayOf(a.id), ...children.map((c) => delayOf(c.id))].sort()).toEqual([0, 100, 200])
    })

    it('multi-root fragments count each subtree independently', async () => {
      await editor.insertFromXml(
        `<node type="text" content="A"><node type="text" content="A1" /></node><node type="text" content="B"><node type="text" content="B1" /></node>`,
        { parentId: 'root' },
      )
      const state = store.getState()
      const labels = new Map(state.nodes.map((n) => [n.id, (n.data as { label: string }).label]))
      const a = state.nodes.find((n) => labels.get(n.id) === 'A')!
      const b = state.nodes.find((n) => labels.get(n.id) === 'B')!
      const a1 = state.nodes.find((n) => labels.get(n.id) === 'A1')!
      const b1 = state.nodes.find((n) => labels.get(n.id) === 'B1')!

      // each subtree restarts at 0: B's root is not the successor of A's last node
      expect(delayOf(a.id)).toBe(0)
      expect(delayOf(b.id)).toBe(0)
      expect(delayOf(a1.id)).toBe(100)
      expect(delayOf(b1.id)).toBe(100)
    })

    it('large fragments compress the tick: last node delay stays under the ~2s budget', async () => {
      let xml = '<node type="text" content="N0">'
      for (let i = 1; i < 30; i++) {
        xml += `<node type="text" content="N${i}">`
      }
      xml += '</node>'.repeat(30)
      await editor.insertFromXml(xml, { parentId: 'root' })

      const state = store.getState()
      const labels = new Map(state.nodes.map((n) => [n.id, (n.data as { label: string }).label]))
      const chain = Array.from({ length: 30 }, (_, i) =>
        state.nodes.find((n) => labels.get(n.id) === `N${i}`)!,
      )
      const maxDelay = Math.max(...chain.map((n) => delayOf(n.id)))

      // compressed into budget (an uncompressed tick would be 29 × 100 = 2900ms)
      expect(maxDelay).toBeGreaterThan(0)
      expect(maxDelay).toBeLessThanOrEqual(2000)
      expect(maxDelay).toBeLessThan(29 * 100)
      // parent-before-child survives the compression
      for (let i = 1; i < chain.length; i++) {
        expect(delayOf(chain[i]!.id)).toBeGreaterThan(delayOf(chain[i - 1]!.id))
      }
    })

    it('replaceNodeFromXml cascades the replacement subtree in too', async () => {
      await editor.insertFromXml(`<node type="text" content="B" />`, { parentId: 'root' })
      const b = store.getState().nodes.find((n) => (n.data as { label: string }).label === 'B')!

      await editor.replaceNodeFromXml(
        `<node id="${b.id}" type="text" content="B-updated"><node type="text" content="B1" /><node type="text" content="B2" /></node>`,
      )
      const state = store.getState()
      const labels = new Map(state.nodes.map((n) => [n.id, (n.data as { label: string }).label]))
      const bUpdated = state.nodes.find((n) => labels.get(n.id) === 'B-updated')!
      const children = state.edges
        .filter((e) => e.source === bUpdated.id)
        .map((e) => e.target)
        .map((id) => state.nodes.find((n) => n.id === id)!)

      expect(delayOf(bUpdated.id)).toBe(0)
      for (const child of children) expect(delayOf(child.id)).toBeGreaterThan(0)
    })

    it('undo leaves no cascade markers; redo replays without entrance markers', async () => {
      await editor.insertFromXml(
        `<node type="text" content="A"><node type="text" content="A1" /></node>`,
        { parentId: 'root' },
      )
      const insertedIds = store
        .getState()
        .nodes.filter((n) => n.id !== 'root')
        .map((n) => n.id)
      const dataOf = (id: string) =>
        store.getState().nodes.find((n) => n.id === id)!.data as Record<string, unknown>
      expect(dataOf(insertedIds[0]!).cascadeDelay).toBe(0)
      expect(dataOf(insertedIds[0]!).justAdded).toBe(true)

      editor.undo()
      expect(store.getState().nodes).toHaveLength(1)

      editor.redo()
      const after = store.getState()
      expect(after.nodes).toHaveLength(3)
      for (const id of insertedIds) {
        const data = after.nodes.find((n) => n.id === id)!.data as Record<string, unknown>
        expect(data.justAdded).toBeUndefined()
        expect(data.cascadeDelay).toBeUndefined()
      }
    })
  })

  describe('pure-tree constraint', () => {
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

      // One batch history entry: a single undo restores everything
      editor.undo()
      const after = store.getState()
      expect(after.edges.find((e) => e.target === a)!.source).toBe('root')
      expect(after.nodes.some((n) => n.id === a1)).toBe(true)
    })

    it('moveSubtree refuses root and cycles', () => {
      const { nodeId: a } = editor.addChild('root', { label: 'A' })
      const { nodeId: a1 } = editor.addChild(a, { label: 'A1' })
      const edgesBefore = store.getState().edges.length

      editor.moveSubtree('root', a) // root cannot be moved
      editor.moveSubtree(a, a1) // moving into its own subtree (cycle)
      editor.moveSubtree(a, a) // itself

      expect(store.getState().edges).toHaveLength(edgesBefore)
    })
  })

  describe('collapsed state', () => {
    it('setNodeCollapsed goes through history and marks dirty', () => {
      const { nodeId } = editor.addChild('root', { label: 'Child' })
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
      const { nodeId } = editor.addChild('root', { label: 'Child' })
      editor.setNodeCollapsed(nodeId, true)

      const file = store.getState().toMindLaneFile()
      const xml = serializeMindLaneFile(file)
      expect(xml).toContain(`collapsed="true"`)

      // Reload (open file -> reflow -> collapsed state kept)
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
      // A collapsed child is no longer laid out: its position stays at the pre-collapse value
      expect(childAfter.position).toEqual(childBefore.position)

      editor.setNodeCollapsed(a, false)
      const childExpanded = store
        .getState()
        .nodes.find((n) => (n.data as { label: string }).label === 'A1')!
      expect(childExpanded.position.x).toBeGreaterThan(0)
    })
  })

  describe('file roundtrip', () => {
    it('editor state → XML → deserialize → reload keeps structure/style/attr', async () => {
      const { nodeId: a } = editor.addChild('root', { label: 'A & <B>' })
      editor.addChild(a, { label: 'Leaf' })
      editor.setNodeCollapsed(a, true)
      store.getState().addAsset({ id: 'a1', mime: 'image/png', sha256: 'h', data: 'QUJD' })
      store.getState().setViewport({ x: 5, y: 6, zoom: 0.9 })

      const file = store.getState().toMindLaneFile()
      const xml = serializeMindLaneFile(file)

      const { deserializeMindLaneFile } = await import('@contracts/mindmapXml')
      const parsed = await deserializeMindLaneFile(xml)
      expect(parsed.metadata.title).toBe('Test')
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
      // Reflow on open: the position is no longer {0,0}
      expect(state2.nodes.find((n) => n.id === a)!.position.x).toBeGreaterThan(0)
    })
  })

  describe('replaceNodeFromXml order preservation', () => {
    /** Insert three root-level siblings A/B/C and return { aId, bId, cId } plus a label map. */
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

    function rootChildOrder(state: OpenFileState) {
      return state.edges.filter((e) => e.source === 'root').map((e) => e.target)
    }

    function yOrder(state: OpenFileState) {
      return rootChildOrder(state)
        .map((id) => ({ id, y: state.nodes.find((n) => n.id === id)!.position.y }))
        .sort((a, b) => a.y - b.y)
        .map((x) => x.id)
    }

    it('keeps sibling order in place after a reattach (edges order and y layout)', async () => {
      const { bId, labels } = await seedSiblings()

      await editor.replaceNodeFromXml(`<node id="${bId}" type="text" content="B-updated" />`)
      const state = store.getState()
      const labelOf = (id: string) =>
        (state.nodes.find((n) => n.id === id)!.data as { label: string }).label

      // edges order (= XML serialization/save order)
      expect(rootChildOrder(state).map(labelOf)).toEqual(['A', 'B-updated', 'C'])
      // Visual layout order (y ascending)
      expect(yOrder(state).map(labelOf)).toEqual(['A', 'B-updated', 'C'])
      // The content really was replaced
      expect(labelOf(bId)).toBe('B-updated')
      expect(labels.get(bId)).toBe('B')
    })

    it('keeps a node with a subtree in place after an update, subtree order decided by the XML', async () => {
      const { bId } = await seedSiblings()

      await editor.replaceNodeFromXml(
        `<node id="${bId}" type="text" content="B-updated">
           <node type="text" content="B1" />
           <node type="text" content="B2" />
         </node>`,
      )
      const state = store.getState()
      const labelOf = (id: string) =>
        (state.nodes.find((n) => n.id === id)!.data as { label: string }).label

      expect(rootChildOrder(state).map(labelOf)).toEqual(['A', 'B-updated', 'C'])
      expect(yOrder(state).map(labelOf)).toEqual(['A', 'B-updated', 'C'])
      // Subtree order: XML declaration order (B1 before B2)
      const b1 = state.edges.find((e) => e.source === bId)!.target
      const b2 = state.edges.filter((e) => e.source === bId)[1]!.target
      expect(labelOf(b1)).toBe('B1')
      expect(labelOf(b2)).toBe('B2')
    })

    it('keeps order across a save -> reload roundtrip (serialization order = edges order)', async () => {
      const { bId } = await seedSiblings()
      await editor.replaceNodeFromXml(`<node id="${bId}" type="text" content="B-updated" />`)

      const file = store.getState().toMindLaneFile()
      const xml = serializeMindLaneFile(file)
      const { deserializeMindLaneFile } = await import('@contracts/mindmapXml')
      const parsed = await deserializeMindLaneFile(xml)

      const editor2 = new MindmapEditor(createMindmapStore(), new MindmapHistory())
      editor2.loadFile('/tmp/order.mindlane', parsed, null)
      const state2 = editor2['store'].getState()
      const labelOf = (id: string) =>
        (state2.nodes.find((n) => n.id === id)!.data as { label: string }).label
      const order = state2.edges.filter((e) => e.source === 'root').map((e) => labelOf(e.target))
      expect(order).toEqual(['A', 'B-updated', 'C'])
      // After a reload every position is recomputed (y ties degrade the sort) yet the order
      // must not change
      const ySorted = state2.edges
        .filter((e) => e.source === 'root')
        .map((e) => ({ id: e.target, y: state2.nodes.find((n) => n.id === e.target)!.position.y }))
        .sort((a, b) => a.y - b.y)
        .map((x) => labelOf(x.id))
      expect(ySorted).toEqual(['A', 'B-updated', 'C'])
    })

    it('undo restores the whole transaction (including order)', async () => {
      const { bId } = await seedSiblings()
      await editor.replaceNodeFromXml(`<node id="${bId}" type="text" content="B-updated" />`)

      editor.undo()
      const state = store.getState()
      const labelOf = (id: string) =>
        (state.nodes.find((n) => n.id === id)!.data as { label: string }).label
      expect(rootChildOrder(state).map(labelOf)).toEqual(['A', 'B', 'C'])

      editor.redo()
      const after = store.getState()
      const labelAfter = (id: string) =>
        (after.nodes.find((n) => n.id === id)!.data as { label: string }).label
      expect(rootChildOrder(after).map(labelAfter)).toEqual(['A', 'B-updated', 'C'])
    })
  })
})
