import { describe, it, expect } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import { PalaceInputResolver } from '../palaceGraph/inputResolver.js'
import type { PalaceSubgraphStateType } from '../../state.js'

function createState(partial: Partial<PalaceSubgraphStateType> = {}): PalaceSubgraphStateType {
  return {
    messages: [],
    context: null,
    pendingSubgraph: 'palace',
    pendingSubgraphToolCallId: '',
    pendingSubgraphToolName: '',
    response: '',
    error: '',
    palaceInputText: '',
    palaceInputNodes: [],
    palace: null,
    imageUrls: [],
    memoryRoute: [],
    ...partial,
  } as PalaceSubgraphStateType
}

describe('PalaceInputResolver', () => {
  it('resolves selected nodes as priority input', async () => {
    const resolver = new PalaceInputResolver()

    const result = await resolver.resolve(
      createState({
        context: {
          fileUuid: 'file-1',
          selectedNodes: [
            { id: 'n1', type: 'text', label: 'Node 1' },
            { id: 'n2', type: 'text', label: 'Node 2' },
          ],
        },
        messages: [new HumanMessage('some text')],
      }),
    )

    expect(result).toEqual({
      palaceInputNodes: [
        { id: 'n1', label: 'Node 1' },
        { id: 'n2', label: 'Node 2' },
      ],
      palaceInputText: 'some text',
    })
  })

  it('falls back to latest user message text', async () => {
    const resolver = new PalaceInputResolver()

    const result = await resolver.resolve(
      createState({
        messages: [new HumanMessage('hello'), new HumanMessage('palace input')],
      }),
    )

    expect(result).toEqual({
      palaceInputNodes: [],
      palaceInputText: 'palace input',
    })
  })

  it('returns null when no input is available', async () => {
    const resolver = new PalaceInputResolver()

    const result = await resolver.resolve(createState())

    expect(result).toBeNull()
  })
})
