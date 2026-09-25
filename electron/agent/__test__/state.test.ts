import { describe, it, expect } from 'vitest'
import { StateGraph } from '@langchain/langgraph'
import { SystemMessage } from '@langchain/core/messages'
import { MainGraphState, MindmapSubgraphState, PalaceSubgraphState } from '../state.js'

describe('MindmapSubgraphState', () => {
  it('has mindmapInputSource field', async () => {
    const graph = new StateGraph(MindmapSubgraphState)
      .addNode('test', async (state) => {
        expect(state.mindmapInputSource).toEqual({ type: 'pdf', path: '/test.pdf' })
        return {}
      })
      .addEdge('__start__', 'test')
      .addEdge('test', '__end__')

    const compiled = graph.compile()
    await compiled.invoke({
      messages: [],
      context: null,
      mindmapError: '',
      mindmapResponse: '',
      mindmapInputSource: { type: 'pdf', path: '/test.pdf' },
      mindmapInputTitle: 'Test',
      documentBatches: [],
      leafResults: [],
      mergeInputs: [],
      mergeResults: [],
      documentRef: null,
    })
  })

  it('has documentRef field', async () => {
    const graph = new StateGraph(MindmapSubgraphState)
      .addNode('test', async (state) => {
        expect(state.documentRef).toEqual({
          id: 'doc-1',
          type: 'pdf',
          source: '/test.pdf',
          filename: 'test.pdf',
          importedAt: expect.any(String),
          sha256: 'doc-1-hash',
        })
        return {}
      })
      .addEdge('__start__', 'test')
      .addEdge('test', '__end__')

    const compiled = graph.compile()
    await compiled.invoke({
      messages: [],
      context: null,
      mindmapError: '',
      mindmapResponse: '',
      mindmapInputSource: null,
      mindmapInputTitle: '',
      documentBatches: [],
      leafResults: [],
      mergeInputs: [],
      mergeResults: [],
      documentRef: {
        id: 'doc-1',
        type: 'pdf',
        source: '/test.pdf',
        filename: 'test.pdf',
        importedAt: new Date().toISOString(),
        sha256: 'doc-1-hash',
      },
    })
  })

  it('appends leafResults via reducer', async () => {
    const graph = new StateGraph(MindmapSubgraphState)
      .addNode('addLeaf', async () => {
        return {
          leafResults: [{ batchIndex: 1, batchId: 'c2', tree: { label: 'b', children: [] } }],
        }
      })
      .addEdge('__start__', 'addLeaf')
      .addEdge('addLeaf', '__end__')

    const compiled = graph.compile()
    const result = await compiled.invoke({
      messages: [],
      context: null,
      mindmapError: '',
      mindmapResponse: '',
      mindmapInputSource: null,
      mindmapInputTitle: '',
      documentBatches: [],
      leafResults: [{ batchIndex: 0, batchId: 'c1', tree: { label: 'a', children: [] } }],
      mergeInputs: [],
      mergeResults: [],
      documentRef: null,
    })

    expect(result.leafResults).toHaveLength(2)
    expect(result.leafResults[0].batchId).toBe('c1')
    expect(result.leafResults[1].batchId).toBe('c2')
  })

  it('clears leafResults when a node writes null', async () => {
    const graph = new StateGraph(MindmapSubgraphState)
      .addNode('clearLeaves', async () => {
        return { leafResults: null }
      })
      .addEdge('__start__', 'clearLeaves')
      .addEdge('clearLeaves', '__end__')

    const compiled = graph.compile()
    const result = await compiled.invoke({
      messages: [],
      context: null,
      mindmapError: '',
      mindmapResponse: '',
      mindmapInputSource: null,
      mindmapInputTitle: '',
      documentBatches: [],
      leafResults: [{ batchIndex: 0, batchId: 'c1', tree: { label: 'a', children: [] } }],
      mergeInputs: [],
      mergeResults: [],
      documentRef: null,
    })

    expect(result.leafResults).toHaveLength(0)
  })

  it('appends mergeResults via reducer', async () => {
    const graph = new StateGraph(MindmapSubgraphState)
      .addNode('addMerge', async () => {
        return { mergeResults: [{ groupIndex: 1, tree: { label: 'b', children: [] } }] }
      })
      .addEdge('__start__', 'addMerge')
      .addEdge('addMerge', '__end__')

    const compiled = graph.compile()
    const result = await compiled.invoke({
      messages: [],
      context: null,
      mindmapError: '',
      mindmapResponse: '',
      mindmapInputSource: null,
      mindmapInputTitle: '',
      documentBatches: [],
      leafResults: [],
      mergeInputs: [],
      mergeResults: [{ groupIndex: 0, tree: { label: 'a', children: [] } }],
      documentRef: null,
    })

    expect(result.mergeResults).toHaveLength(2)
    expect(result.mergeResults[0].groupIndex).toBe(0)
    expect(result.mergeResults[1].groupIndex).toBe(1)
  })
})

