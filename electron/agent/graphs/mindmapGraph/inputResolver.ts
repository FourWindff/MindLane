import type { BaseMessage } from '@langchain/core/messages'
import { extractTextContent } from '../../utils.js'
import type {
  MindmapInputSource,
  MindmapSubgraphStateType,
} from '../../state.js'
import type { DocumentRef } from '../../state.js'

export interface MindmapInputResolution {
  /** 解析后的输入源 */
  source: MindmapInputSource
  /** 用于生成的标题默认值 */
  title: string
}

function resolveAttachedDocument(documentRef: DocumentRef): MindmapInputSource {
  switch (documentRef.type) {
    case 'pdf':
      return { type: 'pdf', path: documentRef.source }
    case 'url':
      return { type: 'url', url: documentRef.source }
    case 'text':
      return { type: 'text', content: documentRef.source }
    default:
      // Exhaustive fallback; source type mismatch should be caught by analyzer
      return { type: 'text', content: documentRef.source }
  }
}

function resolveTitle(
  documentRef: DocumentRef | undefined,
  fileTitle: string | undefined,
): string {
  return documentRef?.title || documentRef?.filename || fileTitle || ''
}

function findLatestUserMessageText(messages: BaseMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.getType() === 'human') {
      const text = extractTextContent(message.content)
      if (text.trim()) {
        return text
      }
    }
  }
  return null
}

/**
 * 从子图状态中解析思维导图生成所需的输入源和标题。
 *
 * 解析优先级：
 * 1. 当前附加文档（state.context.attachedDocument）
 * 2. 最新一条非空用户消息文本
 */
export class MindmapInputResolver {
  resolve(state: MindmapSubgraphStateType): MindmapInputResolution | null {
    // 如果状态里已经有输入源（例如直接注入或上一轮保留），直接复用
    if (state.mindmapInputSource) {
      return {
        source: state.mindmapInputSource,
        title: state.mindmapInputTitle || state.context?.fileTitle || '',
      }
    }

    const attachedDocument = state.context?.attachedDocument
    const fileTitle = state.context?.fileTitle

    if (attachedDocument) {
      return {
        source: resolveAttachedDocument(attachedDocument),
        title: resolveTitle(attachedDocument, fileTitle),
      }
    }

    const userText = findLatestUserMessageText(state.messages)
    if (userText) {
      return {
        source: { type: 'text', content: userText },
        title: fileTitle || '',
      }
    }

    return null
  }
}
