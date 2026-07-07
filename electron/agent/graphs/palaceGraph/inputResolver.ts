import { type BaseMessage } from '@langchain/core/messages'
import { extractTextContent } from '../../utils.js'
import type { PalaceSubgraphStateType, SelectedNodeContent } from '../../state.js'

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

export class PalaceInputResolver {
  /**
   * 解析记忆宫殿子图的输入。
   *
   * 优先级：
   * 1. 当前选中的节点
   * 2. 最新用户消息文本
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

    return null
  }
}
