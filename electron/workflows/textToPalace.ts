import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { z } from 'zod/v3'

import {
  createDashScopeRuntime,
  urlToDataUrl,
  type AiRuntime,
  type DetectedAnchor,
} from '../ai/runtime.js'
import {
  buildAnalyzeInputMessages,
  buildDesignMnemonicsMessages,
  buildImagePromptGeneratorMessages,
  buildSummaryMessages,
} from './prompts/textToPalace.js'

export type TextToPalaceMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type MemoryPalaceStation = {
  order: number
  content: string
  x: number
  y: number
  anchorVisual?: string
  mnemonicMethod?: string
  association?: string
}

type MemoryItem = {
  order: number
  content: string
}

type StationDesign = {
  order: number
  content: string
  anchorVisual: string
  mnemonicMethod: string
  association: string
}

type PalaceDesign = {
  theme: string
  stations: StationDesign[]
}

export type TextToPalaceResult =
  | { ok: true; content: string; imageUrls?: string[]; memoryRoute?: MemoryPalaceStation[] }
  | { ok: false; error: string }

const TextToPalaceState = Annotation.Root({
  messages: Annotation<TextToPalaceMessage[]>,
  userText: Annotation<string>,
  memoryItems: Annotation<MemoryItem[]>,
  palace: Annotation<PalaceDesign | null>,
  imagePrompt: Annotation<string>,
  imageUrls: Annotation<string[]>,
  detectedCoords: Annotation<DetectedAnchor[]>,
  memoryRoute: Annotation<MemoryPalaceStation[]>,
  summary: Annotation<string>,
  error: Annotation<string>,
})

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

function applyCanonicalLayout(stations: StationDesign[]): MemoryPalaceStation[] {
  const sorted = [...stations].sort((a, b) => a.order - b.order)
  const n = sorted.length
  if (n === 0) return []
  return sorted.map((station, index) => {
    const t = n === 1 ? 0.5 : index / (n - 1)
    return {
      order: index + 1,
      content: station.content,
      x: 0.08 + t * 0.84,
      y: 0.36 + Math.sin(t * Math.PI) * 0.26,
      anchorVisual: station.anchorVisual,
      mnemonicMethod: station.mnemonicMethod,
      association: station.association,
    }
  })
}

function normalizeMessages(messages: TextToPalaceMessage[]): TextToPalaceMessage[] {
  return messages
    .filter((message) => {
      return (
        (message.role === 'system' || message.role === 'user' || message.role === 'assistant') &&
        message.content.trim().length > 0
      )
    })
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
}

function formatConversation(messages: TextToPalaceMessage[]): string {
  return messages
    .map((message) => `${message.role === 'user' ? '用户' : message.role === 'assistant' ? '助手' : '系统'}: ${message.content}`)
    .join('\n')
}

function normalizeDetectedMap(coords: DetectedAnchor[]): Map<number, DetectedAnchor> {
  return new Map(coords.map((coord) => [coord.order, coord]))
}

function buildFallbackSummary(route: MemoryPalaceStation[], hasImage: boolean): string {
  const lines = route
    .sort((a, b) => a.order - b.order)
    .map((station) => {
      const suffix = station.association ? `，联想：${station.association}` : ''
      return `${station.order}. ${station.content}${suffix}`
    })
  return `${hasImage ? '已生成记忆宫殿图。' : '已生成记忆路线。'}按顺序依次经过这些地点：\n${lines.join('\n')}`
}

