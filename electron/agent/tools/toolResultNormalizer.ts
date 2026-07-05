import fs from 'node:fs/promises'
import path from 'node:path'
import { AGENT_LIMITS } from '../config.js'
import { messageContentToString, sanitizeFileName } from '../utils.js'
import { GENERATE_MINDMAP_FRAGMENT_TOOL, GENERATE_PALACE_TOOL } from './subgraphRoutingTools.js'

const EXEMPT_TOOLS = new Set([GENERATE_MINDMAP_FRAGMENT_TOOL, GENERATE_PALACE_TOOL])

const DEFAULT_OFFLOAD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 将工具结果统一规范化为适合进入 LLM 上下文的字符串。
 *
 * 处理流程：
 * 1. 将非字符串 content 通过 messageContentToString 转为字符串。
 * 2. 对空/空白/null/undefined 结果返回中文兜底提示。
 * 3. 豁免工具（generateMindmapFragment / generatePalace）跳过 offload 与截断。
 * 4. 超过 toolResultOffloadChars 时，将完整内容写入 userData/tool-results/，
 *    返回前 toolResultSummaryChars 字符摘要 + 文件路径引用。
 * 5. 超过 toolResultMaxChars 时，保留头部并附加截断标记。
 */
export async function _normalize_tool_result(
  toolName: string,
  rawResult: unknown,
  toolCallId: string,
  userDataDir?: string,
): Promise<string> {
  const content = messageContentToString(rawResult).trim()

  if (!content) {
    return fallbackEmpty(toolName)
  }

  if (EXEMPT_TOOLS.has(toolName)) {
    return content
  }

  if (content.length > AGENT_LIMITS.toolResultMaxChars) {
    const offloadPath = await offload(toolName, toolCallId, content, userDataDir)
    return truncate(content, offloadPath)
  }

  if (content.length > AGENT_LIMITS.toolResultOffloadChars) {
    const offloadPath = await offload(toolName, toolCallId, content, userDataDir)
    return buildOffloadSummary(content, offloadPath)
  }

  return content
}

export async function cleanupToolResultOffloads(
  userDataDir: string,
  options: {
    maxAgeMs?: number
    now?: number
  } = {},
): Promise<number> {
  const dir = path.join(userDataDir, AGENT_LIMITS.toolResultOffloadDirName)
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_OFFLOAD_MAX_AGE_MS
  const now = options.now ?? Date.now()

  let entries: Array<import('node:fs').Dirent>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }

  let removed = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue

    const filePath = path.join(dir, entry.name)
    try {
      const stat = await fs.stat(filePath)
      if (now - stat.mtimeMs <= maxAgeMs) continue
      await fs.unlink(filePath)
      removed += 1
    } catch {
      // Best-effort cleanup; ignore files that disappear or cannot be removed.
    }
  }

  return removed
}

function fallbackEmpty(toolName: string): string {
  return `该工具（${toolName}）未返回任何内容。如果你期望看到结果，请尝试重新描述需求或检查相关资源是否可用。`
}

async function offload(
  toolName: string,
  toolCallId: string,
  content: string,
  userDataDir?: string,
): Promise<string | undefined> {
  if (!userDataDir) {
    return undefined
  }

  const dir = path.join(userDataDir, AGENT_LIMITS.toolResultOffloadDirName)

  const safeToolName = sanitizeFileName(toolName)
  const safeToolCallId = sanitizeFileName(toolCallId)
  const fileName = `${safeToolCallId}-${safeToolName}.txt`
  const filePath = path.join(dir, fileName)

  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(filePath, content, 'utf8')
    return filePath
  } catch {
    return undefined
  }
}

function buildOffloadSummary(content: string, offloadPath?: string): string {
  const summaryLength = AGENT_LIMITS.toolResultSummaryChars
  const summary = content.slice(0, summaryLength)
  const totalLength = content.length

  if (offloadPath) {
    return `[工具结果较长，已转存到本地文件]\n以下前 ${summaryLength} 字符为摘要，完整内容共 ${totalLength} 字符。\n\n${summary}\n\n完整结果路径：${offloadPath}`
  }

  return `[工具结果较长，但转存到本地文件失败]\n以下前 ${summaryLength} 字符为摘要，完整内容共 ${totalLength} 字符。\n\n${summary}`
}

function truncate(content: string, offloadPath?: string): string {
  const maxLength = AGENT_LIMITS.toolResultMaxChars

  const marker = offloadPath
    ? `\n\n[内容已超出 ${maxLength} 字符上限，已截断。完整结果已保存到：${offloadPath}]`
    : `\n\n[内容已超出 ${maxLength} 字符上限，已截断。]`

  const headLength = Math.max(0, maxLength - marker.length)
  return content.slice(0, headLength) + marker
}
