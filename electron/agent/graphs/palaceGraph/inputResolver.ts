import { type BaseMessage } from '@langchain/core/messages'
import { extractTextContent } from '../../utils.js'
import type { PalaceSubgraphStateType, SelectedNodeContent } from '../../state.js'
import type { DocumentRef } from '../../state.js'
import type { CacheManager } from '../../../fs/cacheManager.js'

export interface PalaceInputResolution {
  palaceInputNodes: SelectedNodeContent[]
  palaceInputText: string
}

function mapSelectedNodes(nodes: { id: string; label: string }[]): SelectedNodeContent[] {
  return nodes.map((node) => ({ id: node.id, label: node.label }))
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

function resolveCacheKey(documentRef: DocumentRef): string {
  const metadataTextCacheKey = documentRef.metadata?.textCacheKey
  if (typeof metadataTextCacheKey === 'string' && /^[A-Za-z0-9_-]+$/.test(metadataTextCacheKey)) {
    return metadataTextCacheKey
  }
  return documentRef.id
}

export class PalaceInputResolver {
  constructor(private readonly cacheManager?: CacheManager) {}

  /**
   * 解析记忆宫殿子图的输入。
   *
   * 优先级：
   * 1. 当前选中的节点
   * 2. 最新用户消息文本
   * 3. 当前附加文档的缓存文本
   */
  async resolve(state: PalaceSubgraphStateType): Promise<PalaceInputResolution | null> {
    const selectedNodes = state.context?.selectedNodes
    if (selectedNodes && selectedNodes.length > 0) {
      return {
        palaceInputNodes: mapSelectedNodes(selectedNodes),
        palaceInputText: findLatestUserMessageText(state.messages) || '',
      }
    }

    const userText = findLatestUserMessageText(state.messages)
    if (userText) {
      return {
        palaceInputNodes: [],
        palaceInputText: userText,
      }
    }

    const attachedDocument = state.context?.attachedDocument
    if (attachedDocument && this.cacheManager) {
      const text = await this.cacheManager.readDocumentText(resolveCacheKey(attachedDocument))
      if (text) {
        return {
          palaceInputNodes: [],
          palaceInputText: text,
        }
      }
    }

    return null
  }
}
