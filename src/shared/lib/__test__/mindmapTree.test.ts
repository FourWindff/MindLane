import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import {
  CHILD_GAP_Y,
  CHILD_OFFSET_X,
  collectDescendantIds,
  createInitialEdges,
  createInitialNodes,
  reflowChildren,
  withNewChild,
} from '../mindmapTree'

// registry 副作用注册 text 节点类型
import '@/features/mindmap/nodes'

type Tree = { nodes: Node[]; edges: Edge[] }

function addChild(tree: Tree, parentId: string, label: string): Tree & { newNodeId: string } {
  return withNewChild(
    tree.nodes,
    tree.edges,
    parentId,
    { label },
    CHILD_OFFSET_X,
    CHILD_GAP_Y,
    'mindmap',
  )
}

function sideOf(nodes: Node[], id: string): 'left' | 'right' {
  const root = nodes.find((n) => n.id === 'root')!
  const node = nodes.find((n) => n.id === id)!
  return node.position.x < root.position.x ? 'left' : 'right'
}

describe('collectDescendantIds 折叠隐藏集合', () => {
  it('返回折叠节点的全部后代、不含折叠节点自身', () => {
    let tree: Tree = { nodes: createInitialNodes(), edges: createInitialEdges() }
    const a = addChild(tree, 'root', 'a')
    tree = a
    const a1 = addChild(tree, a.newNodeId, 'a1')
    tree = a1
    const a2 = addChild(tree, a.newNodeId, 'a2')
    tree = a2
    const a21 = addChild(tree, a2.newNodeId, 'a2-1')
    tree = a21

    const ids = collectDescendantIds(tree.edges, a.newNodeId)
    expect(ids.has(a.newNodeId)).toBe(false)
    expect(ids.has(a1.newNodeId)).toBe(true)
    expect(ids.has(a2.newNodeId)).toBe(true)
    expect(ids.has(a21.newNodeId)).toBe(true)
    expect(ids.size).toBe(3)
  })

  it('叶子节点（无子节点）的后代集合为空', () => {
    let tree: Tree = { nodes: createInitialNodes(), edges: createInitialEdges() }
    const a = addChild(tree, 'root', 'a')
    tree = a

    const ids = collectDescendantIds(tree.edges, a.newNodeId)
    expect(ids.size).toBe(0)
  })
})

describe('mindmap 布局左右分侧', () => {
  it('新增子节点不改变已有节点的左右侧归属', () => {
    let tree: Tree = { nodes: createInitialNodes(), edges: createInitialEdges() }
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const r = addChild(tree, 'root', `n${i}`)
      tree = r
      ids.push(r.newNodeId)
    }

    const before = ids.map((id) => sideOf(tree.nodes, id))

    // 连续追加两个节点，原有节点不应换侧
    tree = addChild(tree, 'root', 'n4')
    tree = addChild(tree, 'root', 'n5')
    const after = ids.map((id) => sideOf(tree.nodes, id))

    expect(after).toEqual(before)
  })

  it('分侧结果写入 data.side 并与实际位置一致', () => {
    let tree: Tree = { nodes: createInitialNodes(), edges: createInitialEdges() }
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = addChild(tree, 'root', `n${i}`)
      tree = r
      ids.push(r.newNodeId)
    }

    for (const id of ids) {
      const node = tree.nodes.find((n) => n.id === id)!
      expect(node.data.side).toBe(sideOf(tree.nodes, id))
    }
  })

  it('左右两侧节点数量保持均衡（交替分配新节点）', () => {
    let tree: Tree = { nodes: createInitialNodes(), edges: createInitialEdges() }
    for (let i = 0; i < 6; i++) {
      tree = addChild(tree, 'root', `n${i}`)
    }

    const children = tree.nodes.filter((n) => n.id !== 'root')
    const rights = children.filter((n) => sideOf(tree.nodes, n.id) === 'right')
    const lefts = children.filter((n) => sideOf(tree.nodes, n.id) === 'left')
    expect(rights).toHaveLength(3)
    expect(lefts).toHaveLength(3)
  })

  it('新增子节点不改变已有节点的 branchIndex（颜色保持稳定）', () => {
    let tree: Tree = { nodes: createInitialNodes(), edges: createInitialEdges() }
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const r = addChild(tree, 'root', `n${i}`)
      tree = r
      ids.push(r.newNodeId)
    }

    const branchIndexOf = (nodes: Node[], id: string) =>
      nodes.find((n) => n.id === id)!.data.branchIndex

    const before = ids.map((id) => branchIndexOf(tree.nodes, id))
    expect(new Set(before).size).toBe(ids.length) // 各分支索引唯一

    tree = addChild(tree, 'root', 'n4')
    tree = addChild(tree, 'root', 'n5')
    const after = ids.map((id) => branchIndexOf(tree.nodes, id))

    expect(after).toEqual(before)
  })

  it('logic 布局下新增子节点同样不改变已有节点的 branchIndex', () => {
    let tree: Tree = { nodes: createInitialNodes(), edges: createInitialEdges() }
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = withNewChild(
        tree.nodes,
        tree.edges,
        'root',
        { label: `n${i}` },
        CHILD_OFFSET_X,
        CHILD_GAP_Y,
        'logic',
      )
      tree = r
      ids.push(r.newNodeId)
    }

    const before = ids.map((id) => tree.nodes.find((n) => n.id === id)!.data.branchIndex)
    const r = withNewChild(
      tree.nodes,
      tree.edges,
      'root',
      { label: 'n3' },
      CHILD_OFFSET_X,
      CHILD_GAP_Y,
      'logic',
    )
    const after = ids.map((id) => r.nodes.find((n) => n.id === id)!.data.branchIndex)

    expect(after).toEqual(before)
  })

  it('logic 布局不受影响：所有子节点都在根节点右侧', () => {
    let tree: Tree = { nodes: createInitialNodes(), edges: createInitialEdges() }
    for (let i = 0; i < 4; i++) {
      const r = withNewChild(
        tree.nodes,
        tree.edges,
        'root',
        { label: `n${i}` },
        CHILD_OFFSET_X,
        CHILD_GAP_Y,
        'logic',
      )
      tree = r
    }

    const children = tree.nodes.filter((n) => n.id !== 'root')
    for (const child of children) {
      expect(sideOf(tree.nodes, child.id)).toBe('right')
    }
  })
})

