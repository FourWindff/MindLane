import { Overwrite } from '@langchain/langgraph'
import YAML from 'yaml'
import type {
  DocumentMeta,
  LeafExtractionResult,
  MergeGroup,
  MergeTreeResult,
  MindmapYamlNode,
  PdfChunk,
} from './types.js'

export function overwriteArray<T>(value: T[]): T[] {
  return new Overwrite(value) as unknown as T[]
}

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

export function normalizeTree(
  node: MindmapYamlNode,
  fallbackRange: string,
): MindmapYamlNode {
  const children = (node.children ?? []).map((child) =>
    normalizeTree(child, fallbackRange),
  )
  const pageRange = normalizePageRangeValue(node.page_range) ?? fallbackRange

  return {
    label: node.label.trim(),
    page_range: pageRange,
    ...(node.summary?.trim() ? { summary: node.summary.trim() } : {}),
    children,
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

export function parsePageRange(pageRange: string): [number, number] | null {
  const normalized = normalizePageRangeValue(pageRange)
  if (!normalized) return null

  const singlePageMatch = normalized.match(/^(\d+)$/)
  if (singlePageMatch) {
    const page = Number(singlePageMatch[1])
    return [page, page]
  }

  const match = normalized.match(/(\d+)\s*-\s*(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2])]
}

export function formatPageRange(start: number, end: number): string {
  return `${start}-${end}`
}

export function responseToText(response: unknown): string {
  const content = response && typeof response === 'object' && 'content' in response
    ? (response as { content?: unknown }).content
    : response

  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .join('')
  }
  return String(content ?? '')
}

export function extractYaml(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error('模型返回为空')
  }

  const fenced = trimmed.match(/```ya?ml\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    return YAML.parse(fenced[1].trim())
  }

  const direct = tryParseYaml(trimmed)
  if (direct !== undefined) return direct

  const lines = trimmed.split('\n')
  const yamlStart = lines.findIndex((line) =>
    /^\s*(label|page_range|summary|children)\s*:/.test(line)
    || /^\s*-\s+.+/.test(line)
    || /^\s*[^:\n]+:\s*(?:\[\]|)?\s*$/.test(line),
  )
  if (yamlStart >= 0) {
    const candidate = lines.slice(yamlStart).join('\n').trim()
    const parsed = tryParseYaml(candidate)
    if (parsed !== undefined) return parsed
  }

  throw new Error('无法从模型输出中提取 YAML')
}

export function sanitizeTreeCandidate(value: unknown): unknown {
  const outlineTree = tryParseOutlineTree(value)
  if (outlineTree) {
    return sanitizeStructuredTree(outlineTree)
  }

  return sanitizeStructuredTree(value)
}

function sanitizeStructuredTree(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStructuredTree(item))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const record = value as Record<string, unknown>
  const sanitizedChildren = Array.isArray(record.children)
    ? record.children.map((child) => sanitizeStructuredTree(child))
    : record.children

  return {
    ...record,
    ...(typeof record.label === 'string' ? { label: record.label.trim() } : {}),
    ...(record.page_range !== undefined
      ? { page_range: normalizePageRangeValue(record.page_range) ?? String(record.page_range).trim() }
      : {}),
    ...(record.summary !== undefined && record.summary !== null
      ? { summary: String(record.summary).trim() }
      : {}),
    ...(sanitizedChildren !== undefined ? { children: sanitizedChildren } : {}),
  }
}

export async function withRetries<T>(
  fn: () => Promise<T>,
  retries: number,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

function tryParseYaml(text: string): unknown | undefined {
  try {
    return YAML.parse(text)
  } catch {
    return undefined
  }
}

function normalizePageRangeValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return formatPageRange(value, value)
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) return null

  const singlePageMatch = trimmed.match(/^p?\s*(\d+)$/i)
  if (singlePageMatch) {
    const page = Number(singlePageMatch[1])
    return formatPageRange(page, page)
  }

  const rangeMatch = trimmed.match(/^p?\s*(\d+)\s*[-~—–至]+\s*(\d+)$/i)
  if (rangeMatch) {
    return formatPageRange(Number(rangeMatch[1]), Number(rangeMatch[2]))
  }

  return trimmed
}

function tryParseOutlineTree(value: unknown): MindmapYamlNode | null {
  if (!value) return null

  if (Array.isArray(value)) {
    if (value.length !== 1) return null
    return parseOutlineEntry(value[0])
  }

  if (typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  if (isStructuredTreeRecord(record)) {
    return null
  }

  const entries = Object.entries(record)
  if (entries.length !== 1) return null
  return parseOutlineObjectEntry(entries[0][0], entries[0][1])
}

function parseOutlineEntry(value: unknown): MindmapYamlNode | null {
  if (typeof value === 'string') {
    return titleToTreeNode(value, [])
  }

  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  if (isStructuredTreeRecord(record)) {
    return null
  }

  const entries = Object.entries(record)
  if (entries.length !== 1) return null
  return parseOutlineObjectEntry(entries[0][0], entries[0][1])
}

function parseOutlineObjectEntry(
  rawTitle: string,
  rawChildren: unknown,
): MindmapYamlNode | null {
  const children = parseOutlineChildren(rawChildren)
  if (children === null) return null
  return titleToTreeNode(rawTitle, children)
}

function parseOutlineChildren(value: unknown): MindmapYamlNode[] | null {
  if (value === null || value === undefined) {
    return []
  }

  if (Array.isArray(value)) {
    const children = value
      .map((item) => parseOutlineEntry(item))
      .filter((item): item is MindmapYamlNode => item !== null)
    return children.length === value.length ? children : null
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (isStructuredTreeRecord(record)) {
      return null
    }

    const children = Object.entries(record)
      .map(([title, nested]) => parseOutlineObjectEntry(title, nested))
      .filter((item): item is MindmapYamlNode => item !== null)
    return children.length === Object.keys(record).length ? children : null
  }

  return null
}

function titleToTreeNode(
  rawTitle: string,
  children: MindmapYamlNode[],
): MindmapYamlNode {
  const { label, pageRange } = parseOutlineTitle(rawTitle)
  return {
    label,
    page_range: pageRange,
    children,
  }
}

function parseOutlineTitle(rawTitle: string): { label: string; pageRange: string } {
  const title = rawTitle.trim()
  const rangeMatch = title.match(/^(.*?)(?:\s*\[\s*p?([^\]]+)\s*\])$/i)
  if (!rangeMatch) {
    return {
      label: title,
      pageRange: '',
    }
  }

  return {
    label: rangeMatch[1].trim(),
    pageRange: normalizePageRangeValue(rangeMatch[2]) ?? '',
  }
}

function isStructuredTreeRecord(value: Record<string, unknown>): boolean {
  return (
    'label' in value
    || 'page_range' in value
    || 'summary' in value
    || 'children' in value
  )
}
