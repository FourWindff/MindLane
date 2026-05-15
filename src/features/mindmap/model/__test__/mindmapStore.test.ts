import { describe, it, expect, beforeEach } from 'vitest'
import { useMindmapStore } from '../mindmapStore'

describe('mindmapStore.insertNodesFromYaml', () => {
  beforeEach(() => {
    useMindmapStore.getState().newFile('测试')
  })

  it('should insert nodes under specified parent', () => {
    const store = useMindmapStore.getState()
    const rootId = store.nodes[0]!.id

    store.insertNodesFromYaml(`
- "子主题 A":
  - "子主题 A1"
- "子主题 B"
`, { parentId: rootId })

    const nodes = useMindmapStore.getState().nodes
    const edges = useMindmapStore.getState().edges

    // 原有 root + 3 个新节点
    expect(nodes.length).toBe(4)
    expect(edges.length).toBe(3) // root->A, A->A1, root->B

    const labels = nodes.map(n => (n.data as { label: string }).label)
    expect(labels).toContain('子主题 A')
    expect(labels).toContain('子主题 A1')
    expect(labels).toContain('子主题 B')
  })

  it('should insert nodes under selected node when parentId not provided', () => {
    const store = useMindmapStore.getState()
    const rootId = store.nodes[0]!.id

    // 先选中 root
    store.setNodes(nodes => nodes.map(n =>
      n.id === rootId ? { ...n, selected: true } : n
    ))

    store.insertNodesFromYaml(`- "新主题"`, {})

    const edges = useMindmapStore.getState().edges
    const hasEdgeToNew = edges.some(e => e.source === rootId)
    expect(hasEdgeToNew).toBe(true)
  })

  it('should position new subtree to the right of parent', () => {
    const store = useMindmapStore.getState()
    const rootId = store.nodes[0]!.id
    const rootX = store.nodes[0]!.position.x

    store.insertNodesFromYaml(`- "子主题"`, { parentId: rootId })

    const newNodes = useMindmapStore.getState().nodes.filter(
      n => (n.data as { label: string }).label === '子主题'
    )
    expect(newNodes.length).toBe(1)
    expect(newNodes[0]!.position.x).toBeGreaterThan(rootX)
  })
})
