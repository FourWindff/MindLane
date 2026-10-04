import fs from 'node:fs/promises'
import path from 'node:path'
import { AGENT_LIMITS } from '../config.js'
import { messageContentToString, sanitizeFileName } from '../utils.js'
import { isSubgraphCall } from '../subgraphRouter.js'

const DEFAULT_OFFLOAD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Normalize tool results uniformly into a string fit for the LLM context.
 *
 * Pipeline:
 * 1. Convert non-string content to a string via messageContentToString.
 * 2. Return a fallback notice for empty/blank/null/undefined results.
 * 3. Exempt tools (generateMindmapFragment / generatePalace) skip offload and truncation.
 * 4. Above toolResultOffloadChars, write the full content to userData/tool-results/ and
 *    return the first toolResultSummaryChars characters plus a file path reference.
 * 5. When offload fails and the content exceeds toolResultMaxChars, keep the head and
 *    append a truncation marker.
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

  if (isSubgraphCall(toolName)) {
    return content
  }

  if (content.length > AGENT_LIMITS.toolResultOffloadChars) {
    const offloadPath = await offload(toolName, toolCallId, content, userDataDir)
    if (offloadPath) {
      return buildOffloadSummary(content, offloadPath)
    }
    if (content.length > AGENT_LIMITS.toolResultMaxChars) {
      return truncate(content)
    }
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
  return `Tool ${toolName} returned no content. If you expected a result, try restating the request or checking whether the relevant resources are available.`
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

function buildOffloadSummary(content: string, offloadPath: string): string {
  const summaryLength = AGENT_LIMITS.toolResultSummaryChars
  const summary = content.slice(0, summaryLength)
  const totalLength = content.length

  return `[Tool result too long; offloaded to a local file]\nThe first ${summaryLength} chars below are a summary; the full content is ${totalLength} chars.\n\n${summary}\n\nFull result path: ${offloadPath}`
}

function truncate(content: string): string {
  const maxLength = AGENT_LIMITS.toolResultMaxChars
  const marker = `\n\n[Content exceeded the ${maxLength} char limit and was truncated.]`
  const headLength = Math.max(0, maxLength - marker.length)
  return content.slice(0, headLength) + marker
}