describe('mindmap 布局根节点分侧折叠', () => {
  function reflow(tree: Tree): Node[] {
    return reflowChildren('root', tree.nodes, tree.edges, CHILD_OFFSET_X, CHILD_GAP_Y, 'mindmap')
  }

  function buildTreeWithSides(): Tree {
    let tree: Tree = { nodes: createInitialNodes(), edges: createInitialEdges() }
    for (let i = 0; i < 4; i++) {
      tree = addChild(tree, 'root', `n${i}`)
    }
    return tree
  }

  it('leaves the left branch untouched in layout when root.leftCollapsed is set (stale positions kept), right branch lays out normally', () => {
    const tree = buildTreeWithSides()
    const leftIds = tree.nodes
      .filter((n) => n.id !== 'root' && sideOf(tree.nodes, n.id) === 'left')
      .map((n) => n.id)
    // Tamper with the left nodes' positions to prove reflow never touches them
    const tampered = tree.nodes.map((n) =>
      leftIds.includes(n.id) ? { ...n, position: { x: 555, y: 555 } } : n,
    )
    const root = tampered.find((n) => n.id === 'root')!
    const result = reflow({
      nodes: tampered.map((n) =>
        n.id === 'root' ? { ...n, data: { ...root.data, leftCollapsed: true } } : n,
      ),
      edges: tree.edges,
    })

    for (const id of leftIds) {
      expect(result.find((n) => n.id === id)!.position).toEqual({ x: 555, y: 555 })
    }
    // Right branch lays out to the right of the root (gapX=40, node width 160 → x=200)
    const rightNodes = result.filter((n) => n.id !== 'root' && !leftIds.includes(n.id))
    expect(rightNodes.every((n) => n.position.x === 200)).toBe(true)
    expect(new Set(rightNodes.map((n) => n.position.y)).size).toBe(rightNodes.length)
  })

  it('leaves the right branch untouched in layout when root.rightCollapsed is set, left branch lays out normally', () => {
    const tree = buildTreeWithSides()
    const rightIds = tree.nodes
      .filter((n) => n.id !== 'root' && sideOf(tree.nodes, n.id) === 'right')
      .map((n) => n.id)
    const tampered = tree.nodes.map((n) =>
      rightIds.includes(n.id) ? { ...n, position: { x: 555, y: 555 } } : n,
    )
    const root = tampered.find((n) => n.id === 'root')!
    const result = reflow({
      nodes: tampered.map((n) =>
        n.id === 'root' ? { ...n, data: { ...root.data, rightCollapsed: true } } : n,
      ),
      edges: tree.edges,
    })

    for (const id of rightIds) {
      expect(result.find((n) => n.id === id)!.position).toEqual({ x: 555, y: 555 })
    }
    // Left branch lays out to the left of the root (x = 0 - 40 - 160 = -200)
    const leftNodes = result.filter((n) => n.id !== 'root' && !rightIds.includes(n.id))
    expect(leftNodes.every((n) => n.position.x === -200)).toBe(true)
    expect(new Set(leftNodes.map((n) => n.position.y)).size).toBe(leftNodes.length)
  })

  it('keeps side assignment and branchIndex stable across side collapse (restores unchanged on expand)', () => {
    const tree = buildTreeWithSides()
    const before = tree.nodes
      .filter((n) => n.id !== 'root')
      .map((n) => ({ id: n.id, side: n.data.side, branchIndex: n.data.branchIndex }))

    const result = reflow({
      nodes: tree.nodes.map((n) =>
        n.id === 'root'
          ? { ...n, data: { ...n.data, leftCollapsed: true, rightCollapsed: true } }
          : n,
      ),
      edges: tree.edges,
    })

    const after = result
      .filter((n) => n.id !== 'root')
      .map((n) => ({ id: n.id, side: n.data.side, branchIndex: n.data.branchIndex }))
    expect(after).toEqual(before)
  })

  it('root.collapsed still collapses the whole map (neither side lays out)', () => {
    const tree = buildTreeWithSides()
    const tampered = tree.nodes.map((n) =>
      n.id === 'root'
        ? { ...n, data: { ...n.data, collapsed: true } }
        : { ...n, position: { x: 777, y: 777 } },
    )
    const result = reflow({ nodes: tampered, edges: tree.edges })

    for (const n of result) {
      if (n.id === 'root') continue
      expect(n.position).toEqual({ x: 777, y: 777 })
    }
  })
})
