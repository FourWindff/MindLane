import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import {
  CHILD_GAP_Y,
  CHILD_OFFSET_X,
  createInitialEdges,
  createInitialNodes,
  withNewChild,
} from '../mindmapTree'

// registry 副作用注册 text 节点类型（deserializeNode 依赖）
import '@/features/mindmap/nodes'

type Tree = { nodes: Node[]; edges: Edge[] }

function addChild(tree: Tree, parentId: string, label: string): Tree & { newNodeId: string } {
  return withNewChild(
    tree.nodes, tree.edges, parentId, { label }, CHILD_OFFSET_X, CHILD_GAP_Y, 'mindmap',
  )
}

function sideOf(nodes: Node[], id: string): 'left' | 'right' {
  const root = nodes.find((n) => n.id === 'root')!
  const node = nodes.find((n) => n.id === id)!
  return node.position.x < root.position.x ? 'left' : 'right'
}

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
        tree.nodes, tree.edges, 'root', { label: `n${i}` }, CHILD_OFFSET_X, CHILD_GAP_Y, 'logic',
      )
      tree = r
      ids.push(r.newNodeId)
    }

    const before = ids.map((id) => tree.nodes.find((n) => n.id === id)!.data.branchIndex)
    const r = withNewChild(
      tree.nodes, tree.edges, 'root', { label: 'n3' }, CHILD_OFFSET_X, CHILD_GAP_Y, 'logic',
    )
    const after = ids.map((id) => r.nodes.find((n) => n.id === id)!.data.branchIndex)

    expect(after).toEqual(before)
  })

  it('logic 布局不受影响：所有子节点都在根节点右侧', () => {
    let tree: Tree = { nodes: createInitialNodes(), edges: createInitialEdges() }
    for (let i = 0; i < 4; i++) {
      const r = withNewChild(
        tree.nodes, tree.edges, 'root', { label: `n${i}` }, CHILD_OFFSET_X, CHILD_GAP_Y, 'logic',
      )
      tree = r
    }

    const children = tree.nodes.filter((n) => n.id !== 'root')
    for (const child of children) {
      expect(sideOf(tree.nodes, child.id)).toBe('right')
    }
  })
})
