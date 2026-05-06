import fs from 'node:fs'
import path from 'node:path'
import type { Chunk } from '../../types.js'
import { HierarchicalChunker } from './hierarchical.js'

interface MindLaneNode {
  id: string
  data?: { label?: string }
  type?: string
  parentId?: string
  position?: { x: number; y: number }
}

interface MindLaneData {
  metadata?: { title?: string; createdAt?: string; updatedAt?: string }
  mindmap?: { nodes?: MindLaneNode[]; edges?: unknown[] }
}

/**
 * Load MindLane file and convert to hierarchical chunks
 */
export async function loadMindLaneChunks(
  filePath: string,
  docId: string
): Promise<Chunk[]> {
  const raw = await fs.promises.readFile(filePath, 'utf-8')
  const data = JSON.parse(raw) as MindLaneData

  const title = data.metadata?.title ?? path.basename(filePath)
  const nodes = data.mindmap?.nodes ?? []

  const chunker = new HierarchicalChunker()
  return chunker.chunkMindLane(nodes, docId, filePath, title)
}

/**
 * Extract node hierarchy information without full chunking
 */
export function extractNodeHierarchy(
  nodes: MindLaneNode[]
): Map<
  string,
  {
    node: MindLaneNode
    path: string[]
    level: number
    children: string[]
  }
> {
  const nodeMap = new Map<string, MindLaneNode>(nodes.map((n) => [n.id, n]))
  const result = new Map<
    string,
    {
      node: MindLaneNode
      path: string[]
      level: number
      children: string[]
    }
  >()

  // Build children mapping
  const childrenMap = new Map<string, string[]>()
  for (const node of nodes) {
    if (node.parentId) {
      if (!childrenMap.has(node.parentId)) {
        childrenMap.set(node.parentId, [])
      }
      childrenMap.get(node.parentId)!.push(node.id)
    }
  }

  // Calculate path and level for each node
  for (const node of nodes) {
    const path: string[] = []
    let current = node
    while (current?.parentId) {
      const parent = nodeMap.get(current.parentId)
      if (parent?.data?.label) {
        path.unshift(parent.data.label)
      }
      current = parent!
    }

    result.set(node.id, {
      node,
      path,
      level: path.length,
      children: childrenMap.get(node.id) ?? [],
    })
  }

  return result
}