describe('MainGraphState', () => {
  it('combines mindmap and palace fields', async () => {
    const graph = new StateGraph(MainGraphState)
      .addNode('test', async (state) => {
        expect(state.mindmapInputSource).toEqual({ type: 'pdf', path: '/test.pdf' })
        expect(state.palaceInputText).toBe(' palace text')
        expect(state.imageUrls).toEqual([])
        // 宫殿子图的私有键：主图未声明就会被静默丢弃
        expect(state.imagePrompt).toBe('宫殿画面提示词')
        expect(state.imageError).toBeUndefined()
        expect(state.memoryItems).toEqual([{ order: 1, content: '记忆项' }])
        expect(state.detectedCoords).toEqual([{ order: 1, anchorVisual: '铜钟', x: 0.5, y: 0.5 }])
        return {}
      })
      .addEdge('__start__', 'test')
      .addEdge('test', '__end__')

    const compiled = graph.compile()
    await compiled.invoke({
      messages: [],
      context: null,
      mindmapError: '',
      mindmapResponse: '',
      mindmapInputSource: { type: 'pdf', path: '/test.pdf' },
      mindmapInputTitle: 'Test',
      documentBatches: [],
      leafResults: [],
      mergeInputs: [],
      mergeResults: [],
      documentRef: null,
      palaceInputText: ' palace text',
      palaceInputNodes: [],
      memoryItems: [{ order: 1, content: '记忆项' }],
      palace: null,
      imagePrompt: '宫殿画面提示词',
      imageUrls: [],
      imageError: undefined,
      detectedCoords: [{ order: 1, anchorVisual: '铜钟', x: 0.5, y: 0.5 }],
      memoryRoute: [],
    })
  })

  it('accumulates messages via reducer', async () => {
    const graph = new StateGraph(MainGraphState)
      .addNode('addMsg', async () => {
        return { messages: [{ type: 'human', content: 'hello' }] }
      })
      .addEdge('__start__', 'addMsg')
      .addEdge('addMsg', '__end__')

    const compiled = graph.compile()
    const result = await compiled.invoke({
      messages: [new SystemMessage('sys')],
      context: null,
      pendingSubgraphs: [],
      response: '',
      error: '',
      mindmapInputSource: null,
      mindmapInputTitle: '',
      documentBatches: [],
      leafResults: [],
      mergeInputs: [],
      mergeResults: [],
      documentRef: null,
      palaceInputText: '',
      palaceInputNodes: [],
      palace: null,
      imageUrls: [],
      memoryRoute: [],
    })

    expect(result.messages).toHaveLength(2)
  })
})

describe('子图通道与主图通道', () => {
  it('主图声明了两个子图的每一个通道：主图未声明的键跨图时被静默丢弃', () => {
    const mainKeys = Object.keys(MainGraphState.spec)

    for (const subgraph of [MindmapSubgraphState, PalaceSubgraphState]) {
      expect(mainKeys).toEqual(expect.arrayContaining(Object.keys(subgraph.spec)))
    }
  })

  it('两个子图除轮次通道外没有共用键：同一个键被两图写就是静默覆盖', () => {
    const sharedKeys = Object.keys(MindmapSubgraphState.spec).filter(
      (key) => key in PalaceSubgraphState.spec,
    )

    expect(sharedKeys.sort()).toEqual(['context', 'messages'])
  })

  it('子图写入的私有键跨图后仍读得到（防再次静默丢弃）', async () => {
    const palaceSubgraph = new StateGraph(PalaceSubgraphState)
      .addNode('writeImagePrompt', async () => ({ imagePrompt: '一座钟楼大厅' }))
      .addEdge('__start__', 'writeImagePrompt')
      .addEdge('writeImagePrompt', '__end__')
      .compile()

    let seenInMainGraph: string | undefined
    const mainGraph = new StateGraph(MainGraphState)
      // Mounted the way AgentOrchestrator does it: the compiled subgraph is a
      // node of the main graph and its writes land in the main graph's channels.
      .addNode('palaceSubgraph', palaceSubgraph)
      .addNode('afterSubgraph', async (state) => {
        seenInMainGraph = state.imagePrompt
        return {}
      })
      .addEdge('__start__', 'palaceSubgraph')
      .addEdge('palaceSubgraph', 'afterSubgraph')
      .addEdge('afterSubgraph', '__end__')
      .compile()

    await mainGraph.invoke({ messages: [], context: null })

    expect(seenInMainGraph).toBe('一座钟楼大厅')
  })
})
