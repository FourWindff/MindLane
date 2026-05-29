import { describe, it, expect } from 'vitest'
import {
  parseYamlToMindmap,
  parseYamlFragment,
  VIRTUAL_ROOT_SYMBOL,
  YamlParseError,
  EmptyMindmapError,
} from '../yamlMindmapParser'

describe('yamlMindmapParser', () => {
  describe('简单结构', () => {
    it('应将一个根节点和两个子节点解析为 3 节点 + 2 边', () => {
      const yaml = `mindmap:
  "中心主题":
    - "子主题 A"
    - "子主题 B"
`
      const result = parseYamlToMindmap(yaml)
      expect(result.nodes).toHaveLength(3)
      expect(result.edges).toHaveLength(2)
      expect(result.nodes[0]!.id).toBe('root')
      expect(result.nodes[0]!.type).toBe('text')
      expect((result.nodes[0]!.data as { label: string }).label).toBe('中心主题')

      const childLabels = result.nodes.slice(1).map((n) => (n.data as { label: string }).label)
      expect(childLabels).toEqual(expect.arrayContaining(['子主题 A', '子主题 B']))

      for (const edge of result.edges) {
        expect(edge.source).toBe('root')
      }
    })
  })

  describe('深层嵌套结构', () => {
    it('应正确解析 4 层嵌套', () => {
      const yaml = `mindmap:
  "Level 1":
    - "Level 2":
      - "Level 3":
        - "Level 4"
`
      const result = parseYamlToMindmap(yaml)
      expect(result.nodes).toHaveLength(4)
      expect(result.edges).toHaveLength(3)

      // 形成一条链:每个非根节点都有唯一父
      const parentMap = new Map(result.edges.map((e) => [e.target, e.source]))
      const labelOf = (id: string) =>
        (result.nodes.find((n) => n.id === id)!.data as { label: string }).label

      const level4Node = result.nodes.find((n) => (n.data as { label: string }).label === 'Level 4')!
      const level3Id = parentMap.get(level4Node.id)!
      const level2Id = parentMap.get(level3Id)!
      const level1Id = parentMap.get(level2Id)!
      expect(labelOf(level3Id)).toBe('Level 3')
      expect(labelOf(level2Id)).toBe('Level 2')
      expect(level1Id).toBe('root')
    })
  })

  describe('元数据保留', () => {
    it('应将 page_range 标记保留在节点 data 中', () => {
      const yaml = `mindmap:
  "Hello-Agents (p.1-5)":
    - "Chapter 1 (p.6-12) — 智能体导论"
`
      const result = parseYamlToMindmap(yaml)
      const root = result.nodes.find((n) => n.id === 'root')!
      const child = result.nodes.find((n) => n.id !== 'root')!

      const rootData = root.data as { label: string; pageRange?: string }
      expect(rootData.label).toBe('Hello-Agents')
      expect(rootData.pageRange).toBe('p.1-5')

      const childData = child.data as { label: string; pageRange?: string; summary?: string }
      expect(childData.label).toBe('Chapter 1')
      expect(childData.pageRange).toBe('p.6-12')
      expect(childData.summary).toBe('智能体导论')
    })
  })

  describe('节点 ID 生成', () => {
    it('根节点 id 始终为 root', () => {
      const yaml = `mindmap:
  "顶层":
    - "子节点"
`
      const result = parseYamlToMindmap(yaml)
      expect(result.nodes[0]!.id).toBe('root')
    })

    it('子节点应有唯一的 ID', () => {
      const childYamlEntries = Array.from({ length: 10 }, (_, i) => `    - "Child ${i}"`).join('\n')
      const yaml = `mindmap:\n  "Root":\n${childYamlEntries}\n`
      const result = parseYamlToMindmap(yaml)
      expect(result.nodes).toHaveLength(11)
      const ids = new Set(result.nodes.map((n) => n.id))
      expect(ids.size).toBe(11)
      const childIds = result.nodes.slice(1).map((n) => n.id)
      // 子节点 id 不应是 'root'
      for (const id of childIds) {
        expect(id).not.toBe('root')
      }
    })
  })

  describe('错误处理', () => {
    it('无效 YAML 应抛出 YamlParseError', () => {
      const invalid = 'mindmap: ":\n  - "unclosed'
      expect(() => parseYamlToMindmap(invalid)).toThrow(YamlParseError)
    })

    it('缺少 mindmap 字段应抛出 EmptyMindmapError', () => {
      const yaml = `document:\n  title: "Hi"\n`
      expect(() => parseYamlToMindmap(yaml)).toThrow(EmptyMindmapError)
    })

    it('mindmap 字段为空对象应抛出 EmptyMindmapError', () => {
      const yaml = `mindmap: {}\n`
      expect(() => parseYamlToMindmap(yaml)).toThrow(EmptyMindmapError)
    })
  })

  describe('document 标题提取', () => {
    it('如果 YAML 包含 document.title,则使用它作为 title', () => {
      const yaml = `document:
  title: "Hello-Agents"
  source_file: "/tmp/x.pdf"
mindmap:
  "中心主题":
    - "子节点"
`
      const result = parseYamlToMindmap(yaml)
      expect(result.title).toBe('Hello-Agents')
    })

    it('document.title 缺失时回退到根节点 label', () => {
      const yaml = `mindmap:
  "纯 mindmap 标题":
    - "Child"
`
      const result = parseYamlToMindmap(yaml)
      expect(result.title).toBe('纯 mindmap 标题')
    })
  })

  describe('parseYamlFragment', () => {
    it('should parse a simple fragment with one root', () => {
      const yaml = `
- "子主题 A":
  - "子主题 A1"
  - "子主题 A2"
`
      const result = parseYamlFragment(yaml)
      expect(result.nodes).toHaveLength(3)
      expect(result.edges).toHaveLength(2)
      expect(result.nodes[0]!.data.label).toBe('子主题 A')
    })

    it('should parse a fragment with multiple roots', () => {
      const yaml = `
- "主题 A"
- "主题 B":
  - "主题 B1"
`
      const result = parseYamlFragment(yaml)
      // 虚拟根 + 主题 A + 主题 B + 主题 B1 = 4 节点
      expect(result.nodes).toHaveLength(4)
      // 虚拟根→A, 虚拟根→B, B→B1 = 3 边
      expect(result.edges).toHaveLength(3)
      // 多根时创建一个虚拟根节点，用 Symbol 标记
      expect(result.nodes.some(n => (n.data as Record<symbol, boolean>)[VIRTUAL_ROOT_SYMBOL])).toBe(true)
      // rootIds 应包含两个真实根节点
      expect(result.rootIds).toHaveLength(2)
    })

    it('should parse key-value fragment entries as leaf labels', () => {
      const yaml = `
- 模块: 导入器
- 优先级: 高
- 状态: 待开发
- 验收标准:
  - 支持 Markdown
  - 支持 PDF
  - 保留层级
  - 返回错误提示
`
      const result = parseYamlFragment(yaml)

      expect(result.rootIds).toHaveLength(4)
      expect(result.nodes.some(n => (n.data as { label: string }).label === '模块: 导入器')).toBe(true)
      expect(result.nodes.some(n => (n.data as { label: string }).label === '优先级: 高')).toBe(true)
      expect(result.nodes.some(n => (n.data as { label: string }).label === '状态: 待开发')).toBe(true)
      expect(result.nodes.some(n => (n.data as { label: string }).label === '验收标准')).toBe(true)
      expect(result.nodes).toHaveLength(9)
    })

    it('should throw EmptyMindmapError for empty fragment', () => {
      expect(() => parseYamlFragment('')).toThrow(EmptyMindmapError)
    })

    it('should throw YamlParseError for invalid YAML', () => {
      expect(() => parseYamlFragment('!!! not yaml !!!')).toThrow(YamlParseError)
    })

    it('should tolerate AI-generated YAML missing colons', () => {
      // AI 经常忘记在父节点后加冒号
      const yaml = `
- "学习率的作用与选择"
  - "学习率过大：损失震荡不收敛"
  - "学习率过小：收敛速度极慢"
- "学习率调整策略"
  - "固定学习率：简单但可能非最优"
`
      const result = parseYamlFragment(yaml)
      // 虚拟根 + 2 个父节点 + 3 个子节点 = 6 节点
      expect(result.nodes).toHaveLength(6)
      // 虚拟根→父1, 虚拟根→父2, 父1→子1, 父1→子2, 父2→子3 = 5 边
      expect(result.edges).toHaveLength(5)
      expect(result.nodes.some(n => (n.data as { label: string }).label === '学习率的作用与选择')).toBe(true)
      expect(result.nodes.some(n => (n.data as { label: string }).label === '学习率过大：损失震荡不收敛')).toBe(true)
    })
  })
})
