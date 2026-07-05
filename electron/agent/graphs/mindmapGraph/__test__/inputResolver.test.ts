import { describe, it, expect } from 'vitest'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import { MindmapInputResolver } from '../inputResolver.js'
import type { MindmapSubgraphStateType } from '../../../state.js'
import type { DocumentRef } from '../../../state.js'

function createState(partial: Partial<MindmapSubgraphStateType> = {}): MindmapSubgraphStateType {
  return {
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
    pendingMergeGroups: [],
    finalTree: null,
    documentRef: null,
    ...partial,
  } as MindmapSubgraphStateType
}

describe('MindmapInputResolver', () => {
  it('resolves attached PDF document', () => {
    const documentRef: DocumentRef = {
      id: 'doc-1',
      type: 'pdf',
      source: '/data/report.pdf',
      filename: 'report.pdf',
      importedAt: new Date().toISOString(),
      title: 'Annual Report',
    }
    const resolver = new MindmapInputResolver()

    const result = resolver.resolve(createState({ context: { attachedDocument: documentRef } }))

    expect(result).toEqual({
      source: { type: 'pdf', path: '/data/report.pdf' },
      title: 'Annual Report',
    })
  })

  it('resolves attached URL document', () => {
    const documentRef: DocumentRef = {
      id: 'doc-2',
      type: 'url',
      source: 'https://example.test/article',
      filename: 'article',
      importedAt: new Date().toISOString(),
    }
    const resolver = new MindmapInputResolver()

    const result = resolver.resolve(createState({ context: { attachedDocument: documentRef } }))

    expect(result).toEqual({
      source: { type: 'url', url: 'https://example.test/article' },
      title: 'article',
    })
  })

  it('resolves attached text document', () => {
    const documentRef: DocumentRef = {
      id: 'doc-3',
      type: 'text',
      source: '这是附加文本内容。',
      filename: 'notes.txt',
      importedAt: new Date().toISOString(),
    }
    const resolver = new MindmapInputResolver()

    const result = resolver.resolve(createState({ context: { attachedDocument: documentRef } }))

    expect(result).toEqual({
      source: { type: 'text', content: '这是附加文本内容。' },
      title: 'notes.txt',
    })
  })

  it('falls back to latest user message text', () => {
    const resolver = new MindmapInputResolver()

    const result = resolver.resolve(
      createState({
        messages: [
          new HumanMessage('first'),
          new AIMessage('ok'),
          new HumanMessage('latest user content'),
        ],
      }),
    )

    expect(result).toEqual({
      source: { type: 'text', content: 'latest user content' },
      title: '',
    })
  })

  it('uses fileTitle as fallback title when no document title or filename', () => {
    const documentRef: DocumentRef = {
      id: 'doc-4',
      type: 'pdf',
      source: '/data/report.pdf',
      filename: '',
      importedAt: new Date().toISOString(),
    }
    const resolver = new MindmapInputResolver()

    const result = resolver.resolve(
      createState({
        context: { attachedDocument: documentRef, fileTitle: 'Project X' },
      }),
    )

    expect(result?.title).toBe('Project X')
  })

  it('returns null when no input is available', () => {
    const resolver = new MindmapInputResolver()

    const result = resolver.resolve(createState())

    expect(result).toBeNull()
  })

  it('preserves existing mindmapInputSource if already set', () => {
    const resolver = new MindmapInputResolver()

    const result = resolver.resolve(
      createState({
        mindmapInputSource: { type: 'text', content: 'pre-set' },
        mindmapInputTitle: 'Pre-set Title',
        context: { attachedDocument: undefined },
      }),
    )

    expect(result).toEqual({
      source: { type: 'text', content: 'pre-set' },
      title: 'Pre-set Title',
    })
  })
})
