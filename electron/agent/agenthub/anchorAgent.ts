import type { DetectedAnchor } from '../providers/index.js'
import type { PalaceSubgraphStateType } from '../state.js'
import type { MemoryPalaceStation, StationDesign } from '../state.js'
import { buildSummaryMessages } from './prompts/textToPalace.js'
import { buildAnchorLocateMessages } from './prompts/anchorLocate.js'
import { PalaceAgent } from './base.js'
import { messageContentToString, formatAgentError, clamp } from '../utils.js'
import { PALACE_LAYOUT } from '../config.js'
import { logger } from '../../shared/logger.js'

const COORD_PAD = PALACE_LAYOUT.coordPad
const MIN_DISTANCE = PALACE_LAYOUT.minDistance

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

function applyCanonicalLayout(
  stations: StationDesign[],
  routeStyle?: string,
): MemoryPalaceStation[] {
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
        y = 0.5 + Math.sin(angle) * 0.3
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

// ===== Vision Agent 核心逻辑 =====

function parseJsonArray(text: string): unknown[] {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('未找到 JSON 数组')
  const parsed = JSON.parse(match[0]) as unknown
  if (!Array.isArray(parsed)) throw new Error('返回内容不是 JSON 数组')
  return parsed
}

function normalizeCoord(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value >= 0 && value <= 1) return value
  if (value >= 0 && value <= 1000) return value / 1000
  if (value >= 0 && value <= 100) return value / 100
  return null
}

function normalizeBoxCenter(box: unknown): { x: number; y: number } | null {
  if (!Array.isArray(box) || box.length < 4) return null
  const [x1Raw, y1Raw, x2Raw, y2Raw] = box
  const x1 = normalizeCoord(x1Raw)
  const y1 = normalizeCoord(y1Raw)
  const x2 = normalizeCoord(x2Raw)
  const y2 = normalizeCoord(y2Raw)
  if (x1 == null || y1 == null || x2 == null || y2 == null) return null
  return {
    x: Math.min(1, Math.max(0, (x1 + x2) / 2)),
    y: Math.min(1, Math.max(0, (y1 + y2) / 2)),
  }
}

function normalizeDetectedAnchors(
  raw: unknown[],
  anchors: Array<{ order: number; anchorVisual: string }>,
): DetectedAnchor[] {
  const fallbackMap = new Map(anchors.map((anchor) => [anchor.order, anchor.anchorVisual]))
  const out: DetectedAnchor[] = []

  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const obj = row as Record<string, unknown>
    const order = typeof obj.order === 'number' ? Math.floor(obj.order) : NaN
    if (!Number.isFinite(order) || order < 1) continue

    const directX = normalizeCoord(obj.x)
    const directY = normalizeCoord(obj.y)
    const center =
      directX != null && directY != null
        ? { x: directX, y: directY }
        : normalizeBoxCenter(obj.bbox ?? obj.box ?? obj.bounds)

    if (!center) continue

    const anchorVisual =
      (typeof obj.anchorVisual === 'string' && obj.anchorVisual.trim()) ||
      (typeof obj.anchor_visual === 'string' && obj.anchor_visual.trim()) ||
      fallbackMap.get(order) ||
      ''

    out.push({
      order,
      anchorVisual,
      x: Math.min(1, Math.max(0, center.x)),
      y: Math.min(1, Math.max(0, center.y)),
    })
  }

  return out.sort((a, b) => a.order - b.order)
}

/**
 * VisionAgent - 视觉定位智能体
 *
 * 架构职责：
 * 1. 在生成的记忆宫殿图像中定位锚点位置
 * 2. 应用标准布局作为回退方案
 * 3. 生成记忆路线总结
 *
 * 无状态设计：
 * - 不涉及持久化记忆访问
 * - 所有输入通过 state.palace 和 state.imageUrls 传递
 * - 输出 memoryRoute 和 response 总结
 */
export class AnchorAgent extends PalaceAgent {
  /**
   * 视觉定位：在图片中定位锚点位置
   * 作为 Vision Agent 的核心业务能力，与 Provider 解耦
   */
  private async locateAnchors(input: {
    imageUrl: string
    anchors: Array<{ order: number; anchorVisual: string }>
  }): Promise<DetectedAnchor[]> {
    if (!this.provider.visionModel) {
      throw new Error('No vision model configured')
    }
    if (!input.imageUrl.trim()) {
      throw new Error('缺少图片 URL')
    }
    if (input.anchors.length === 0) {
      return []
    }

    const response = await this.provider.visionModel.invoke(
      buildAnchorLocateMessages({
        imageUrl: input.imageUrl,
        anchors: input.anchors,
      }),
    )

    const content = messageContentToString(response.content).trim()
    if (!content) {
      throw new Error('视觉模型未返回内容')
    }

    const parsed = parseJsonArray(content)
    return normalizeDetectedAnchors(parsed, input.anchors)
  }

  async invoke(state: PalaceSubgraphStateType): Promise<Partial<PalaceSubgraphStateType>> {
    if (!state.palace || state.error) return {}

    let memoryRoute: MemoryPalaceStation[]
    const hasImage = state.imageUrls.length > 0

    if (hasImage) {
      try {
        const detectedCoords = await this.locateAnchors({
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
      } catch (err) {
        logger
          .withContext('AnchorAgent')
          .warn('locateAnchors 失败，降级到标准布局:\n', formatAgentError(err))
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
    } catch (err) {
      logger
        .withContext('AnchorAgent')
        .warn('总结生成失败，使用 fallback 摘要:\n', formatAgentError(err))
      summary = buildFallbackSummary(memoryRoute, hasImage)
    }

    return {
      memoryRoute,
      response: summary,
    }
  }
}
