import type {
  DocumentMeta,
  LeafExtractionResult,
  MergeGroup,
  MergeTreeResult,
  MindmapYamlNode,
  PdfChunk,
} from './types.js'
import {
  formatPageRange,
  parsePageRange,
} from '../utils/yamlMindmap.js'
import YAML from 'yaml'

export function sortLeafResults(results: LeafExtractionResult[]): LeafExtractionResult[] {
  return [...results].sort((left, right) => left.chunkIndex - right.chunkIndex)
}

export function sortMergeResults(results: MergeTreeResult[]): MergeTreeResult[] {
  return [...results].sort((left, right) => left.groupIndex - right.groupIndex)
}

export function groupTrees(trees: MindmapYamlNode[], mergeBatchSize: number): MergeGroup[] {
  const size = Math.max(2, mergeBatchSize)
  const groups: MergeGroup[] = []

  for (let index = 0; index < trees.length; index += size) {
    groups.push({
      groupIndex: groups.length,
      trees: trees.slice(index, index + size),
    })
  }

  return groups
}

export function fallbackLeafNode(chunk: PdfChunk): MindmapYamlNode {
  const range = formatPageRange(chunk.startPage, chunk.endPage)
  return {
    label: `未解析片段 p${range}`,
    page_range: range,
    summary: chunk.text.slice(0, 120),
    children: [],
  }
}

export function fallbackMergeNode(
  trees: MindmapYamlNode[],
  documentTitle: string,
): MindmapYamlNode {
  return {
    label: `${documentTitle} 合并节点`,
    page_range: derivePageRange(trees),
    children: trees,
  }
}

export function createEmptyMindmapNode(document: DocumentMeta): MindmapYamlNode {
  return {
    label: document.title,
    page_range: `1-${document.totalPages}`,
    children: [],
  }
}

export function derivePageRange(trees: MindmapYamlNode[]): string {
  const pages = trees
    .flatMap((tree) => parsePageRange(tree.page_range) ?? [])
    .filter((value): value is number => Number.isFinite(value))

  if (pages.length === 0) return '1-1'
  const min = Math.min(...pages)
  const max = Math.max(...pages)
  return formatPageRange(min, max)
}

export function parseLeafBatchText(text: string): { results: Array<{ chunk_id: string; mindmap: unknown }> } {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error('模型返回为空')
  }

  try {
    const parsed = extractYamlFromText(trimmed)
    if (parsed && typeof parsed === 'object' && 'results' in (parsed as Record<string, unknown>)) {
      return parsed as { results: Array<{ chunk_id: string; mindmap: unknown }> }
    }
  } catch {
    // Fall through to custom parser
  }

  const raw = stripCodeFence(trimmed)
  const lines = raw.split('\n')
  const results: Array<{ chunk_id: string; mindmap: unknown }> = []
  let currentChunkId: string | null = null
  let mindmapLines: string[] = []
  let inMindmap = false

  const flushCurrent = () => {
    if (currentChunkId && mindmapLines.length > 0) {
      const nonEmpty = mindmapLines.filter((l) => l.trim())
      if (nonEmpty.length === 0) {
        results.push({ chunk_id: currentChunkId, mindmap: null })
        return
      }
      const minIndent = Math.min(...nonEmpty.map((l) => l.match(/^(\s*)/)![1].length))
      const dedented = mindmapLines.map((l) => l.slice(minIndent)).join('\n')
      const expanded = expandIndent(dedented)
      let parsed: unknown = null
      try {
        parsed = YAML.parse(expanded)
      } catch {
        try {
          parsed = YAML.parse(dedented)
        } catch {
          parsed = null
        }
      }
      results.push({ chunk_id: currentChunkId, mindmap: parsed })
    }
  }

  for (const line of lines) {
    const chunkIdMatch = line.match(/^\s*-\s*chunk_id:\s*(.+)$/)
    if (chunkIdMatch) {
      flushCurrent()
      currentChunkId = chunkIdMatch[1].trim()
      mindmapLines = []
      inMindmap = false
      continue
    }

    if (currentChunkId && /^\s*mindmap:\s*$/.test(line)) {
      inMindmap = true
      continue
    }

    if (inMindmap && currentChunkId) {
      mindmapLines.push(line)
    }
  }
  flushCurrent()

  if (results.length === 0) {
    throw new Error('无法从模型输出中提取 leaf batch YAML')
  }

  return { results }
}

// ===== Private helpers for parseLeafBatchText =====

function extractYamlFromText(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```ya?ml\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    return YAML.parse(fenced[1].trim())
  }
  return YAML.parse(trimmed)
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/```ya?ml\s*([\s\S]*?)```/i)
  return fenced?.[1]?.trim() ?? text
}

function expandIndent(text: string): string {
  return text.replace(/^( +)/gm, (match) => '  '.repeat(match.length))
}
