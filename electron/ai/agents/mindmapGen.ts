import type { LLMProvider } from '../providers/index.js'
import type { AgentState } from '../state.js'
import type { GeneratedNode, GeneratedEdge } from '../state.js'
import { buildExtractStructureMessages } from './prompts/docToMindmap.js'

interface KeyPoint {
  title: string
  children?: KeyPoint[]
}

function layoutTree(
  points: KeyPoint[],
  parentId: string,
  startX: number,
  startY: number,
  offsetX: number,
  gapY: number,
  genId: (prefix: string) => string,
): { nodes: GeneratedNode[]; edges: GeneratedEdge[] } {
  const nodes: GeneratedNode[] = []
  const edges: GeneratedEdge[] = []

  const totalHeight = points.length * gapY
  let currentY = startY - totalHeight / 2 + gapY / 2

  for (const point of points) {
    const nodeId = genId('topic')
    nodes.push({
      id: nodeId,
      type: 'topic',
      position: { x: startX + offsetX, y: currentY },
      data: { label: point.title },
    })
    edges.push({
      id: `e-${parentId}-${nodeId}`,
      source: parentId,
      target: nodeId,
      type: 'smoothstep',
    })

    if (point.children && point.children.length > 0) {
      const sub = layoutTree(
        point.children,
        nodeId,
        startX + offsetX,
        currentY,
        offsetX,
        gapY * 0.85,
        genId,
      )
      nodes.push(...sub.nodes)
      edges.push(...sub.edges)
    }

    currentY += gapY
  }

  return { nodes, edges }
}

export class MindmapGenAgent {
  constructor(private provider: LLMProvider) {}

  async invoke(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
    const documentText = state.mindmapInputText
    if (!documentText) {
      return { error: '未提供要生成思维导图的文本内容' }
    }

    let nodeCounter = 0
    function genId(prefix: string): string {
      return `${prefix}-${Date.now()}-${++nodeCounter}`
    }

    try {
      const text = documentText.slice(0, 8000)
      const response = await this.provider.reasoningModel.invoke(buildExtractStructureMessages(text))
      const content = typeof response.content === 'string' ? response.content : ''

      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        return { error: 'AI 未返回有效的 JSON 结构' }
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        title?: string
        points?: KeyPoint[]
      }

      const title = parsed.title ?? state.mindmapInputTitle ?? '文档'
      const points = parsed.points ?? []

      if (points.length === 0) {
        return { error: '未提取到任何要点' }
      }

      const docNodeId = genId('doc')
      const rootId = genId('root')

      const docNode: GeneratedNode = {
        id: docNodeId,
        type: 'document',
        position: { x: -300, y: 0 },
        data: {
          filename: state.mindmapInputTitle || '用户输入',
          excerpt: documentText.slice(0, 200),
        },
      }

      const rootNode: GeneratedNode = {
        id: rootId,
        type: 'topic',
        position: { x: 0, y: 0 },
        data: { label: title },
      }

      const docToRootEdge: GeneratedEdge = {
        id: `e-${docNodeId}-${rootId}`,
        source: docNodeId,
        target: rootId,
        type: 'smoothstep',
      }

      const tree = layoutTree(points, rootId, 0, 0, 260, 96, genId)

      return {
        mindmapNodes: [docNode, rootNode, ...tree.nodes],
        mindmapEdges: [docToRootEdge, ...tree.edges],
        mindmapTitle: title,
        response: `已生成思维导图「${title}」，共 ${tree.nodes.length + 2} 个节点。`,
      }
    } catch (error) {
      return { error: `生成思维导图失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }
}
