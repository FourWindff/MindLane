import { describe, expect, it } from 'vitest'
import {
  extractYaml,
  sanitizeTreeCandidate,
  normalizeTree,
  serializeMindmapOutline,
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

  it('parses markdown bullet outline when the model returns a rendered list source', () => {
    const text = `
项目交付复盘
- 目标管理
  - 明确验收标准
  - 拆分阶段里程碑
- 风险控制
  - 识别外部依赖
  - 预留回滚方案
- node: Main Topic
  - node: Subtopic A
    - child: Item 1
    - child: Item 2
`
    const result = extractYaml(text)

    expect(result).toMatchObject({
      label: '项目交付复盘',
      children: [
        {
          label: '目标管理',
          children: [{ label: '明确验收标准' }, { label: '拆分阶段里程碑' }],
        },
        {
          label: '风险控制',
          children: [{ label: '识别外部依赖' }, { label: '预留回滚方案' }],
        },
        {
          label: 'Main Topic',
          children: [
            {
              label: 'Subtopic A',
              children: [{ label: 'Item 1' }, { label: 'Item 2' }],
            },
          ],
        },
      ],
    })
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
    const outline = { 人工智能: ['机器学习', '深度学习'] }
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
      人工智能: [{ 机器学习: ['监督学习', '无监督学习'] }],
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
      children: [{ label: '  ML  ', page_range: 'p1-3', children: [] }],
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
