import { z } from 'zod/v3'
import type { LLMProvider } from '../providers/index.js'
import type { AgentState } from '../state.js'
import type { MemoryItem, StationDesign, SelectedNodeContent } from '../state.js'
import {
  buildAnalyzeInputMessages,
  buildDesignMnemonicsMessages,
} from './prompts/textToPalace.js'
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
      const content = sourceNode?.label.trim() || (row.content ?? '').trim() || `节点 ${index + 1}`
      const anchorVisual =
        (row.anchor_visual ?? row.anchorVisual ?? '').trim() || `与「${content.slice(0, 60)}」强相关的大型具象物体`
      const association =
        row.association?.trim() ||
        row.visual_bridge?.trim() ||
        row.visualBridge?.trim() ||
        ''

      return {
        order: row.order ?? index + 1,
        content,
        anchorVisual,
        mnemonicMethod: '形象联想',
        association,
        linkedNodeId,
      } as StationDesign
    })
    .filter((s) => s != null) as StationDesign[]

  const leftovers: StationDesign[] = [...unusedIds].map((nodeId, index) => {
    const content = selectedById.get(nodeId)?.label.trim() || `节点 ${planned.length + index + 1}`
    return {
      order: planned.length + index + 1,
      content,
      anchorVisual: `与「${content.slice(0, 60)}」强相关的大型具象物体`,
      mnemonicMethod: '形象联想',
      association: `通过与「${content}」直接相关的具象视觉锚点帮助回忆原节点内容。`,
      linkedNodeId: nodeId,
    }
  })

  return ([...planned, ...leftovers] as StationDesign[])
    .sort((a, b) => a.order - b.order)
    .map((station, index) => ({ ...station, order: index + 1 }))
}

function normalizeRouteStyle(value: string | undefined, stationCount: number): string {
  if (value === 'arc' || value === 's_curve' || value === 'zigzag' || value === 'loop' || value === 'stairs') {
    return value
  }
  if (stationCount <= 3) return 'arc'
  if (stationCount <= 5) return 'zigzag'
  return 's_curve'
}

export class AnalyzeAgent {
  constructor(private provider: LLMProvider) {}

  async invoke(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
    if (state.palaceInputNodes.length > 0) {
      return this.analyzeFromNodes(state.palaceInputNodes)
    }

    const text = state.palaceInputText
    if (!text) {
      return { error: '未提供要记忆的内容' }
    }

    const chatMessages = state.messages
      .filter((m) => {
        const type = m._getType()
        return type === 'human' || type === 'ai' || type === 'system'
      })
      .map((m) => ({
        role: m._getType() === 'human' ? 'user' : m._getType() === 'ai' ? 'assistant' : 'system',
        content: typeof m.content === 'string' ? m.content : String(m.content),
      }))

    return this.analyzeFromText(text, chatMessages)
  }

  private async analyzeFromText(
    text: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<Partial<typeof AgentState.State>> {
    const model = this.provider.reasoningModel
    const analyzeModel = model.withStructuredOutput(analyzeSchema)
    const designModel = model.withStructuredOutput(designSchema)

    const conversation = messages
      .map((m) => `${m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : '系统'}: ${m.content}`)
      .join('\n')
    const inputText = conversation || text

    try {
      const analyzeResult = (await analyzeModel.invoke(
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
        return { error: '未拆解出有效记忆条目' }
      }

      const designResult = (await designModel.invoke(
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
        return { error: '记忆站点数量与条目数量不一致' }
      }

      return {
        memoryItems,
        palace: {
          theme: designResult.theme.trim(),
          stations,
        },
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async analyzeFromNodes(
    selectedNodes: SelectedNodeContent[],
  ): Promise<Partial<typeof AgentState.State>> {
    const model = this.provider.reasoningModel
    try {
      const response = await model.invoke(buildAnalyzeAndPlanMessages(selectedNodes))
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

      const stations = buildPlannedStations(raw.stations ?? [], selectedNodes)
      if (stations.length === 0) {
        return { error: '未规划出有效站点' }
      }

      const theme = raw.theme?.trim() || `记忆宫殿 (${selectedNodes.length} 站)`
      const sceneBrief =
        raw.scene_brief?.trim() ||
        raw.sceneBrief?.trim() ||
        `围绕 ${selectedNodes.length} 个知识点展开的统一记忆场景`
      const routeStyle = normalizeRouteStyle(raw.route_style ?? raw.routeStyle, stations.length)

      const memoryItems: MemoryItem[] = stations.map((s) => ({
        order: s.order,
        content: s.content,
      }))

      return {
        memoryItems,
        palace: {
          theme,
          sceneBrief,
          routeStyle,
          stations,
        },
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
}
