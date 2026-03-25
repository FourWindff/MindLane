/**
 * LangGraph StateGraph: 选中节点 → 记忆宫殿
 *
 * 步骤: analyzeNodes → planRoute → createAnchors → generateImage → buildPalaceNode
 */

import { StateGraph, END, START } from '@langchain/langgraph'
import { Annotation } from '@langchain/langgraph'
import { createDashScopeRuntime, type AiRuntime, type DetectedAnchor } from '../ai/runtime.js'
import {
  buildAnalyzeAndPlanMessages,
  buildPalaceImagePrompt,
  type NodesPalaceRouteStyle,
} from './prompts/nodesToPalace.js'

export interface SelectedNodeContent {
  id: string
  label: string
}

export interface PalaceStationResult {
  order: number
  content: string
  anchorVisual: string
  association?: string
  x: number
  y: number
  linkedNodeId: string
}

export interface PalaceResult {
  ok: true
  label: string
  stations: PalaceStationResult[]
  imageUrl: string
  sourceNodeIds: string[]
}

export interface PalaceError {
  ok: false
  error: string
}

export type NodesToPalaceResult = PalaceResult | PalaceError

type PlannedStation = {
  order: number
  content: string
  anchorVisual: string
  linkedNodeId: string
  association?: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const COORD_PAD = 0.05
const MIN_DISTANCE = 0.12

function enforceMinDistance(points: PalaceStationResult[]): PalaceStationResult[] {
  if (points.length <= 1) return points
  const result = points.map((p) => ({ ...p }))

  for (let pass = 0; pass < 8; pass++) {
    let moved = false
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const dx = result[j].x - result[i].x
        const dy = result[j].y - result[i].y
        const dist = Math.sqrt(dx * dx + dy * dy)

        if (dist >= MIN_DISTANCE) continue
        moved = true

        if (dist < 1e-6) {
          result[i].x = clamp(result[i].x - MIN_DISTANCE / 2, COORD_PAD, 1 - COORD_PAD)
          result[j].x = clamp(result[j].x + MIN_DISTANCE / 2, COORD_PAD, 1 - COORD_PAD)
        } else {
          const push = (MIN_DISTANCE - dist) / 2
          const nx = dx / dist
          const ny = dy / dist
          result[i].x = clamp(result[i].x - nx * push, COORD_PAD, 1 - COORD_PAD)
          result[i].y = clamp(result[i].y - ny * push, COORD_PAD, 1 - COORD_PAD)
          result[j].x = clamp(result[j].x + nx * push, COORD_PAD, 1 - COORD_PAD)
          result[j].y = clamp(result[j].y + ny * push, COORD_PAD, 1 - COORD_PAD)
        }
      }
    }
    if (!moved) break
  }

  return result
}

function normalizeRouteStyle(value: string | undefined, stationCount: number): NodesPalaceRouteStyle {
  if (value === 'arc' || value === 's_curve' || value === 'zigzag' || value === 'loop' || value === 'stairs') {
    return value
  }
  if (stationCount <= 3) return 'arc'
  if (stationCount <= 5) return 'zigzag'
  return 's_curve'
}

function applyCanonicalLayout(
  stations: PlannedStation[],
  routeStyle: NodesPalaceRouteStyle,
): PalaceStationResult[] {
  const sorted = [...stations].sort((a, b) => a.order - b.order)
  const n = sorted.length
  if (n === 0) return []

  const raw = sorted.map((s, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1)
    let x = COORD_PAD + t * (1 - 2 * COORD_PAD)
    let y = 0.5

    switch (routeStyle) {
      case 'arc':
        y = 0.34 + Math.sin(t * Math.PI) * 0.28
        break
      case 's_curve':
        y = 0.5 + Math.sin(t * Math.PI * 2) * 0.2
        break
      case 'zigzag':
        y = i % 2 === 0 ? 0.25 : 0.75
        break
      case 'loop': {
        const angle = Math.PI * 0.85 + t * Math.PI * 1.7
        x = 0.5 + Math.cos(angle) * 0.38
        y = 0.5 + Math.sin(angle) * 0.30
        break
      }
      case 'stairs':
        y = 0.78 - t * 0.56 + (i % 2 === 0 ? 0.05 : -0.05)
        break
    }

    return {
      ...s,
      x: clamp(x, COORD_PAD, 1 - COORD_PAD),
      y: clamp(y, COORD_PAD, 1 - COORD_PAD),
    }
  })

  return enforceMinDistance(raw)
}

function normalizeDetectedMap(coords: DetectedAnchor[]): Map<number, DetectedAnchor> {
  return new Map(coords.map((coord) => [coord.order, coord]))
}

