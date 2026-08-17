import { describe, it, expect } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import { createEmptyFile, type MindLaneFile } from '../../fileFormat'
import {
  serializeMindlaneFile,
  serializeTreeFragment,
  serializeMindmapSection,
} from '../serializer'
import { deserializeMindlaneFile, parseXmlFragment } from '../deserializer'

function makeNodes(...specs: Array<{ id: string; type: string; label?: string }>): Node[] {
  return specs.map((s) => ({
    id: s.id,
    type: s.type,
    position: { x: 100, y: 200 },
    data: { label: s.label ?? '' },
  }))
}

describe('serializeMindlaneFile', () => {
  it('produces a single-root document with all four sections', () => {
    const file = createEmptyFile('测试标题')
    const xml = serializeMindlaneFile(file)

    expect(xml.startsWith('<mindlane version="1.0">')).toBe(true)
    expect(xml.endsWith('</mindlane>')).toBe(true)
    expect(xml).toContain('<metadata>')
    expect(xml).toContain('<mindmap>')
    expect(xml).toContain('<assets />')
    expect(xml).toContain('<documents />')
    expect(xml).toContain('<node id="root" type="text" content="中心主题" />')
    // 版本号只放根元素
    expect(xml.match(/version=/g)).toHaveLength(1)
  })

  it('does not serialize positions, edges or layout products', () => {
    const file = createEmptyFile('测试')
    file.mindmap.nodes[0]!.position = { x: 42, y: 43 }
    ;(file.mindmap.nodes[0]!.data as Record<string, unknown>).depth = 5
    ;(file.mindmap.nodes[0]!.data as Record<string, unknown>).branchIndex = 3
    ;(file.mindmap.nodes[0]!.data as Record<string, unknown>).side = 'right'
    file.mindmap.edges = [{ id: 'e1', source: 'root', target: 'ghost', type: 'mindmap' }]
    const xml = serializeMindlaneFile(file)

    expect(xml).not.toContain('position')
    expect(xml).not.toMatch(/x="42"|y="43"/)
    expect(xml).not.toContain('depth')
    expect(xml).not.toContain('branchIndex')
    expect(xml).not.toContain('side')
    expect(xml).not.toContain('"e1"')
  })

  it('escapes special characters in content and title', () => {
    const file = createEmptyFile('标题 & "引号"')
    file.metadata.title = 'a < b > c & "d" \'e\''
    ;(file.mindmap.nodes[0]!.data as { label: string }).label = 'x < y & z "q"'
    const xml = serializeMindlaneFile(file)
    expect(xml).toContain('a &lt; b &gt; c &amp; &quot;d&quot; &apos;e&apos;')
    expect(xml).toContain('x &lt; y &amp; z &quot;q&quot;')
  })

  it('serializes assets and documents sections', () => {
    const file = createEmptyFile('测试')
    file.assets = [{ id: 'a1', mime: 'image/png', sha256: 'deadbeef', data: 'iVBORw0KGgo=' }]
    file.documents = [
      {
        id: 'd1',
        type: 'pdf',
        source: '/tmp/a.pdf',
        filename: 'a.pdf',
        importedAt: '2026-08-07T03:31:41.477Z',
        pageCount: 3,
        sha256: 'abc',
      },
    ]
    const xml = serializeMindlaneFile(file)
    expect(xml).toContain('<asset id="a1" mime="image/png" sha256="deadbeef">iVBORw0KGgo=</asset>')
    expect(xml).toContain('<document id="d1" type="pdf"')
    expect(xml).toContain('pageCount="3"')
  })

  it('roundtrips through deserializeMindlaneFile byte-identically', async () => {
    const file = createEmptyFile('产品规划')
    const nodes = makeNodes(
      { id: 'root', type: 'text', label: '中心主题' },
      { id: 'a1', type: 'text', label: '分支A' },
      { id: 'a2', type: 'text', label: '子节点 & 特殊 <字符>' },
      { id: 'b1', type: 'text', label: '分支B' },
    )
    const edges: Edge[] = [
      { id: 'e-r-a1', source: 'root', target: 'a1', type: 'mindmap' },
      { id: 'e-a1-a2', source: 'a1', target: 'a2', type: 'mindmap' },
      { id: 'e-r-b1', source: 'root', target: 'b1', type: 'mindmap' },
    ]
    ;(nodes[1]!.data as Record<string, unknown>).collapsed = true
    file.mindmap.nodes = nodes as MindLaneFile['mindmap']['nodes']
    file.mindmap.edges = edges
    file.mindmap.viewport = { x: 12, y: -3, zoom: 0.7 }
    file.mindmap.style = {
      structureType: 'mindmap',
      visualVariant: 'minimal',
      colorScheme: 'ocean',
    }
    file.assets = [{ id: 'img1', mime: 'image/jpeg', sha256: 'h1', data: 'QUJD' }]
    file.documents = [
      {
        id: 'doc1',
        type: 'markdown',
        source: '/tmp/x.md',
        filename: 'x.md',
        importedAt: '2026-01-01T00:00:00.000Z',
      },
    ]

    const xml1 = serializeMindlaneFile(file)
    const parsed = await deserializeMindlaneFile(xml1)

    expect(parsed.metadata).toEqual(file.metadata)
    expect(parsed.mindmap.viewport).toEqual(file.mindmap.viewport)
    expect(parsed.mindmap.style).toEqual(file.mindmap.style)
    expect(parsed.assets).toEqual(file.assets)
    expect(parsed.documents).toEqual(file.documents)

    // 结构 roundtrip：标签/嵌套/collapsed/转义
    const labels = new Map(
      parsed.mindmap.nodes.map((n) => [n.id, (n.data as { label: string }).label]),
    )
    expect(labels.get('root')).toBe('中心主题')
    expect(labels.get('a2')).toBe('子节点 & 特殊 <字符>')
    expect(
      (parsed.mindmap.nodes.find((n) => n.id === 'a1')!.data as { collapsed?: boolean }).collapsed,
    ).toBe(true)

    // 同一输入 → 同一输出（确定性）
    const parsedBack = await deserializeMindlaneFile(xml1)
    expect(serializeMindlaneFile(parsedBack)).toBe(xml1)
  })

  it('serializes palace nodes with stations and asset reference', async () => {
    const file = createEmptyFile('测试')
    file.mindmap.nodes = [
      {
        id: 'root',
        type: 'text',
        position: { x: 0, y: 0 },
        data: { label: 'root' },
      },
      {
        id: 'p1',
        type: 'palace',
        position: { x: 0, y: 0 },
        data: {
          label: '宫殿',
          assetId: 'a1',
          imageUrl: '',
          sourceNodeIds: ['root'],
          stations: [
            {
              order: 1,
              content: '第一站',
              anchorVisual: '灯塔',
              x: 10,
              y: 20,
              linkedNodeId: 'root',
            },
          ],
        },
      },
    ]
    file.mindmap.edges = [{ id: 'e-r-p1', source: 'root', target: 'p1', type: 'mindmap' }]
    const xml = serializeMindlaneFile(file)
    expect(xml).toContain(
      '<node id="p1" type="palace" content="宫殿" asset="a1" sourceNodeIds="root">',
    )
    expect(xml).toContain(
      '<station order="1" x="10" y="20" linkedNodeId="root" anchorVisual="灯塔">第一站</station>',
    )
    expect(xml).not.toContain('imageUrl')
  })

  it('serializes image nodes with asset ref and no src/imageUrl', async () => {
    const file = createEmptyFile('测试')
    file.mindmap.nodes = [
      { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: { label: 'root' } },
      {
        id: 'i1',
        type: 'image',
        position: { x: 0, y: 0 },
        data: { assetId: 'a1', alt: '架构图', width: 400, height: 300 },
      },
    ]
    file.mindmap.edges = [{ id: 'e-r-i1', source: 'root', target: 'i1', type: 'mindmap' }]
    const xml = serializeMindlaneFile(file)
    expect(xml).toContain(
      '<node id="i1" type="image" asset="a1" alt="架构图" width="400" height="300" />',
    )
    expect(xml).not.toContain('src=')
    expect(xml).not.toContain('imageUrl')
  })
})

