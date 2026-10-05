import { z } from 'zod/v3'
import type { PalaceSubgraphStateType } from '../state.js'
import type { MemoryItem, StationDesign, SelectedNodeContent } from '../state.js'
import type { LLMProvider } from '../providers/index.js'
import { PalaceAgent } from './base.js'
import { ROUTE_STYLES, type RouteStyle } from './palaceLayout.js'
import { logger } from '../../shared/logger.js'
import { formatAgentError } from '../utils.js'
import { buildAnalyzeInputMessages, buildDesignMnemonicsMessages } from './prompts/textToPalace.js'
import { buildAnalyzeAndPlanMessages } from './prompts/nodesToPalace.js'

const analyzeSchema = z.object({
  items: z
    .array(
      z.object({
        order: z.number().int().min(1),
        content: z.string().min(1).max(240),
      }),
    )
    .min(1)
    .max(12),
})

const designSchema = z.object({
  theme: z.string().min(4).max(80),
  stations: z
    .array(
      z.object({
        order: z.number().int().min(1),
        content: z.string().min(1).max(240),
        anchorVisual: z.string().min(6).max(200),
        mnemonicMethod: z.string().min(6).max(200),
        association: z.string().min(6).max(240),
      }),
    )
    .min(1)
    .max(12),
})

type AnalyzeResult = z.infer<typeof analyzeSchema>
type DesignResult = z.infer<typeof designSchema>

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
): StationDesign[] {
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
      const content = sourceNode?.label.trim() || (row.content ?? '').trim() || `Node ${index + 1}`
      const anchorVisual =
        (row.anchor_visual ?? row.anchorVisual ?? '').trim() ||
        `A large, concrete object strongly related to "${content.slice(0, 60)}"`
      const association =
        row.association?.trim() || row.visual_bridge?.trim() || row.visualBridge?.trim() || ''

      return {
        order: row.order ?? index + 1,
        content,
        anchorVisual,
        mnemonicMethod: 'Visual association',
        association,
        linkedNodeId,
      } as StationDesign
    })
    .filter((s) => s != null) as StationDesign[]

  const leftovers: StationDesign[] = [...unusedIds].map((nodeId, index) => {
    const content = selectedById.get(nodeId)?.label.trim() || `Node ${planned.length + index + 1}`
    return {
      order: planned.length + index + 1,
      content,
      anchorVisual: `A large, concrete object strongly related to "${content.slice(0, 60)}"`,
      mnemonicMethod: 'Visual association',
      association: `A concrete visual anchor directly related to "${content}" helps recall the original node content.`,
      linkedNodeId: nodeId,
    }
  })

  return ([...planned, ...leftovers] as StationDesign[])
    .sort((a, b) => a.order - b.order)
    .map((station, index) => ({ ...station, order: index + 1 }))
}

function normalizeRouteStyle(value: string | undefined, stationCount: number): RouteStyle {
  if (value && (ROUTE_STYLES as readonly string[]).includes(value)) {
    return value as RouteStyle
  }
  if (stationCount <= 3) return 'arc'
  if (stationCount <= 5) return 'zigzag'
  return 's_curve'
}

/**
 * AnalyzeAgent - memory-content analysis agent.
 *
 * Architectural responsibilities:
 * 1. Analyze text content and extract the key items to memorize.
 * 2. Design the station layout of the memory palace.
 * 3. Plan a memory palace from the selected mindmap nodes.
 *
 * Stateless design:
 * - No persistent memory access.
 * - All input travels through state.
 * - Outputs are written to state and returned.
 */
export class AnalyzeAgent extends PalaceAgent {
  private readonly analyzeModel
  private readonly designModel

  constructor(provider: LLMProvider) {
    super(provider)
    this.analyzeModel = this.provider.model.withStructuredOutput(analyzeSchema)
    this.designModel = this.provider.model.withStructuredOutput(designSchema)
  }

