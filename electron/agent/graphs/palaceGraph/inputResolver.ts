import { findLatestUserMessageText } from '../../utils.js'
import type { PalaceSubgraphStateType, SelectedNodeContent } from '../../state.js'

interface PalaceInputResolution {
  palaceInputNodes: SelectedNodeContent[]
  palaceInputText: string
}

function mapSelectedNodes(nodes: { id: string; label: string }[]): SelectedNodeContent[] {
  return nodes.map((node) => ({ id: node.id, label: node.label }))
}

export class PalaceInputResolver {
  /**
   * Resolve the input of the memory palace subgraph.
   *
   * Priority:
   * 1. Currently selected nodes
   * 2. Latest user message text
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