function buildPlannedStations(
  rawStations: Array<{
    order?: number
    content?: string
    anchor_visual?: string
    anchorVisual?: string
    linked_node_id?: string
    linkedNodeId?: string
    association?: string
    visual_bridge?: string
    visualBridge?: string
  }>,
  selectedNodes: SelectedNodeContent[],
): PlannedStation[] {
  const selectedById = new Map(selectedNodes.map((node) => [node.id, node]))
  const unusedIds = new Set(selectedNodes.map((node) => node.id))

  const planned = [...rawStations]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((row, index) => {
      let linkedNodeId = (row.linked_node_id ?? row.linkedNodeId ?? '').trim()
      if (!linkedNodeId || !selectedById.has(linkedNodeId) || !unusedIds.has(linkedNodeId)) {
        linkedNodeId = selectedNodes.find((node) => unusedIds.has(node.id))?.id ?? ''
      }
      if (!linkedNodeId) return null

      unusedIds.delete(linkedNodeId)
      const sourceNode = selectedById.get(linkedNodeId)
      const content = sourceNode?.label.trim() || (row.content ?? '').trim() || `节点 ${index + 1}`
      const anchorVisual =
        (row.anchor_visual ?? row.anchorVisual ?? '').trim() || `与「${content.slice(0, 60)}」强相关的大型具象物体`
      const association =
        row.association?.trim() ||
        row.visual_bridge?.trim() ||
        row.visualBridge?.trim()

      return {
        order: row.order ?? index + 1,
        content,
        anchorVisual,
        linkedNodeId,
        ...(association ? { association } : {}),
      }
    })
    .filter((station): station is PlannedStation => station != null)

  const leftovers = [...unusedIds].map((nodeId, index) => {
    const content = selectedById.get(nodeId)?.label.trim() || `节点 ${planned.length + index + 1}`
    return {
      order: planned.length + index + 1,
      content,
      anchorVisual: `与「${content.slice(0, 60)}」强相关的大型具象物体`,
      linkedNodeId: nodeId,
      association: `通过与「${content}」直接相关的具象视觉锚点帮助回忆原节点内容。`,
    }
  })

  return [...planned, ...leftovers]
    .sort((a, b) => a.order - b.order)
    .map((station, index) => ({ ...station, order: index + 1 }))
}

const PalaceState = Annotation.Root({
  selectedNodes: Annotation<SelectedNodeContent[]>,
  apiKey: Annotation<string>,
  model: Annotation<string>,
  theme: Annotation<string>,
  sceneBrief: Annotation<string>,
  routeStyle: Annotation<NodesPalaceRouteStyle>,
  plannedStations: Annotation<PlannedStation[]>,
  stations: Annotation<PalaceStationResult[]>,
  imagePrompt: Annotation<string>,
  imageUrl: Annotation<string>,
  detectedCoords: Annotation<DetectedAnchor[]>,
  error: Annotation<string>,
})

