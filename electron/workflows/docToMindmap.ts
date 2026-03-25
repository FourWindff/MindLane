/**
 * LangGraph StateGraph: 文档 → 思维导图
 *
 * 步骤: readDocument → extractStructure → generateMindMap → (refine loop or apply)
 */

import { ChatOpenAI } from '@langchain/openai'
import { StateGraph, END, START } from '@langchain/langgraph'
import { Annotation } from '@langchain/langgraph'
import { buildExtractStructureMessages } from './prompts/docToMindmap.js'

const DASHSCOPE_COMPAT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

export interface GeneratedNode {
  id: string
  type: 'topic' | 'document'
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export interface GeneratedEdge {
  id: string
  source: string
  target: string
  type: string
}

export interface DocToMindmapResult {
  ok: true
  nodes: GeneratedNode[]
  edges: GeneratedEdge[]
  documentTitle: string
}

export interface DocToMindmapError {
  ok: false
  error: string
}

export type DocToMindmapOutput = DocToMindmapResult | DocToMindmapError

const DocState = Annotation.Root({
  documentText: Annotation<string>,
  documentFilename: Annotation<string>,
  apiKey: Annotation<string>,
  model: Annotation<string>,
  keyPoints: Annotation<string>,
  generatedNodes: Annotation<GeneratedNode[]>,
  generatedEdges: Annotation<GeneratedEdge[]>,
  documentTitle: Annotation<string>,
  error: Annotation<string>,
})

let nodeCounter = 0
function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++nodeCounter}`
}

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
      )
      nodes.push(...sub.nodes)
      edges.push(...sub.edges)
    }

    currentY += gapY
  }

  return { nodes, edges }
}

export async function runDocToMindmap(params: {
  apiKey: string
  model: string
  documentText: string
  documentFilename: string
}): Promise<DocToMindmapOutput> {
  const { apiKey, model, documentText, documentFilename } = params
  if (!apiKey.trim()) return { ok: false, error: '未填写 API Key' }
  if (!documentText.trim()) return { ok: false, error: '文档内容为空' }

  const modelName = model.trim() || 'qwen-turbo'
  nodeCounter = 0

  const llm = new ChatOpenAI({
    model: modelName,
    apiKey,
    temperature: 0.3,
    configuration: { baseURL: DASHSCOPE_COMPAT_BASE },
  })

  async function extractStructure(
    state: typeof DocState.State,
  ): Promise<Partial<typeof DocState.State>> {
    const text = state.documentText.slice(0, 8000)

    const response = await llm.invoke(buildExtractStructureMessages(text))

    const content = typeof response.content === 'string' ? response.content : ''
    return { keyPoints: content }
  }

  async function generateMindMap(
    state: typeof DocState.State,
  ): Promise<Partial<typeof DocState.State>> {
    if (state.error) return {}

    try {
      const jsonMatch = state.keyPoints.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        return { error: 'AI 未返回有效的 JSON 结构' }
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        title?: string
        points?: KeyPoint[]
      }

      const title = parsed.title ?? state.documentFilename ?? '文档'
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
          filename: state.documentFilename,
          excerpt: state.documentText.slice(0, 200),
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

      const tree = layoutTree(points, rootId, 0, 0, 260, 96)

      return {
        generatedNodes: [docNode, rootNode, ...tree.nodes],
        generatedEdges: [docToRootEdge, ...tree.edges],
        documentTitle: title,
      }
    } catch (e) {
      return { error: `解析结构失败：${e instanceof Error ? e.message : String(e)}` }
    }
  }

  function shouldContinue(state: typeof DocState.State): string {
    if (state.error) return END
    return 'generateMindMap'
  }

  const graph = new StateGraph(DocState)
    .addNode('extractStructure', extractStructure)
    .addNode('generateMindMap', generateMindMap)
    .addEdge(START, 'extractStructure')
    .addConditionalEdges('extractStructure', shouldContinue)
    .addEdge('generateMindMap', END)

  const app = graph.compile()

  try {
    const result = await app.invoke({
      documentText,
      documentFilename,
      apiKey,
      model: modelName,
      keyPoints: '',
      generatedNodes: [],
      generatedEdges: [],
      documentTitle: '',
      error: '',
    })

    if (result.error) {
      return { ok: false, error: result.error }
    }

    return {
      ok: true,
      nodes: result.generatedNodes,
      edges: result.generatedEdges,
      documentTitle: result.documentTitle,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
