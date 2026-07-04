import { describe, it, expect } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import { PalaceInputResolver } from '../palaceGraph/inputResolver.js'
import type { PalaceSubgraphStateType } from '../../state.js'
import type { DocumentRef } from '../../state.js'
import { CacheManager } from '../../../fs/cacheManager.js'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'

function createState(
  partial: Partial<PalaceSubgraphStateType> = {},
): PalaceSubgraphStateType {
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

async function createTempCacheManager(): Promise<{
  cacheManager: CacheManager
  cleanup: () => Promise<void>
}> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mindlane-cache-'))
  const cacheManager = new CacheManager(tmpDir)
  await cacheManager.initialize()
  return {
    cacheManager,
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true })
    },
  }
}

describe('PalaceInputResolver', () => {
  it('resolves selected nodes as priority input', async () => {
    const resolver = new PalaceInputResolver()

    const result = await resolver.resolve(
      createState({
        context: {
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

  it('falls back to cached attached document text', async () => {
    const { cacheManager, cleanup } = await createTempCacheManager()
    try {
      const documentRef: DocumentRef = {
        id: 'doc-palace',
        type: 'pdf',
        source: '/data/book.pdf',
        filename: 'book.pdf',
        importedAt: new Date().toISOString(),
      }
      await cacheManager.cacheDocumentText('doc-palace', 'cached book content')

      const resolver = new PalaceInputResolver(cacheManager)
      const result = await resolver.resolve(
        createState({ context: { attachedDocument: documentRef } }),
      )

      expect(result).toEqual({
        palaceInputNodes: [],
        palaceInputText: 'cached book content',
      })
    } finally {
      await cleanup()
    }
  })

  it('returns null when no input is available', async () => {
    const resolver = new PalaceInputResolver()

    const result = await resolver.resolve(createState())

    expect(result).toBeNull()
  })

  it('returns null when attached document is not cached', async () => {
    const { cacheManager, cleanup } = await createTempCacheManager()
    try {
      const documentRef: DocumentRef = {
        id: 'doc-uncached',
        type: 'pdf',
        source: '/data/uncached.pdf',
        filename: 'uncached.pdf',
        importedAt: new Date().toISOString(),
      }

      const resolver = new PalaceInputResolver(cacheManager)
      const result = await resolver.resolve(
        createState({ context: { attachedDocument: documentRef } }),
      )

      expect(result).toBeNull()
    } finally {
      await cleanup()
    }
  })
})
