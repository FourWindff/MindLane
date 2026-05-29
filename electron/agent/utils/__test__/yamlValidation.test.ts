import { describe, expect, it } from 'vitest'
import { validateMindmapYaml } from '../yamlValidation.js'

describe('validateMindmapYaml', () => {
  it('returns yaml parser error reason for invalid syntax', () => {
    const result = validateMindmapYaml('mindmap: ":\n  - "unclosed', { mode: 'tree' })

    expect(result).toMatchObject({
      ok: false,
      reason: 'Unexpected scalar at node end',
    })
  })

  it('returns yaml parser error reason for duplicate keys', () => {
    const result = validateMindmapYaml(`Root:
  Same: []
  Same: []
`, { mode: 'tree' })

    expect(result).toMatchObject({
      ok: false,
      reason: 'Map keys must be unique',
    })
  })

  it('accepts valid outline tree', () => {
    const result = validateMindmapYaml(`Root:
  - Child A
  - Child B
`, { mode: 'tree' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tree.label).toBe('Root')
      expect(result.tree.children).toHaveLength(2)
    }
  })

  it('rejects tree without children', () => {
    const result = validateMindmapYaml('Root:', { mode: 'tree' })

    expect(result).toMatchObject({
      ok: false,
      reason: 'YAML 根节点必须包含至少一个子节点',
    })
  })

  it('rejects empty fragment', () => {
    const result = validateMindmapYaml('', { mode: 'fragment' })

    expect(result).toMatchObject({
      ok: false,
      reason: '模型返回为空',
    })
  })

  it('accepts leaf fragment', () => {
    const result = validateMindmapYaml('- Topic', { mode: 'fragment' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tree.children).toHaveLength(1)
      expect(result.tree.children![0]!.label).toBe('Topic')
    }
  })

  it('rejects structured fragment because the frontend consumes outline fragments', () => {
    const result = validateMindmapYaml(`label: Topic
children:
  - label: Child
`, { mode: 'fragment' })

    expect(result).toMatchObject({
      ok: false,
      reason: 'YAML 片段必须包含至少一个节点',
    })
  })
})