describe('serializeTreeFragment', () => {
  it('serializes a subtree fragment with nested nodes', () => {
    const nodes = makeNodes(
      { id: 'n1', type: 'text', label: 'a' },
      { id: 'n2', type: 'text', label: 'b' },
      { id: 'n3', type: 'text', label: 'c' },
    )
    const edges: Edge[] = [
      { id: 'e1', source: 'n1', target: 'n2', type: 'mindmap' },
      { id: 'e2', source: 'n2', target: 'n3', type: 'mindmap' },
    ]
    const xml = serializeTreeFragment(nodes, edges)
    expect(xml).toBe(
      '<node id="n1" type="text" content="a">\n  <node id="n2" type="text" content="b">\n    <node id="n3" type="text" content="c" />\n  </node>\n</node>',
    )
  })

  it('serializes multi-root fragments', () => {
    const nodes = makeNodes(
      { id: 'n1', type: 'text', label: 'a' },
      { id: 'n2', type: 'text', label: 'b' },
    )
    const xml = serializeTreeFragment(nodes, [])
    expect(xml.split('\n')).toHaveLength(2)
  })

  it('roundtrips through parseXmlFragment (fragment invariant)', async () => {
    const nodes = makeNodes(
      { id: 'n1', type: 'text', label: 'root & <x>' },
      { id: 'n2', type: 'text', label: 'child' },
      { id: 'n3', type: 'text', label: 'leaf' },
    )
    ;(nodes[1]!.data as Record<string, unknown>).collapsed = true
    const edges: Edge[] = [
      { id: 'e1', source: 'n1', target: 'n2', type: 'mindmap' },
      { id: 'e2', source: 'n2', target: 'n3', type: 'mindmap' },
    ]
    const xml = serializeTreeFragment(nodes, edges)
    const parsed = await parseXmlFragment(xml)
    expect(parsed.nodes).toHaveLength(3)
    expect(parsed.edges).toHaveLength(2)
    expect((parsed.nodes[1]!.data as { collapsed?: boolean }).collapsed).toBe(true)
    expect((parsed.nodes[0]!.data as { label: string }).label).toBe('root & <x>')
  })
})

