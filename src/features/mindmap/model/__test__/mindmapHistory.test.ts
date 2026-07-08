import { describe, it, expect, beforeEach } from 'vitest'
import { MindmapHistory } from '../mindmapHistory'
import type { MindmapSnapshot, MindmapTransaction } from '../types'

function makeSnapshot(label: string): MindmapSnapshot {
  return {
    nodes: [{ id: label, type: 'text', position: { x: 0, y: 0 }, data: { label } }],
    edges: [],
  }
}

function makeTransaction(label: string): MindmapTransaction {
  return {
    id: label,
    before: makeSnapshot(`before-${label}`),
    commands: [{ type: 'addNode', node: makeSnapshot(label).nodes[0]! }],
    timestamp: Date.now(),
  }
}

describe('MindmapHistory', () => {
  let history: MindmapHistory

  beforeEach(() => {
    history = new MindmapHistory()
  })

  it('should start with no undo or redo', () => {
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
    expect(history.undo()).toBeNull()
    expect(history.redo()).toBeNull()
  })

  it('should record a transaction and allow undo', () => {
    const tx = makeTransaction('a')
    history.record(tx)

    expect(history.canUndo).toBe(true)
    expect(history.canRedo).toBe(false)
    expect(history.undo()).toEqual(tx.before)
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(true)
  })

  it('should redo a previously undone transaction', () => {
    const tx = makeTransaction('a')
    history.record(tx)
    history.undo()

    const redone = history.redo()
    expect(redone).toEqual(tx)
    expect(history.canUndo).toBe(true)
    expect(history.canRedo).toBe(false)
  })

  it('should clear redo stack when recording a new transaction', () => {
    const txA = makeTransaction('a')
    const txB = makeTransaction('b')
    history.record(txA)
    history.undo()
    history.record(txB)

    expect(history.canRedo).toBe(false)
    expect(history.undo()).toEqual(txB.before)
  })

  it('should drop oldest undo transaction when exceeding cap', () => {
    history = new MindmapHistory(3)
    const txs = [
      makeTransaction('1'),
      makeTransaction('2'),
      makeTransaction('3'),
      makeTransaction('4'),
    ]
    for (const tx of txs) history.record(tx)

    // 最旧的 '1' 应被丢弃
    expect(history.undo()).toEqual(txs[3]!.before)
    expect(history.undo()).toEqual(txs[2]!.before)
    expect(history.undo()).toEqual(txs[1]!.before)
    expect(history.undo()).toBeNull()
  })

  it('should drop oldest redo transaction when exceeding cap', () => {
    history = new MindmapHistory(3)
    const txs = [
      makeTransaction('1'),
      makeTransaction('2'),
      makeTransaction('3'),
      makeTransaction('4'),
    ]
    for (const tx of txs) history.record(tx)

    // 全部撤销以填满 redo 栈
    for (let i = 0; i < 4; i += 1) history.undo()

    // redo 栈也应被限制为 3，最旧的 '1' 被丢弃
    expect(history.redo()?.id).toBe('2')
    expect(history.redo()?.id).toBe('3')
    expect(history.redo()?.id).toBe('4')
    expect(history.redo()).toBeNull()
  })

  it('should clear both stacks', () => {
    history.record(makeTransaction('a'))
    history.undo()
    history.clear()

    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
  })
})
