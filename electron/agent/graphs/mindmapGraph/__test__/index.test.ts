import { describe, it, expect, vi } from 'vitest'
import { buildMindmapSubgraph } from '../index.js'
import type { LLMProvider } from '../../../providers/index.js'
import { extractYaml, sanitizeTreeCandidate, normalizeTree } from '../../../utils/yamlMindmap.js'
import type { MindmapYamlNode } from '../../../utils/yamlMindmap.js'

describe('MindmapGraph error with stack', () => {
  it('includes stack trace in state.error when generation fails', async () => {
    const mockProvider = {
      reasoningModel: {
        invoke: vi.fn().mockRejectedValue(new Error('LLM timeout')),
      },
    } as unknown as LLMProvider

    const graph = buildMindmapSubgraph({ provider: mockProvider })
    const app = graph.compile()

    const result = await app.invoke({
      messages: [],
      context: null,
      intent: 'mindmap',
      response: '',
      error: '',
      mindmapInputText: 'some document text',
      mindmapInputTitle: '',
      mindmapNodes: [],
      mindmapEdges: [],
      mindmapTitle: '',
    })

    expect(result.error).toContain('LLM timeout')
    expect(result.error).toContain('at') // stack trace
  })
})

describe('mindmapGraph YAML parsing', () => {
  it('parses outline-format YAML into structured tree', () => {
    const yaml = `
人工智能导论:
  - 机器学习:
    - 监督学习
    - 无监督学习
  - 深度学习:
    - 神经网络
    - 反向传播
`
    const parsed = extractYaml(yaml)
    const tree = sanitizeTreeCandidate(parsed)

    expect(tree).toMatchObject({
      label: '人工智能导论',
      children: expect.any(Array),
    })
    expect((tree as MindmapYamlNode).children).toHaveLength(2)
    expect((tree as MindmapYamlNode).children![0]!.label).toBe('机器学习')
    expect((tree as MindmapYamlNode).children![0]!.children).toHaveLength(2)
  })

  it('parses structured-format YAML', () => {
    const yaml = `
label: 人工智能导论
children:
  - label: 机器学习
    children:
      - label: 监督学习
      - label: 无监督学习
`
    const parsed = extractYaml(yaml)
    const tree = sanitizeTreeCandidate(parsed)

    expect(tree).toMatchObject({
      label: '人工智能导论',
      children: expect.any(Array),
    })
    expect((tree as MindmapYamlNode).children).toHaveLength(1)
  })

  it('handles deeply nested outline format', () => {
    const yaml = `
Root:
  - A:
    - A1:
      - A1a
      - A1b
    - A2
  - B:
    - B1
`
    const parsed = extractYaml(yaml)
    const tree = sanitizeTreeCandidate(parsed) as MindmapYamlNode

    expect(tree.label).toBe('Root')
    expect(tree.children).toHaveLength(2)
    expect(tree.children![0]!.children).toHaveLength(2)
    expect(tree.children![0]!.children![0]!.children).toHaveLength(2)
  })

  it('handles single node without children', () => {
    const yaml = 'Simple Topic:'
    const parsed = extractYaml(yaml)
    const tree = sanitizeTreeCandidate(parsed) as MindmapYamlNode

    expect(tree.label).toBe('Simple Topic')
    expect(tree.children).toEqual([])
  })

  it('normalizes tree with empty page_range and summary', () => {
    const raw: MindmapYamlNode = {
      label: '  Test  ',
      page_range: '',
      children: [
        { label: 'Child', page_range: '', children: [] },
      ],
    }
    const normalized = normalizeTree(raw, '')
    expect(normalized.label).toBe('Test')
    expect(normalized.page_range).toBe('')
  })
})
