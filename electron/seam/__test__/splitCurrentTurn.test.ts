import { describe, expect, it } from 'vitest'
import { splitCurrentTurn } from '../../ipc.js'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import type { ChatMessage } from '../../../src/shared/lib/fileFormat.js'

describe('splitCurrentTurn', () => {
  it('splits BaseMessage (type) on the last human message, previous includes the boundary', () => {
    const messages = [
      new HumanMessage('q1'),
      new AIMessage('a1'),
      new HumanMessage('q2'),
      new AIMessage('a2'),
    ]

    const { previous, current } = splitCurrentTurn(messages)

    expect(previous.map((m) => m.type)).toEqual(['human', 'ai', 'human'])
    expect(current.map((m) => m.type)).toEqual(['ai'])
  })

  it('splits ChatMessage (role) on the last user message, previous includes the boundary', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ]

    const { previous, current } = splitCurrentTurn(messages)

    expect(previous.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(current.map((m) => m.role)).toEqual(['assistant'])
  })

  it('returns all messages as previous and an empty current when no boundary exists', () => {
    const messages = [new AIMessage('a1'), new AIMessage('a2')]

    const { previous, current } = splitCurrentTurn(messages)

    expect(previous).toHaveLength(2)
    expect(current).toEqual([])
  })

  it('does not mutate the input array', () => {
    const messages = [new HumanMessage('q'), new AIMessage('a')]

    splitCurrentTurn(messages)

    expect(messages).toHaveLength(2)
  })
})
