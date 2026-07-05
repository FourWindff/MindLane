import { describe, it, expect } from 'vitest'
import { StateGraph } from '@langchain/langgraph'
import { SystemMessage } from '@langchain/core/messages'
import { MainGraphState, MindmapSubgraphState } from '../state.js'

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
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
      response: '',
      error: '',
      mindmapInputSource: { type: 'pdf', path: '/test.pdf' },
      mindmapInputTitle: 'Test',
      mindmapYaml: '',
      mindmapTitle: '',
      documentChunks: [],
      leafCursor: 0,
      pendingLeafRange: null,
      leafResults: [],
      mergeInputs: [],
      partialMergedTrees: [],
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
        })
        return {}
      })
      .addEdge('__start__', 'test')
      .addEdge('test', '__end__')

    const compiled = graph.compile()
    await compiled.invoke({
      messages: [],
      context: null,
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
      response: '',
      error: '',
      mindmapInputSource: null,
      mindmapInputTitle: '',
      mindmapYaml: '',
      mindmapTitle: '',
      documentChunks: [],
      leafCursor: 0,
      pendingLeafRange: null,
      leafResults: [],
      mergeInputs: [],
      partialMergedTrees: [],
      mergeResults: [],
      documentRef: {
        id: 'doc-1',
        type: 'pdf',
        source: '/test.pdf',
        filename: 'test.pdf',
        importedAt: new Date().toISOString(),
      },
    })
  })

  it('has mindmapYaml field', async () => {
    const graph = new StateGraph(MindmapSubgraphState)
      .addNode('test', async (state) => {
        expect(state.mindmapYaml).toBe('root:\n  label: Test\n')
        return {}
      })
      .addEdge('__start__', 'test')
      .addEdge('test', '__end__')

    const compiled = graph.compile()
    await compiled.invoke({
      messages: [],
      context: null,
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
      response: '',
      error: '',
      mindmapInputSource: null,
      mindmapInputTitle: '',
      mindmapYaml: 'root:\n  label: Test\n',
      mindmapTitle: '',
      documentChunks: [],
      leafCursor: 0,
      pendingLeafRange: null,
      leafResults: [],
      mergeInputs: [],
      partialMergedTrees: [],
      mergeResults: [],
      documentRef: null,
    })
  })

  it('replaces leafResults via reducer', async () => {
    const graph = new StateGraph(MindmapSubgraphState)
      .addNode('addLeaf', async () => {
        return { leafResults: [{ chunkIndex: 1, chunkId: 'c2', tree: { root: 'b' } }] }
      })
      .addEdge('__start__', 'addLeaf')
      .addEdge('addLeaf', '__end__')

    const compiled = graph.compile()
    const result = await compiled.invoke({
      messages: [],
      context: null,
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
      response: '',
      error: '',
      mindmapInputSource: null,
      mindmapInputTitle: '',
      mindmapYaml: '',
      mindmapTitle: '',
      documentChunks: [],
      leafCursor: 0,
      pendingLeafRange: null,
      leafResults: [{ chunkIndex: 0, chunkId: 'c1', tree: { root: 'a' } }],
      mergeInputs: [],
      partialMergedTrees: [],
      mergeResults: [],
      documentRef: null,
    })

    expect(result.leafResults).toHaveLength(1)
    expect(result.leafResults[0].chunkId).toBe('c2')
  })

  it('replaces mergeResults via reducer', async () => {
    const graph = new StateGraph(MindmapSubgraphState)
      .addNode('addMerge', async () => {
        return { mergeResults: [{ groupIndex: 1, tree: { root: 'b' } }] }
      })
      .addEdge('__start__', 'addMerge')
      .addEdge('addMerge', '__end__')

    const compiled = graph.compile()
    const result = await compiled.invoke({
      messages: [],
      context: null,
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
      response: '',
      error: '',
      mindmapInputSource: null,
      mindmapInputTitle: '',
      mindmapYaml: '',
      mindmapTitle: '',
      documentChunks: [],
      leafCursor: 0,
      pendingLeafRange: null,
      leafResults: [],
      mergeInputs: [],
      partialMergedTrees: [],
      mergeResults: [{ groupIndex: 0, tree: { root: 'a' } }],
      documentRef: null,
    })

    expect(result.mergeResults).toHaveLength(1)
    expect(result.mergeResults[0].groupIndex).toBe(1)
  })
})

describe('MainGraphState', () => {
  it('combines mindmap and palace fields', async () => {
    const graph = new StateGraph(MainGraphState)
      .addNode('test', async (state) => {
        expect(state.mindmapInputSource).toEqual({ type: 'pdf', path: '/test.pdf' })
        expect(state.palaceInputText).toBe(' palace text')
        expect(state.imageUrls).toEqual([])
        return {}
      })
      .addEdge('__start__', 'test')
      .addEdge('test', '__end__')

    const compiled = graph.compile()
    await compiled.invoke({
      messages: [],
      context: null,
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
      response: '',
      error: '',
      mindmapInputSource: { type: 'pdf', path: '/test.pdf' },
      mindmapInputTitle: 'Test',
      mindmapYaml: '',
      mindmapTitle: '',
      documentChunks: [],
      leafCursor: 0,
      pendingLeafRange: null,
      leafResults: [],
      mergeInputs: [],
      partialMergedTrees: [],
      mergeResults: [],
      documentRef: null,
      palaceInputText: ' palace text',
      palaceInputNodes: [],
      palace: null,
      imageUrls: [],
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
      pendingSubgraph: null,
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
      response: '',
      error: '',
      mindmapInputSource: null,
      mindmapInputTitle: '',
      mindmapYaml: '',
      mindmapTitle: '',
      documentChunks: [],
      leafCursor: 0,
      pendingLeafRange: null,
      leafResults: [],
      mergeInputs: [],
      partialMergedTrees: [],
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
