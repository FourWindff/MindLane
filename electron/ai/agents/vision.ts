import type { LLMProvider, DetectedAnchor } from '../providers/index.js'
import type { AgentState } from '../state.js'
import type { MemoryPalaceStation, StationDesign } from '../state.js'
import { buildSummaryMessages } from './prompts/textToPalace.js'

const COORD_PAD = 0.05
const MIN_DISTANCE = 0.12

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function enforceMinDistance(points: MemoryPalaceStation[]): MemoryPalaceStation[] {
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

type RouteStyle = 'arc' | 's_curve' | 'zigzag' | 'loop' | 'stairs'

function applyCanonicalLayout(stations: StationDesign[], routeStyle?: string): MemoryPalaceStation[] {
  const sorted = [...stations].sort((a, b) => a.order - b.order)
  const n = sorted.length
  if (n === 0) return []
  const style = (routeStyle ?? 'arc') as RouteStyle

  const raw = sorted.map((s, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1)
    let x = COORD_PAD + t * (1 - 2 * COORD_PAD)
    let y = 0.5

    switch (style) {
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
      order: i + 1,
      content: s.content,
      x: clamp(x, COORD_PAD, 1 - COORD_PAD),
      y: clamp(y, COORD_PAD, 1 - COORD_PAD),
      anchorVisual: s.anchorVisual,
      mnemonicMethod: s.mnemonicMethod,
      association: s.association,
      linkedNodeId: s.linkedNodeId,
    }
  })

  return enforceMinDistance(raw)
}

function normalizeDetectedMap(coords: DetectedAnchor[]): Map<number, DetectedAnchor> {
  return new Map(coords.map((coord) => [coord.order, coord]))
}

function buildLocatedRoute(
  stations: StationDesign[],
  coordMap: Map<number, DetectedAnchor>,
): MemoryPalaceStation[] {
  const raw = stations
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
        linkedNodeId: station.linkedNodeId,
      }
    })

  return enforceMinDistance(raw)
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

export class VisionAgent {
  constructor(private provider: LLMProvider) {}

  async invoke(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
    if (!state.palace || state.error) return {}

    let memoryRoute: MemoryPalaceStation[]
    const hasImage = state.imageUrls.length > 0

    if (hasImage) {
      try {
        const detectedCoords = await this.provider.locateAnchors({
          imageUrl: state.imageUrls[0]!,
          anchors: state.palace.stations.map((station) => ({
            order: station.order,
            anchorVisual: station.anchorVisual,
          })),
        })

        const expectedCount = state.palace.stations.length
        const threshold = Math.max(1, Math.ceil(expectedCount * 0.5))

        if (detectedCoords.length >= threshold) {
          const coordMap = normalizeDetectedMap(detectedCoords)
          memoryRoute = buildLocatedRoute(state.palace.stations, coordMap)
        } else {
          memoryRoute = applyCanonicalLayout(state.palace.stations, state.palace.routeStyle)
        }
      } catch {
        memoryRoute = applyCanonicalLayout(state.palace.stations, state.palace.routeStyle)
      }
    } else {
      memoryRoute = applyCanonicalLayout(state.palace.stations, state.palace.routeStyle)
    }

    let summary: string
    try {
      const summaryResponse = await this.provider.reasoningModel.invoke(
        buildSummaryMessages({
          theme: state.palace.theme,
          hasImage,
          memoryRoute,
        }),
      )
      summary =
        typeof summaryResponse.content === 'string'
          ? summaryResponse.content.trim()
          : String(summaryResponse.content).trim()
      if (!summary) {
        summary = buildFallbackSummary(memoryRoute, hasImage)
      }
    } catch {
      summary = buildFallbackSummary(memoryRoute, hasImage)
    }

    return {
      memoryRoute,
      response: summary,
    }
  }
}
