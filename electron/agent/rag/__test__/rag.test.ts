import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'

import { DocumentIndexer } from '../indexer.js'
import { DocumentStore } from '../storage/document-store.js'
import type { VectorStoreManager } from '../storage/vector-store.js'
import { BM25SearchEngine } from '../retrieval/core/bm25.js'
import { loadPDFChunks } from '../prepare/chunk/pdf.js'
import { loadMindLaneChunks } from '../prepare/chunk/mindlane.js'
import { tokenize } from '../retrieval/utils/tokenizer.js'
import { reciprocalRankFusion } from '../retrieval/utils/rrf.js'
import { loadDocument } from '../prepare/loaders.js'
import type { Chunk } from '../types.js'

const TEST_DIR = path.dirname(new URL(import.meta.url).pathname)
const EXAMPLE_DIR = path.join(TEST_DIR, 'example')
const PDF_FILE = path.join(EXAMPLE_DIR, 'Hello-Agents-V1.0.2-20260210.pdf')
const MINDLANE_FILE = path.join(EXAMPLE_DIR, '123123.mindlane')
const MARKDOWN_FILE = path.join(EXAMPLE_DIR, '面试.md')

let tempDir: string

describe('RAG System Tests', () => {
  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-test-'))
    console.log('Test temp directory:', tempDir)

    const files = [PDF_FILE, MINDLANE_FILE, MARKDOWN_FILE]
    for (const file of files) {
      if (!fs.existsSync(file)) {
        throw new Error('Test file not found: ' + file)
      }
      console.log('Found test file: ' + path.basename(file) + ' (' + fs.statSync(file).size + ' bytes)')
    }
  })

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      console.log('Cleaned up temp directory')
    }
  })

  describe('1. Document Loading', () => {
    it('should load PDF file', async () => {
      const docId = 'test-pdf-001'
      const chunks = await loadPDFChunks(PDF_FILE, docId)

      expect(chunks.length).toBeGreaterThan(0)
      console.log('PDF loaded: ' + chunks.length + ' chunks')

      for (const chunk of chunks) {
        expect(chunk.id).toBeDefined()
        expect(chunk.content).toBeDefined()
        expect(chunk.metadata.filename).toBe('Hello-Agents-V1.0.2-20260210.pdf')
      }
    }, 60000)

    it('should load MindLane file', async () => {
      const docId = 'test-mindlane-001'
      const chunks = await loadMindLaneChunks(MINDLANE_FILE, docId)

      expect(chunks.length).toBeGreaterThan(0)
      console.log('MindLane loaded: ' + chunks.length + ' chunks')
    })

    it('should load Markdown file', async () => {
      const content = fs.readFileSync(MARKDOWN_FILE, 'utf-8')
      expect(content.length).toBeGreaterThan(0)
      console.log('Markdown loaded: ' + content.length + ' characters')
    })
  })

  describe('2. Tokenizer', () => {
    it('should tokenize Chinese text', () => {
      const text = '人工智能和机器学习'
      const tokens = tokenize(text)
      expect(tokens.length).toBeGreaterThan(0)
      console.log('Chinese tokens: [' + tokens.join(', ') + ']')
    })

    it('should tokenize English text', () => {
      const text = 'Machine Learning and AI'
      const tokens = tokenize(text)
      expect(tokens.length).toBeGreaterThan(0)
    })
  })

  describe('3. BM25 Search', () => {
    let bm25Engine: BM25SearchEngine
    let documentStore: DocumentStore

    beforeEach(() => {
      bm25Engine = new BM25SearchEngine()
      documentStore = new DocumentStore()
      documentStore.init(tempDir)
      bm25Engine.init(tempDir)

      const testChunks: Chunk[] = [
        {
          id: 'chunk-1',
          content: '人工智能是计算机科学的一个重要分支',
          level: 2,
          metadata: {
            docId: 'doc-1',
            filename: 'test.txt',
            source: '/test/test.txt',
            charCount: 50,
            indexedAt: new Date().toISOString(),
            path: ['人工智能']
          }
        },
        {
          id: 'chunk-2',
          content: '机器学习是人工智能的一个子集',
          level: 2,
          metadata: {
            docId: 'doc-1',
            filename: 'test.txt',
            source: '/test/test.txt',
            charCount: 50,
            indexedAt: new Date().toISOString(),
            path: ['人工智能', '机器学习']
          }
        }
      ]

      documentStore.addChunks(testChunks)
      bm25Engine.buildIndex(testChunks)
    })

    it('should build BM25 index', () => {
      expect(bm25Engine.docCount).toBe(2)
    })

    it('should search with BM25', () => {
      const results = bm25Engine.search('人工智能', 3)
      expect(results.length).toBeGreaterThan(0)
      console.log('BM25 search: ' + results.length + ' results')
    })
  })

  describe('4. RRF Fusion', () => {
    it('should fuse results', () => {
      const mockChunk: Chunk = {
        id: 'test-chunk',
        content: 'Test content',
        level: 1,
        metadata: {
          docId: 'doc-1',
          filename: 'test.txt',
          source: '/test.txt',
          charCount: 12,
          indexedAt: new Date().toISOString(),
          path: []
        }
      }

      const rrfInput = [
        { chunk: { ...mockChunk, id: 'chunk-1', score: 0.9 }, rank: 1, source: 'vector' as const },
        { chunk: { ...mockChunk, id: 'chunk-2', score: 0.8 }, rank: 2, source: 'vector' as const },
      ]

      const fused = reciprocalRankFusion(rrfInput, 60)
      expect(fused.length).toBe(2)
    })
  })

  describe('5. Document Store', () => {
    let store: DocumentStore

    beforeEach(() => {
      store = new DocumentStore()
      store.init(tempDir)
    })

    it('should store and retrieve chunks', () => {
      const chunk: Chunk = {
        id: 'test-001',
        content: 'Test content',
        level: 1,
        metadata: {
          docId: 'doc-1',
          filename: 'test.txt',
          source: '/test.txt',
          charCount: 12,
          indexedAt: new Date().toISOString(),
          path: []
        }
      }

      store.addChunks([chunk])
      const retrieved = store.getChunk('test-001')
      expect(retrieved?.content).toBe('Test content')
    })
  })

  describe('6. Integration Tests', () => {
    it('should index MindLane file', async () => {
      const integrationTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-int-test-'))

      const documentStore = new DocumentStore()
      documentStore.init(integrationTempDir)
      const bm25Engine = new BM25SearchEngine()
      bm25Engine.init(integrationTempDir)

      const mockVectorStore = {
        addDocuments: async () => {},
        similaritySearch: async () => [],
        save: async () => {},
      } as unknown as VectorStoreManager

      const indexer = new DocumentIndexer(mockVectorStore, documentStore, bm25Engine)
      indexer.init(integrationTempDir)

      const meta = await indexer.index(MINDLANE_FILE, loadDocument)
      expect(meta.filename).toBe('123123.mindlane')
      expect(meta.chunkCount).toBeGreaterThan(0)
      console.log('MindLane indexed: ' + meta.chunkCount + ' chunks')

      fs.rmSync(integrationTempDir, { recursive: true, force: true })
    }, 30000)

    it('should index Markdown file', async () => {
      const integrationTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-int-test-'))

      const documentStore = new DocumentStore()
      documentStore.init(integrationTempDir)
      const bm25Engine = new BM25SearchEngine()
      bm25Engine.init(integrationTempDir)

      const mockVectorStore = {
        addDocuments: async () => {},
        similaritySearch: async () => [],
        save: async () => {},
      } as unknown as VectorStoreManager

      const indexer = new DocumentIndexer(mockVectorStore, documentStore, bm25Engine)
      indexer.init(integrationTempDir)

      const meta = await indexer.index(MARKDOWN_FILE, loadDocument)
      expect(meta.filename).toBe('面试.md')
      expect(meta.chunkCount).toBeGreaterThan(0)
      console.log('Markdown indexed: ' + meta.chunkCount + ' chunks')

      fs.rmSync(integrationTempDir, { recursive: true, force: true })
    }, 30000)

    it('should remove indexed document', async () => {
      const integrationTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-int-test-'))

      const documentStore = new DocumentStore()
      documentStore.init(integrationTempDir)
      const bm25Engine = new BM25SearchEngine()
      bm25Engine.init(integrationTempDir)

      const mockVectorStore = {
        addDocuments: async () => {},
        similaritySearch: async () => [],
        save: async () => {},
      } as unknown as VectorStoreManager

      const indexer = new DocumentIndexer(mockVectorStore, documentStore, bm25Engine)
      indexer.init(integrationTempDir)

      const meta = await indexer.index(MARKDOWN_FILE, loadDocument)
      const removed = await indexer.remove(meta.id)
      expect(removed).toBe(true)

      fs.rmSync(integrationTempDir, { recursive: true, force: true })
    }, 30000)
  })
})
