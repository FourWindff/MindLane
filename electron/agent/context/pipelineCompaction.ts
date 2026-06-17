import fs from 'node:fs/promises'
import path from 'node:path'
import { ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { MessagePipelineConfig } from './pipelineTypes.js'
import { messageContentToString, sanitizeFileName } from '../utils.js'

const MICROCOMPACT_SUMMARY =
  '[Content compressed by message pipeline: original text exceeded configured threshold.]'

function getToolName(msg: ToolMessage): string {
  return msg.name ?? 'unknown'
}

function isTargetForMicrocompact(toolName: string, config: MessagePipelineConfig): boolean {
  return config.microcompactToolNames.includes(toolName)
}

function compactStringContent(content: ToolMessage['content'], threshold: number): ToolMessage['content'] {
  if (typeof content === 'string' && content.length > threshold) {
    return MICROCOMPACT_SUMMARY
  }

  if (Array.isArray(content)) {
    return content.map((block) => {
      if (
        block &&
        typeof block === 'object' &&
        'type' in block &&
        block.type === 'text' &&
        'text' in block &&
        typeof block.text === 'string' &&
        block.text.length > threshold
      ) {
        return { ...block, text: MICROCOMPACT_SUMMARY }
      }
      return block
    })
  }

  return content
}

/**
 * 对配置名单内的工具结果进行摘要替换。
 * 保留最近 N 条完整结果，旧结果按规则压缩。
 */
export function microcompact(
  messages: BaseMessage[],
  config: MessagePipelineConfig,
): BaseMessage[] {
  const keepRecent = Math.max(0, config.microcompactKeepRecent)
  const targetIndices: number[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.type !== 'tool') continue
    const toolMsg = msg as ToolMessage
    if (isTargetForMicrocompact(getToolName(toolMsg), config)) {
      targetIndices.push(i)
    }
  }

  if (targetIndices.length === 0) return messages

  const keepSet =
    keepRecent > 0 ? new Set(targetIndices.slice(-keepRecent)) : new Set<number>()

  return messages.map((msg, idx) => {
    if (msg.type !== 'tool') return msg
    const toolMsg = msg as ToolMessage
    if (!isTargetForMicrocompact(getToolName(toolMsg), config)) return msg

    if (keepSet.has(idx)) return msg

    const compacted = compactStringContent(toolMsg.content, config.microcompactThreshold)
    if (compacted === toolMsg.content) return msg

    return new ToolMessage({
      tool_call_id: toolMsg.tool_call_id,
      name: toolMsg.name,
      content: compacted,
      additional_kwargs: toolMsg.additional_kwargs,
    })
  })
}

/**
 * 限制单条 tool_result 大小，超限内容写入 userData 临时文件，原消息用引用替换。
 */
export async function applyToolResultBudget(
  messages: BaseMessage[],
  config: MessagePipelineConfig,
  userDataPath?: string,
): Promise<BaseMessage[]> {
  if (config.toolResultMaxBytes <= 0) return messages

  const result: BaseMessage[] = []
  for (const msg of messages) {
    if (msg.type !== 'tool') {
      result.push(msg)
      continue
    }

    const toolMsg = msg as ToolMessage
    const text = messageContentToString(toolMsg.content)
    const buffer = Buffer.from(text, 'utf8')

    if (buffer.length <= config.toolResultMaxBytes) {
      result.push(msg)
      continue
    }

    const refContent = await createOffloadReference(
      toolMsg,
      text,
      config.toolResultMaxBytes,
      userDataPath,
    )

    result.push(
      new ToolMessage({
        tool_call_id: toolMsg.tool_call_id,
        name: toolMsg.name,
        content: refContent,
        additional_kwargs: toolMsg.additional_kwargs,
      }),
    )
  }

  return result
}

async function createOffloadReference(
  toolMsg: ToolMessage,
  text: string,
  budget: number,
  userDataPath?: string,
): Promise<string> {
  const toolName = getToolName(toolMsg)
  const safeToolName = sanitizeFileName(toolName)
  const safeCallId = sanitizeFileName(toolMsg.tool_call_id)

  const headChars = Math.max(0, budget - 256)
  const head = text.slice(0, headChars)
  const totalBytes = Buffer.byteLength(text, 'utf8')

  let filePath: string | undefined
  if (userDataPath) {
    const dir = path.join(userDataPath, 'message-pipeline-offloads')
    await fs.mkdir(dir, { recursive: true }).catch(() => {})
    filePath = path.join(dir, `${safeCallId}-${safeToolName}.txt`)
    await fs.writeFile(filePath, text, 'utf8').catch(() => {
      filePath = undefined
    })
  }

  const refLine = filePath
    ? `Full content offloaded to: ${filePath}`
    : 'Offload to disk failed; content truncated.'

  return `[Tool result exceeded ${budget} bytes budget (${totalBytes} bytes total).]\n${refLine}\n\nFirst ${headChars} characters:\n${head}`
}

