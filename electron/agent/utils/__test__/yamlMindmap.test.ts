import { describe, expect, it } from 'vitest'
import {
  extractYaml,
  sanitizeTreeCandidate,
  normalizeTree,
  parsePageRange,
  formatPageRange,
  serializeMindmapOutline,
  serializeMindmapForestOutline,
  responseToText,
  withRetries,
  overwriteArray,
} from '../yamlMindmap.js'

describe('extractYaml', () => {
  it('parses YAML inside code fence', () => {
    const text = '```yaml\nfoo: bar\n```'
    expect(extractYaml(text)).toEqual({ foo: 'bar' })
  })

  it('parses bare YAML', () => {
    const text = 'foo: bar'
    expect(extractYaml(text)).toEqual({ foo: 'bar' })
  })

  it('expands 1-space indent to valid YAML', () => {
    const text = 'root:\n - child\n - child2'
    const result = extractYaml(text)
    expect(result).toEqual({ root: ['child', 'child2'] })
  })

  it('throws on empty text', () => {
    expect(() => extractYaml('')).toThrow('模型返回为空')
  })

  it('throws on text that cannot be parsed as YAML', () => {
    // Use text that YAML.parse rejects and that doesn't match any heuristic
    expect(() => extractYaml('@#$%')).toThrow('无法从模型输出中提取 YAML')
  })
})

describe('sanitizeTreeCandidate', () => {
  it('converts outline format to structured tree', () => {
    const outline = { '人工智能': ['机器学习', '深度学习'] }
    const tree = sanitizeTreeCandidate(outline)
    expect(tree).toEqual({
      label: '人工智能',
      page_range: '',
      children: [
        { label: '机器学习', page_range: '', children: [] },
        { label: '深度学习', page_range: '', children: [] },
      ],
    })
  })

  it('passes through structured format', () => {
    const structured = {
      label: '人工智能',
      page_range: '1-10',
      children: [{ label: '机器学习', page_range: '', children: [] }],
    }
    expect(sanitizeTreeCandidate(structured)).toEqual(structured)
  })

  it('handles nested outline format', () => {
    const outline = {
      '人工智能': [
        { '机器学习': ['监督学习', '无监督学习'] },
      ],
    }
    const tree = sanitizeTreeCandidate(outline)
    expect(tree).toEqual({
      label: '人工智能',
      page_range: '',
      children: [
        {
          label: '机器学习',
          page_range: '',
          children: [
            { label: '监督学习', page_range: '', children: [] },
            { label: '无监督学习', page_range: '', children: [] },
          ],
        },
      ],
    })
  })
})

describe('normalizeTree', () => {
  it('trims labels and normalizes page ranges', () => {
    const tree = {
      label: '  AI  ',
      page_range: 'p5',
      children: [
        { label: '  ML  ', page_range: 'p1-3', children: [] },
      ],
    }
    const normalized = normalizeTree(tree, '1-1')
    expect(normalized.label).toBe('AI')
    expect(normalized.page_range).toBe('5-5')
    expect(normalized.children![0]!.label).toBe('ML')
    expect(normalized.children![0]!.page_range).toBe('1-3')
  })

  it('uses fallback range when page_range is empty', () => {
    const tree = { label: 'AI', page_range: '', children: [] }
    const normalized = normalizeTree(tree, '10-20')
    expect(normalized.page_range).toBe('10-20')
  })

  it('preserves summary field', () => {
    const tree = { label: 'AI', page_range: '', summary: '  summary  ', children: [] }
    const normalized = normalizeTree(tree, '')
    expect(normalized.summary).toBe('summary')
  })
})

describe('parsePageRange / formatPageRange', () => {
  it('parses single page', () => {
    expect(parsePageRange('5')).toEqual([5, 5])
  })

  it('parses page range', () => {
    expect(parsePageRange('1-10')).toEqual([1, 10])
  })

  it('returns null for invalid range', () => {
    expect(parsePageRange('invalid')).toBeNull()
  })

  it('formats page range', () => {
    expect(formatPageRange(1, 10)).toBe('1-10')
  })
})

describe('serializeMindmapOutline', () => {
  it('serializes simple tree to outline', () => {
    const tree = {
      label: '人工智能',
      page_range: '',
      children: [
        { label: '机器学习', page_range: '', children: [] },
        { label: '深度学习', page_range: '', children: [] },
      ],
    }
    const yaml = serializeMindmapOutline(tree)
    expect(yaml).toContain('人工智能:')
    expect(yaml).toContain('- 机器学习')
    expect(yaml).toContain('- 深度学习')
  })
})

describe('serializeMindmapForestOutline', () => {
  it('serializes multiple trees', () => {
    const trees = [
      { label: 'Tree1', page_range: '', children: [] },
      { label: 'Tree2', page_range: '', children: [] },
    ]
    const yaml = serializeMindmapForestOutline(trees)
    expect(yaml).toContain('- Tree1')
    expect(yaml).toContain('- Tree2')
  })
})

describe('responseToText', () => {
  it('extracts text from string content', () => {
    expect(responseToText({ content: 'hello' })).toBe('hello')
  })

  it('extracts text from array of text blocks', () => {
    expect(responseToText({ content: [{ text: 'hello ' }, { text: 'world' }] })).toBe('hello world')
  })

  it('handles plain string', () => {
    expect(responseToText('hello')).toBe('hello')
  })
})

describe('withRetries', () => {
  it('succeeds on first try', async () => {
    const result = await withRetries(() => Promise.resolve(42), 2)
    expect(result).toBe(42)
  })

  it('retries and succeeds', async () => {
    let attempts = 0
    const result = await withRetries(() => {
      attempts += 1
      if (attempts < 3) return Promise.reject(new Error('fail'))
      return Promise.resolve(42)
    }, 3)
    expect(result).toBe(42)
    expect(attempts).toBe(3)
  })

  it('throws after exhausting retries', async () => {
    await expect(withRetries(() => Promise.reject(new Error('fail')), 2)).rejects.toThrow('fail')
  })
})

describe('overwriteArray', () => {
  it('wraps value in Overwrite', () => {
    const arr = [1, 2, 3]
    const result = overwriteArray(arr)
    // Overwrite is a LangGraph sentinel — verify it carries the data
    expect((result as unknown as { __overwrite__: number[] }).__overwrite__).toEqual(arr)
  })
})
