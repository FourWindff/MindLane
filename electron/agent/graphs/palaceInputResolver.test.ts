import { describe, it, expect } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import { resolvePalaceInput } from './palaceGraph/inputResolver.js'
import type { PalaceSubgraphStateType } from '../state.js'

function createState(partial: Partial<PalaceSubgraphStateType> = {}): PalaceSubgraphStateType {
  return {
    messages: [],
    context: null,
    palaceError: '',
    palaceResponse: '',
    palaceInputText: '',
    palaceInputNodes: [],
    memoryItems: [],
    palace: null,
    imagePrompt: '',
    imageUrls: [],
    imageError: undefined,
    detectedCoords: [],
    memoryRoute: [],
    ...partial,
  } as PalaceSubgraphStateType
}

describe('resolvePalaceInput', () => {
  it('resolves selected nodes as priority input', async () => {
    const result = resolvePalaceInput(
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
    const result = resolvePalaceInput(
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
    const result = resolvePalaceInput(createState())

    expect(result).toBeNull()
  })
})
