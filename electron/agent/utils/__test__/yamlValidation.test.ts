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

  it('accepts project outline tree with key-value leaves', () => {
    const result = validateMindmapYaml(`项目计划:
  - 基本信息:
    - 项目名称: 智能笔记助手
    - 版本: 1.0
    - 负责人: 产品小组
    - 联系方式:
      - 邮箱: team@example.com
      - 群组: alpha-review
    - 目标: 提升资料整理效率
  - 里程碑:
    - 调研: 完成用户访谈
    - 原型: 输出交互稿
    - 开发: 完成核心功能
    - 验收:
      - 导入文档
      - 生成大纲
      - 批量添加节点
      - 导出结果
`, { mode: 'tree' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tree.label).toBe('项目计划')
      expect(result.tree.children?.map((node) => node.label)).toEqual(['基本信息', '里程碑'])
      expect(result.tree.children?.[0]?.children?.map((node) => node.label)).toContain('项目名称: 智能笔记助手')
      expect(result.tree.children?.[0]?.children?.find((node) => node.label === '联系方式')?.children?.map((node) => node.label))
        .toEqual(['邮箱: team@example.com', '群组: alpha-review'])
      expect(result.tree.children?.[1]?.children?.find((node) => node.label === '验收')?.children).toHaveLength(4)
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

  it('accepts task outline fragment with multiple key-value roots', () => {
    const result = validateMindmapYaml(`- 模块: 导入器
- 优先级: 高
- 状态: 待开发
- 验收标准:
  - 支持 Markdown
  - 支持 PDF
  - 保留层级
  - 返回错误提示
`, { mode: 'fragment' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tree.label).toBe('片段')
      expect(result.tree.children?.map((node) => node.label)).toEqual([
        '模块: 导入器',
        '优先级: 高',
        '状态: 待开发',
        '验收标准',
      ])
      expect(result.tree.children?.[3]?.children).toHaveLength(4)
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