describe('serializeMindmapSection', () => {
  const nodes = makeNodes(
    { id: 'root', type: 'text', label: '中心' },
    { id: 'n1', type: 'text', label: '技术' },
    { id: 'n2', type: 'text', label: '设计' },
    { id: 'n3', type: 'text', label: '前端框架' },
  )
  const edges: Edge[] = [
    { id: 'e1', source: 'root', target: 'n1', type: 'mindmap' },
    { id: 'e2', source: 'root', target: 'n2', type: 'mindmap' },
    { id: 'e3', source: 'n1', target: 'n3', type: 'mindmap' },
  ]

  it('serializes the whole tree', () => {
    const xml = serializeMindmapSection(nodes, edges)
    expect(xml).toContain('id="root"')
    expect(xml).toContain('id="n3"')
  })

  it('filters by subtree', () => {
    const xml = serializeMindmapSection(nodes, edges, { subtreeId: 'n1' })
    expect(xml).toContain('id="n1"')
    expect(xml).toContain('id="n3"')
    expect(xml).not.toContain('id="n2"')
  })

  it('filters by type', () => {
    const xml = serializeMindmapSection(nodes, edges, { type: 'text' })
    expect(xml).toContain('id="root"')
  })

  it('filters by textContains', () => {
    const xml = serializeMindmapSection(nodes, edges, { textContains: '前端' })
    expect(xml).toContain('id="n3"')
    expect(xml).not.toContain('id="n2"')
  })

  it('truncates by maxDepth', () => {
    const xml = serializeMindmapSection(nodes, edges, { maxDepth: 1 })
    expect(xml).toContain('id="root"')
    expect(xml).toContain('id="n1"')
    expect(xml).not.toContain('id="n3"')
  })
})
