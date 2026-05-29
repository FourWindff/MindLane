import YAML from 'yaml'
import { Overwrite } from '@langchain/langgraph'

export interface MindmapYamlNode {
  label: string
  page_range: string
  summary?: string
  children?: MindmapYamlNode[]
}

export function overwriteArray<T>(value: T[]): T[] {
  return new Overwrite(value) as unknown as T[]
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

  const expanded = expandIndent(trimmed)
  const expandedResult = tryParseYaml(expanded)
  if (expandedResult !== undefined) return expandedResult

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
    const expandedCandidate = expandIndent(candidate)
    const expandedCandidateResult = tryParseYaml(expandedCandidate)
    if (expandedCandidateResult !== undefined) return expandedCandidateResult
  }

  const bulletOutline = tryParseMarkdownBulletOutline(trimmed)
  if (bulletOutline) return bulletOutline

  throw new Error('无法从模型输出中提取 YAML')
}

export function sanitizeTreeCandidate(value: unknown): unknown {
  const outlineTree = tryParseOutlineTree(value)
  if (outlineTree) {
    return sanitizeStructuredTree(outlineTree)
  }

  return sanitizeStructuredTree(value)
}

export function sanitizeForestCandidate(value: unknown): MindmapYamlNode[] | null {
  const outlineForest = tryParseOutlineForest(value)
  if (outlineForest) {
    return outlineForest.map((tree) => sanitizeStructuredTree(tree) as MindmapYamlNode)
  }

  return null
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

export function serializeMindmapOutline(
  node: MindmapYamlNode,
  indentLevel = 0,
): string {
  const lines = serializeOutlineNode(node, indentLevel, true)
  return lines.join('\n')
}

export function serializeMindmapForestOutline(
  trees: MindmapYamlNode[],
  indentLevel = 0,
): string {
  const lines = trees.flatMap((tree) => serializeOutlineNode(tree, indentLevel, false))
  return lines.join('\n')
}

// ===== Private helpers =====

function tryParseYaml(text: string): unknown | undefined {
  try {
    return YAML.parse(text)
  } catch {
    return undefined
  }
}

function expandIndent(text: string): string {
  return text.replace(/^( +)/gm, (match) => '  '.repeat(match.length))
}

function tryParseMarkdownBulletOutline(text: string): MindmapYamlNode | null {
  const lines = text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)

  const firstBulletIndex = lines.findIndex((line) => parseMarkdownBulletLine(line) !== null)
  if (firstBulletIndex < 0) return null

  const rootLabel = lines
    .slice(0, firstBulletIndex)
    .map((line) => stripMarkdownDecorators(line.trim()))
    .filter(Boolean)
    .join(' ')

  if (!rootLabel) return null

  const root: MindmapYamlNode = {
    label: rootLabel,
    page_range: '',
    children: [],
  }
  const stack: Array<{ level: number; node: MindmapYamlNode }> = [{ level: 0, node: root }]

  for (const line of lines.slice(firstBulletIndex)) {
    const parsed = parseMarkdownBulletLine(line)
    if (!parsed) continue

    const node = titleToTreeNode(parsed.label, [])
    while (stack.length > 1 && stack[stack.length - 1]!.level >= parsed.level) {
      stack.pop()
    }

    const parent = stack[stack.length - 1]!.node
    parent.children ??= []
    parent.children.push(node)
    stack.push({ level: parsed.level, node })
  }

  return root.children && root.children.length > 0 ? root : null
}

function parseMarkdownBulletLine(line: string): { level: number; label: string } | null {
  const match = line.match(/^(\s*)([-*+•◦▪▫○●])\s+(.+)$/u)
  if (!match) return null

  const indentLevel = Math.floor(match[1]!.length / 2)
  const bullet = match[2]!
  const bulletLevel = bullet === '○' || bullet === '◦' ? 2 : bullet === '▪' || bullet === '▫' ? 3 : 1
  const level = Math.max(1, indentLevel + 1, bulletLevel)
  const label = stripMarkdownDecorators(match[3]!)

  return label ? { level, label } : null
}

function stripMarkdownDecorators(value: string): string {
  return value
    .trim()
    .replace(/^node:\s*/i, '')
    .replace(/^child:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
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

export function normalizePageRangeValue(value: unknown): string | null {
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

function tryParseOutlineForest(value: unknown): MindmapYamlNode[] | null {
  if (!value) return null

  if (Array.isArray(value)) {
    const nodes = value
      .map((item) => parseOutlineEntry(item))
      .filter((item): item is MindmapYamlNode => item !== null)
    return nodes.length === value.length ? nodes : null
  }

  const tree = tryParseOutlineTree(value)
  return tree ? [tree] : null
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

function serializeOutlineNode(
  node: MindmapYamlNode,
  indentLevel: number,
  isRoot: boolean,
): string[] {
  const indent = '  '.repeat(indentLevel)
  const title = stringifyYamlScalar(formatNodeTitle(node))
  const children = node.children ?? []

  if (isRoot) {
    if (children.length === 0) {
      return [`${indent}${title}: []`]
    }

    return [
      `${indent}${title}:`,
      ...serializeOutlineChildren(children, indentLevel + 1),
    ]
  }

  if (children.length === 0) {
    return [`${indent}- ${title}`]
  }

  return [
    `${indent}- ${title}:`,
    ...serializeOutlineChildren(children, indentLevel + 1),
  ]
}

function serializeOutlineChildren(
  children: MindmapYamlNode[],
  indentLevel: number,
): string[] {
  return children.flatMap((child) => serializeOutlineNode(child, indentLevel, false))
}

function formatNodeTitle(node: MindmapYamlNode): string {
  return node.label
}

function stringifyYamlScalar(value: string): string {
  return YAML.stringify(value).trim()
}