  async invoke(state: PalaceSubgraphStateType): Promise<Partial<PalaceSubgraphStateType>> {
    if (state.palaceInputNodes.length > 0) {
      return this.analyzeFromNodes(state.palaceInputNodes)
    }

    const text = state.palaceInputText
    if (!text) {
      return { palaceError: 'No content provided to memorize' }
    }

    const chatMessages = state.messages
      .filter((m) => {
        const type = m.type
        return type === 'human' || type === 'ai' || type === 'system'
      })
      .map((m) => ({
        role: m.type === 'human' ? 'user' : m.type === 'ai' ? 'assistant' : 'system',
        content: typeof m.content === 'string' ? m.content : String(m.content),
      }))

    return this.analyzeFromText(text, chatMessages)
  }

  private async analyzeFromText(
    text: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<Partial<PalaceSubgraphStateType>> {
    const conversation = messages
      .map(
        (m) =>
          `${m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System'}: ${m.content}`,
      )
      .join('\n')
    const inputText = conversation || text

    try {
      const analyzeResult = (await this.analyzeModel.invoke(
        buildAnalyzeInputMessages(inputText),
      )) as AnalyzeResult

      const memoryItems: MemoryItem[] = analyzeResult.items
        .map((item, index) => ({
          order: item.order ?? index + 1,
          content: item.content.trim(),
        }))
        .filter((item) => item.content.length > 0)
        .sort((a, b) => a.order - b.order)
        .map((item, index) => ({ ...item, order: index + 1 }))

      if (memoryItems.length === 0) {
        return { palaceError: 'No valid memory items extracted' }
      }

      const designResult = (await this.designModel.invoke(
        buildDesignMnemonicsMessages(memoryItems),
      )) as DesignResult

      const stations: StationDesign[] = designResult.stations
        .map((station, index) => ({
          order: station.order ?? index + 1,
          content: station.content.trim(),
          anchorVisual: station.anchorVisual.trim(),
          mnemonicMethod: station.mnemonicMethod.trim(),
          association: station.association.trim(),
        }))
        .filter((station) => station.content.length > 0 && station.anchorVisual.length > 0)
        .sort((a, b) => a.order - b.order)
        .map((station, index) => ({ ...station, order: index + 1 }))

      if (stations.length !== memoryItems.length) {
        return { palaceError: 'The number of memory stations does not match the number of items' }
      }

      return {
        palace: {
          theme: designResult.theme.trim(),
          stations,
        },
      }
    } catch (error) {
      logger.withContext('AnalyzeAgent').error('analyzeFromText failed:\n', formatAgentError(error))
      return { palaceError: formatAgentError(error) }
    }
  }

  private async analyzeFromNodes(
    selectedNodes: SelectedNodeContent[],
  ): Promise<Partial<PalaceSubgraphStateType>> {
    const model = this.provider.model
    try {
      const response = await model.invoke(buildAnalyzeAndPlanMessages(selectedNodes))
      const text = typeof response.content === 'string' ? response.content : ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        return { palaceError: 'The AI did not return a valid JSON plan' }
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

      const stations = buildPlannedStations(raw.stations ?? [], selectedNodes)
      if (stations.length === 0) {
        return { palaceError: 'No valid stations planned' }
      }

      const theme = raw.theme?.trim() || `Memory palace (${selectedNodes.length} stations)`
      const sceneBrief =
        raw.scene_brief?.trim() ||
        raw.sceneBrief?.trim() ||
        `A unified memory scene built around ${selectedNodes.length} knowledge points`
      const routeStyle = normalizeRouteStyle(raw.route_style ?? raw.routeStyle, stations.length)

      return {
        palace: {
          theme,
          sceneBrief,
          routeStyle,
          stations,
        },
      }
    } catch (error) {
      logger
        .withContext('AnalyzeAgent')
        .error('analyzeFromNodes failed:\n', formatAgentError(error))
      return { palaceError: formatAgentError(error) }
    }
  }
}