export async function runTextToPalace(params: {
  apiKey: string
  model: string
  messages: TextToPalaceMessage[]
  runtime?: AiRuntime
}): Promise<TextToPalaceResult> {
  const apiKey = params.apiKey.trim()
  if (!apiKey) return { ok: false, error: '未填写 API Key' }

  const messages = normalizeMessages(params.messages ?? [])
  const userText = [...messages].reverse().find((message) => message.role === 'user')?.content ?? ''
  if (!userText) return { ok: false, error: '未提供用户输入' }

  const runtime =
    params.runtime ??
    createDashScopeRuntime({
      apiKey,
      chatModel: params.model.trim() || 'qwen-turbo',
    })

  const analyzeModel = runtime.reasoningModel.withStructuredOutput(analyzeSchema)
  const designModel = runtime.reasoningModel.withStructuredOutput(designSchema)

  async function analyzeInput(
    state: typeof TextToPalaceState.State,
  ): Promise<Partial<typeof TextToPalaceState.State>> {
    try {
      const result = (await analyzeModel.invoke(
        buildAnalyzeInputMessages(formatConversation(state.messages)),
      )) as AnalyzeResult

      const memoryItems = result.items
        .map((item: AnalyzeResult['items'][number], index: number) => ({
          order: item.order ?? index + 1,
          content: item.content.trim(),
        }))
        .filter((item: MemoryItem) => item.content.length > 0)
        .sort((a: MemoryItem, b: MemoryItem) => a.order - b.order)
        .map((item: MemoryItem, index: number) => ({ ...item, order: index + 1 }))

      if (memoryItems.length === 0) {
        return { error: '未拆解出有效记忆条目' }
      }

      return { memoryItems }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  async function designMnemonics(
    state: typeof TextToPalaceState.State,
  ): Promise<Partial<typeof TextToPalaceState.State>> {
    try {
      const result = (await designModel.invoke(
        buildDesignMnemonicsMessages(state.memoryItems),
      )) as DesignResult

      const stations = result.stations
        .map((station: DesignResult['stations'][number], index: number) => ({
          order: station.order ?? index + 1,
          content: station.content.trim(),
          anchorVisual: station.anchorVisual.trim(),
          mnemonicMethod: station.mnemonicMethod.trim(),
          association: station.association.trim(),
        }))
        .filter((station: StationDesign) => station.content.length > 0 && station.anchorVisual.length > 0)
        .sort((a: StationDesign, b: StationDesign) => a.order - b.order)
        .map((station: StationDesign, index: number) => ({ ...station, order: index + 1 }))

      if (stations.length !== state.memoryItems.length) {
        return { error: '记忆站点数量与条目数量不一致' }
      }

      return {
        palace: {
          theme: result.theme.trim(),
          stations,
        },
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  async function generateImage(
    state: typeof TextToPalaceState.State,
  ): Promise<Partial<typeof TextToPalaceState.State>> {
    if (!state.palace) return {}

    try {
      const promptResponse = await runtime.reasoningModel.invoke(
        buildImagePromptGeneratorMessages(state.palace),
      )

      const imagePrompt =
        typeof promptResponse.content === 'string'
          ? promptResponse.content.trim()
          : String(promptResponse.content).trim()

      if (!imagePrompt) {
        return {}
      }

      const imageResult = await runtime.generateImage({
        prompt: imagePrompt,
        size: '1024*1024',
        n: 1,
      })

      return {
        imagePrompt,
        imageUrls: imageResult.urls,
      }
    } catch {
      return {
        imagePrompt: '',
        imageUrls: [],
      }
    }
  }

  async function detectCoordinates(
    state: typeof TextToPalaceState.State,
  ): Promise<Partial<typeof TextToPalaceState.State>> {
    if (!state.palace || state.imageUrls.length === 0) return {}

    try {
      const detectedCoords = await runtime.locateAnchors({
        imageUrl: state.imageUrls[0]!,
        anchors: state.palace.stations.map((station) => ({
          order: station.order,
          anchorVisual: station.anchorVisual,
        })),
      })

      return { detectedCoords }
    } catch {
      return { detectedCoords: [] }
    }
  }

  async function buildRoute(
    state: typeof TextToPalaceState.State,
  ): Promise<Partial<typeof TextToPalaceState.State>> {
    if (!state.palace) return {}

    const coordMap = normalizeDetectedMap(state.detectedCoords)
    const memoryRoute = state.palace.stations
      .sort((a, b) => a.order - b.order)
      .map((station) => {
        const coord = coordMap.get(station.order)
        return {
          order: station.order,
          content: station.content,
          x: coord?.x ?? 0.5,
          y: coord?.y ?? 0.5,
          anchorVisual: station.anchorVisual,
          mnemonicMethod: station.mnemonicMethod,
          association: station.association,
        }
      })

    return { memoryRoute }
  }

  async function fallbackRoute(
    state: typeof TextToPalaceState.State,
  ): Promise<Partial<typeof TextToPalaceState.State>> {
    if (!state.palace) return {}
    return { memoryRoute: applyCanonicalLayout(state.palace.stations) }
  }

  async function summarize(
    state: typeof TextToPalaceState.State,
  ): Promise<Partial<typeof TextToPalaceState.State>> {
    if (!state.palace || state.memoryRoute.length === 0) return {}

    try {
      const summaryResponse = await runtime.reasoningModel.invoke(
        buildSummaryMessages({
          theme: state.palace.theme,
          hasImage: state.imageUrls.length > 0,
          memoryRoute: state.memoryRoute,
        }),
      )

      const summary =
        typeof summaryResponse.content === 'string'
          ? summaryResponse.content.trim()
          : String(summaryResponse.content).trim()

      return {
        summary: summary || buildFallbackSummary(state.memoryRoute, state.imageUrls.length > 0),
      }
    } catch {
      return {
        summary: buildFallbackSummary(state.memoryRoute, state.imageUrls.length > 0),
      }
    }
  }

  function routeAfterAnalyze(state: typeof TextToPalaceState.State): string {
    return state.error ? END : 'designMnemonics'
  }

  function routeAfterDesign(state: typeof TextToPalaceState.State): string {
    return state.error || !state.palace ? END : 'generateImage'
  }

  function routeAfterImage(state: typeof TextToPalaceState.State): string {
    return state.imageUrls.length > 0 ? 'detectCoordinates' : 'fallbackRoute'
  }

  function routeAfterDetect(state: typeof TextToPalaceState.State): string {
    const expectedCount = state.palace?.stations.length ?? 0
    return state.detectedCoords.length >= Math.max(1, Math.ceil(expectedCount * 0.5))
      ? 'buildRoute'
      : 'fallbackRoute'
  }

  const graph = new StateGraph(TextToPalaceState)
    .addNode('analyzeInput', analyzeInput)
    .addNode('designMnemonics', designMnemonics)
    .addNode('generateImage', generateImage)
    .addNode('detectCoordinates', detectCoordinates)
    .addNode('buildRoute', buildRoute)
    .addNode('fallbackRoute', fallbackRoute)
    .addNode('summarize', summarize)
    .addEdge(START, 'analyzeInput')
    .addConditionalEdges('analyzeInput', routeAfterAnalyze)
    .addConditionalEdges('designMnemonics', routeAfterDesign)
    .addConditionalEdges('generateImage', routeAfterImage)
    .addConditionalEdges('detectCoordinates', routeAfterDetect)
    .addEdge('buildRoute', 'summarize')
    .addEdge('fallbackRoute', 'summarize')
    .addEdge('summarize', END)

  try {
    const app = graph.compile()
    const result = await app.invoke({
      messages,
      userText,
      memoryItems: [],
      palace: null,
      imagePrompt: '',
      imageUrls: [],
      detectedCoords: [],
      memoryRoute: [],
      summary: '',
      error: '',
    })

    if (result.error) {
      return { ok: false, error: result.error }
    }

    let imageUrls = result.imageUrls
    if (imageUrls.length > 0) {
      const converted = await Promise.all(
        imageUrls.map(async (url) => {
          if (url.startsWith('data:')) return url
          try { return await urlToDataUrl(url) } catch { return url }
        }),
      )
      imageUrls = converted
    }

    return {
      ok: true,
      content: result.summary || buildFallbackSummary(result.memoryRoute, imageUrls.length > 0),
      ...(imageUrls.length > 0 ? { imageUrls } : {}),
      ...(result.memoryRoute.length > 0 ? { memoryRoute: result.memoryRoute } : {}),
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
