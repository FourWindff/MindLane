import { describe, it, expect } from 'vitest'
import { RemoveMessage, HumanMessage, AIMessage } from '@langchain/core/messages'
import { REMOVE_ALL_MESSAGES, messagesStateReducer } from '@langchain/langgraph'

describe('messagesStateReducer', () => {
  it('replaces all messages when RemoveMessage(REMOVE_ALL_MESSAGES) is passed', () => {
    const existing = [
      new HumanMessage({ content: 'old message 1', id: 'm1' }),
      new AIMessage({ content: 'old reply 1', id: 'm2' }),
      new HumanMessage({ content: 'old message 2', id: 'm3' }),
    ]
    const update = [
      new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
      new HumanMessage({ content: 'new message', id: 'm4' }),
    ]

    const result = messagesStateReducer(existing, update)

    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('new message')
  })

  it('appends messages normally without RemoveMessage', () => {
    const existing = [new HumanMessage({ content: 'hello', id: 'm1' })]
    const update = [new AIMessage({ content: 'hi', id: 'm2' })]

    const result = messagesStateReducer(existing, update)

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe('hello')
    expect(result[1].content).toBe('hi')
  })
})
