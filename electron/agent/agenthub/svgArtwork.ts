import type { PalaceSubgraphStateType, MemoryPalaceStation } from '../state.js'
import type { StationDesign } from '../state.js'
import { isValidSvgArtwork } from '../../../src/shared/lib/mindmapXml/svg.js'
import { messageContentToString, formatAgentError } from '../utils.js'
import { logger } from '../../shared/logger.js'
import { applyCanonicalLayout, buildFallbackSummary, enforceMinDistance } from './palaceLayout.js'
import { buildSvgArtworkMessages } from './prompts/svgArtwork.js'
import { PalaceAgent } from './base.js'

export type SvgStationCoordinate = {
  order: number
  x: number
  y: number
}

export type SvgArtifact = {
  stations: SvgStationCoordinate[]
  svg: string
}

function findJsonBlock(text: string): string | null {
  const keyIndex = text.search(/["']stations["']\s*:/)
  if (keyIndex < 0) return null
  const start = text.lastIndexOf('{', keyIndex)
  if (start < 0) return null

  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

export function extractSvgArtifact(text: string): SvgArtifact | null {
  const svgMatch = text.match(/<svg\b[\s\S]*?<\/svg>/i)
  const jsonBlock = findJsonBlock(text)
  if (!svgMatch || !jsonBlock) return null

  try {
    const parsed = JSON.parse(jsonBlock) as { stations?: unknown }
    if (!Array.isArray(parsed.stations)) return null
    const stations = parsed.stations.flatMap((row): SvgStationCoordinate[] => {
      if (!row || typeof row !== 'object') return []
      const value = row as Record<string, unknown>
      return [
        {
          order: typeof value.order === 'number' ? value.order : NaN,
          x: typeof value.x === 'number' ? value.x : NaN,
          y: typeof value.y === 'number' ? value.y : NaN,
        },
      ]
    })
    return { stations, svg: svgMatch[0] }
  } catch {
    return null
  }
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}

function hasValidCoordinates(
  stations: StationDesign[],
  coordinates: SvgStationCoordinate[],
): boolean {
  if (coordinates.length !== stations.length) return false
  const orders = new Set<number>()
  for (const coordinate of coordinates) {
    if (
      !Number.isInteger(coordinate.order) ||
      coordinate.order < 1 ||
      orders.has(coordinate.order) ||
      !Number.isFinite(coordinate.x) ||
      !Number.isFinite(coordinate.y) ||
      coordinate.x < 0 ||
      coordinate.x > 1 ||
      coordinate.y < 0 ||
      coordinate.y > 1
    ) {
      return false
    }
    orders.add(coordinate.order)
  }
  return stations.every((station) => orders.has(station.order))
}

function buildVectorRoute(
  stations: StationDesign[],
  coordinates: SvgStationCoordinate[],
): MemoryPalaceStation[] {
  const byOrder = new Map(coordinates.map((coordinate) => [coordinate.order, coordinate]))
  const route = stations.map((station) => {
    const coordinate = byOrder.get(station.order)!
    return {
      order: station.order,
      content: station.content,
      x: coordinate.x,
      y: coordinate.y,
      anchorVisual: station.anchorVisual,
      mnemonicMethod: station.mnemonicMethod,
      association: station.association,
      linkedNodeId: station.linkedNodeId,
    }
  })
  return enforceMinDistance(route)
}

export class SvgAgent extends PalaceAgent {
  async invoke(state: PalaceSubgraphStateType): Promise<Partial<PalaceSubgraphStateType>> {
    if (!state.palace || state.error) return {}

    const stations = state.palace.stations
    const fallbackRoute = applyCanonicalLayout(stations, state.palace.routeStyle)
    try {
      const response = await this.provider.model.invoke(
        buildSvgArtworkMessages({
          theme: state.palace.theme,
          sceneBrief: state.palace.sceneBrief,
          routeStyle: state.palace.routeStyle,
          stations,
        }),
      )
      const artifact = extractSvgArtifact(messageContentToString(response.content))
      if (!artifact) {
        logger.withContext('SvgAgent').warn('矢量画面输出无法解析，使用无图宫殿')
        return {
          imageUrls: [],
          memoryRoute: fallbackRoute,
          response: buildFallbackSummary(fallbackRoute, false),
        }
      }

      const validCoordinates = hasValidCoordinates(stations, artifact.stations)
      const memoryRoute = validCoordinates
        ? buildVectorRoute(stations, artifact.stations)
        : fallbackRoute
      if (!validCoordinates) {
        logger.withContext('SvgAgent').warn('矢量站点坐标非法，使用标准布局')
      }

      if (!isValidSvgArtwork(artifact.svg, stations.length)) {
        logger.withContext('SvgAgent').warn('矢量画面未通过闸门，使用无图宫殿')
        return {
          imageUrls: [],
          memoryRoute,
          response: buildFallbackSummary(memoryRoute, false),
        }
      }

      return {
        imageUrls: [svgToDataUrl(artifact.svg)],
        memoryRoute,
        response: buildFallbackSummary(memoryRoute, true),
      }
    } catch (error) {
      logger
        .withContext('SvgAgent')
        .warn('矢量画面生成失败，使用无图宫殿:\n', formatAgentError(error))
      return {
        imageUrls: [],
        memoryRoute: fallbackRoute,
        response: buildFallbackSummary(fallbackRoute, false),
      }
    }
  }
}