export async function runNodesToPalace(params: {
  apiKey: string
  model: string
  selectedNodes: SelectedNodeContent[]
  runtime?: AiRuntime
}): Promise<NodesToPalaceResult> {
  const { apiKey, model, selectedNodes } = params
  if (!apiKey.trim()) return { ok: false, error: '未填写 API Key' }
  if (selectedNodes.length === 0) return { ok: false, error: '未选中任何节点' }

  const modelName = model.trim() || 'qwen-turbo'
  const runtime =
    params.runtime ??
    createDashScopeRuntime({
      apiKey,
      chatModel: modelName,
    })
  const llm = runtime.reasoningModel

  async function analyzeAndPlan(
    state: typeof PalaceState.State,
  ): Promise<Partial<typeof PalaceState.State>> {
    const response = await llm.invoke(buildAnalyzeAndPlanMessages(state.selectedNodes))

    try {
      const text = typeof response.content === 'string' ? response.content : ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        return { error: 'AI 未返回有效的 JSON 规划' }
      }

      const raw = JSON.parse(jsonMatch[0]) as {
        theme?: string
        scene_brief?: string
        sceneBrief?: string
        route_style?: string
        routeStyle?: string
        stations?: Array<{
          order?: number
          content?: string
          anchor_visual?: string
          anchorVisual?: string
          linked_node_id?: string
          linkedNodeId?: string
          association?: string
          visual_bridge?: string
          visualBridge?: string
        }>
      }

      const plannedStations = buildPlannedStations(raw.stations ?? [], state.selectedNodes)
      if (plannedStations.length === 0) {
        return { error: '未规划出有效站点' }
      }

      const theme = raw.theme?.trim() || `记忆宫殿 (${state.selectedNodes.length} 站)`
      const sceneBrief =
        raw.scene_brief?.trim() ||
        raw.sceneBrief?.trim() ||
        `围绕 ${state.selectedNodes.length} 个知识点展开的统一记忆场景`
      const routeStyle = normalizeRouteStyle(raw.route_style ?? raw.routeStyle, plannedStations.length)

      return { theme, sceneBrief, routeStyle, plannedStations }
    } catch {
      return { error: '解析 AI 规划失败' }
    }
  }

  async function buildImagePrompt(
    state: typeof PalaceState.State,
  ): Promise<Partial<typeof PalaceState.State>> {
    if (state.error || state.plannedStations.length === 0) return {}
    return {
      imagePrompt: buildPalaceImagePrompt({
        theme: state.theme,
        sceneBrief: state.sceneBrief,
        routeStyle: state.routeStyle,
        stations: state.plannedStations,
      }),
    }
  }

  async function generateImage(
    state: typeof PalaceState.State,
  ): Promise<Partial<typeof PalaceState.State>> {
    if (state.error || !state.imagePrompt) return {}

    try {
      const result = await runtime.generateImage({
        prompt: state.imagePrompt,
        size: '1024*1024',
        n: 1,
      })
      if (result.urls.length > 0) {
        return { imageUrl: result.urls[0] }
      }
      return { error: '未返回图片' }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  async function detectCoordinates(
    state: typeof PalaceState.State,
  ): Promise<Partial<typeof PalaceState.State>> {
    if (!state.imageUrl || state.plannedStations.length === 0) return {}

    try {
      const detectedCoords = await runtime.locateAnchors({
        imageUrl: state.imageUrl,
        anchors: state.plannedStations.map((station) => ({
          order: station.order,
          anchorVisual: station.anchorVisual,
        })),
      })

      return { detectedCoords }
    } catch {
      return { detectedCoords: [] }
    }
  }

  async function buildLocatedStations(
    state: typeof PalaceState.State,
  ): Promise<Partial<typeof PalaceState.State>> {
    if (state.plannedStations.length === 0) return {}

    const coordMap = normalizeDetectedMap(state.detectedCoords)
    const raw = state.plannedStations.map((station) => {
      const coord = coordMap.get(station.order)
      return {
        ...station,
        x: coord?.x ?? 0.5,
        y: coord?.y ?? 0.5,
      }
    })

    return { stations: enforceMinDistance(raw) }
  }

  async function fallbackLayout(
    state: typeof PalaceState.State,
  ): Promise<Partial<typeof PalaceState.State>> {
    if (state.plannedStations.length === 0) return {}
    return { stations: applyCanonicalLayout(state.plannedStations, state.routeStyle) }
  }

  function routeAfterAnalyze(state: typeof PalaceState.State): string {
    if (state.error) return END
    return 'buildImagePrompt'
  }

  function routeAfterImage(state: typeof PalaceState.State): string {
    return state.imageUrl ? 'detectCoordinates' : 'fallbackLayout'
  }

  function routeAfterDetect(state: typeof PalaceState.State): string {
    const expectedCount = state.plannedStations.length
    return state.detectedCoords.length >= Math.max(1, Math.ceil(expectedCount * 0.5))
      ? 'buildLocatedStations'
      : 'fallbackLayout'
  }

  const graph = new StateGraph(PalaceState)
    .addNode('analyzeAndPlan', analyzeAndPlan)
    .addNode('buildImagePrompt', buildImagePrompt)
    .addNode('generateImage', generateImage)
    .addNode('detectCoordinates', detectCoordinates)
    .addNode('buildLocatedStations', buildLocatedStations)
    .addNode('fallbackLayout', fallbackLayout)
    .addEdge(START, 'analyzeAndPlan')
    .addConditionalEdges('analyzeAndPlan', routeAfterAnalyze)
    .addEdge('buildImagePrompt', 'generateImage')
    .addConditionalEdges('generateImage', routeAfterImage)
    .addConditionalEdges('detectCoordinates', routeAfterDetect)
    .addEdge('buildLocatedStations', END)
    .addEdge('fallbackLayout', END)

  const app = graph.compile()

  try {
    const result = await app.invoke({
      selectedNodes,
      apiKey,
      model: modelName,
      theme: '',
      sceneBrief: '',
      routeStyle: 's_curve',
      plannedStations: [],
      stations: [],
      imagePrompt: '',
      imageUrl: '',
      detectedCoords: [],
      error: '',
    })

    if (result.error) {
      return { ok: false, error: result.error }
    }

    return {
      ok: true,
      label: result.theme || `记忆宫殿 (${selectedNodes.length} 站)`,
      stations: result.stations,
      imageUrl: result.imageUrl || '',
      sourceNodeIds: selectedNodes.map((n) => n.id),
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
