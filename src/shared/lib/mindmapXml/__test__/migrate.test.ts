import { describe, it, expect } from 'vitest'
import { migrateJsonFileToXml } from '../migrate'
import { deserializeMindlaneFile } from '../deserializer'
import { serializeMindlaneFile } from '../serializer'
import type { MindLaneFile } from '../../fileFormat'

function legacyJsonFile(overrides: Partial<MindLaneFile> = {}): MindLaneFile {
  return {
    version: '1.0',
    metadata: {
      fileUuid: 'bb29af86-1ae4-4e53-ac4a-9d23113b123e',
      title: '产品规划',
      createdAt: '2026-08-07T03:31:41.477Z',
      updatedAt: '2026-08-16T15:08:22.553Z',
    },
    mindmap: {
      nodes: [
        { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: { label: '中心' } },
        { id: 'n1', type: 'text', position: { x: 1, y: 2 }, data: { label: '分支' } },
        { id: 'n2', type: 'text', position: { x: 3, y: 4 }, data: { label: '叶子' } },
      ],
      edges: [
        { id: 'e1', source: 'root', target: 'n1' },
        { id: 'e2', source: 'n1', target: 'n2' },
      ],
      viewport: { x: 10, y: 20, zoom: 0.5 },
      style: { structureType: 'mindmap', visualVariant: 'card', colorScheme: 'rainbow' },
    },
    assets: [],
    documents: [
      {
        id: 'd1',
        type: 'pdf',
        source: '/tmp/a.pdf',
        filename: 'a.pdf',
        importedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  }
}

describe('migrateJsonFileToXml', () => {
  it('is deterministic: same input → same output', async () => {
    const file = legacyJsonFile()
    const a = await migrateJsonFileToXml(file)
    const b = await migrateJsonFileToXml(file)
    expect(a.xml).toBe(b.xml)
  })

  it('moves metadata / viewport / style / documents intact', async () => {
    const { xml } = await migrateJsonFileToXml(legacyJsonFile())
    const parsed = await deserializeMindlaneFile(xml)

    expect(parsed.metadata).toEqual({
      fileUuid: 'bb29af86-1ae4-4e53-ac4a-9d23113b123e',
      title: '产品规划',
      createdAt: '2026-08-07T03:31:41.477Z',
      updatedAt: '2026-08-16T15:08:22.553Z',
    })
    expect(parsed.mindmap.viewport).toEqual({ x: 10, y: 20, zoom: 0.5 })
    expect(parsed.mindmap.style).toEqual({
      structureType: 'mindmap',
      visualVariant: 'card',
      colorScheme: 'rainbow',
    })
    expect(parsed.documents).toHaveLength(1)
    expect(parsed.documents[0]!.filename).toBe('a.pdf')
  })

  it('rebuilds the tree from nesting: positions dropped, edges derived', async () => {
    const { xml } = await migrateJsonFileToXml(legacyJsonFile())
    const parsed = await deserializeMindlaneFile(xml)
    expect(parsed.mindmap.nodes).toHaveLength(3)
    expect(parsed.mindmap.edges).toHaveLength(2)
    expect(parsed.mindmap.nodes[0]!.id).toBe('root')
    for (const node of parsed.mindmap.nodes) {
      expect(node.position).toEqual({ x: 0, y: 0 })
    }
  })

  it('drops non-tree edges (multi-parent) with explicit warnings', async () => {
    const file = legacyJsonFile()
    file.mindmap.edges = [
      { id: 'e1', source: 'root', target: 'n1' },
      { id: 'e2', source: 'root', target: 'n2' },
      { id: 'e3', source: 'n1', target: 'n2' }, // n2 已有父 root → 非树边
    ]
    const { xml, warnings } = await migrateJsonFileToXml(file)
    expect(warnings.some((w) => w.message.includes('丢弃非树边 e3'))).toBe(true)
    const parsed = await deserializeMindlaneFile(xml)
    expect(parsed.mindmap.edges).toHaveLength(2)
    expect(parsed.mindmap.edges.some((e) => e.id === 'e3')).toBe(false)
  })

  it('breaks cycles by dropping the closing edge with a warning', async () => {
    const file = legacyJsonFile()
    file.mindmap.nodes.push({
      id: 'n3',
      type: 'text',
      position: { x: 0, y: 0 },
      data: { label: 'N3' },
    })
    file.mindmap.edges = [
      { id: 'e0', source: 'root', target: 'n3' },
      { id: 'e1', source: 'root', target: 'n1' },
      { id: 'e2', source: 'n1', target: 'n2' },
      { id: 'e3', source: 'n2', target: 'n1' }, // 环：n1 → n2 → n1
    ]
    const { xml, warnings } = await migrateJsonFileToXml(file)
    // e3 同时是环边与多父边：先被多父检查丢弃，或由环检查丢弃，必须告警
    expect(warnings.some((w) => w.message.includes('e3'))).toBe(true)
    const parsed = await deserializeMindlaneFile(xml)
    expect(parsed.mindmap.edges).toHaveLength(3) // e0 + e1 + e2，e3 已丢弃
    expect(parsed.mindmap.edges.some((e) => e.id === 'e3')).toBe(false)
  })

  it('attaches extra roots under the main root with a warning', async () => {
    const file = legacyJsonFile()
    file.mindmap.nodes.push({
      id: 'orphan',
      type: 'text',
      position: { x: 0, y: 0 },
      data: { label: '孤点' },
    })
    // orphan 无入边 → 第二根
    const { xml, warnings } = await migrateJsonFileToXml(file)
    expect(warnings.some((w) => w.message.includes('没有父节点'))).toBe(true)
    const parsed = await deserializeMindlaneFile(xml)
    expect(parsed.mindmap.nodes).toHaveLength(4)
    expect(parsed.mindmap.edges).toHaveLength(3)
    const orphanEdge = parsed.mindmap.edges.find((e) => e.target === 'orphan')!
    expect(orphanEdge.source).toBe('root')
  })

  it('downloads URL images into assets (dedup by sha256) and removes imageUrl', async () => {
    const file = legacyJsonFile()
    file.mindmap.nodes.push({
      id: 'p1',
      type: 'palace',
      position: { x: 0, y: 0 },
      data: {
        label: '宫殿',
        imageUrl: 'https://example.com/palace.png',
        stations: [],
        sourceNodeIds: [],
      },
    })
    file.mindmap.edges.push({ id: 'e-root-p1', source: 'root', target: 'p1' })
    let downloads = 0
    const { xml, warnings } = await migrateJsonFileToXml(file, {
      downloadImage: async () => {
        downloads += 1
        return { mime: 'image/png', data: 'iVBORw0KGgo=' }
      },
    })
    expect(downloads).toBe(1)
    expect(warnings).toHaveLength(0)
    const parsed = await deserializeMindlaneFile(xml)
    expect(parsed.assets).toHaveLength(1)
    expect(parsed.assets[0]).toMatchObject({ mime: 'image/png', data: 'iVBORw0KGgo=' })
    const palace = parsed.mindmap.nodes.find((n) => n.id === 'p1')!
    expect((palace.data as { assetId?: string }).assetId).toBe(parsed.assets[0]!.id)
    expect((palace.data as { imageUrl?: string }).imageUrl).toBeUndefined()
  })

  it('keeps URL with a warning when download fails (migration-only exception)', async () => {
    const file = legacyJsonFile()
    file.mindmap.nodes.push({
      id: 'p1',
      type: 'palace',
      position: { x: 0, y: 0 },
      data: {
        label: '宫殿',
        imageUrl: 'https://example.com/gone.png',
        stations: [],
        sourceNodeIds: [],
      },
    })
    file.mindmap.edges.push({ id: 'e-root-p1', source: 'root', target: 'p1' })
    const { xml, warnings } = await migrateJsonFileToXml(file, {
      downloadImage: async () => null,
    })
    expect(warnings.some((w) => w.message.includes('保留 URL'))).toBe(true)
    const parsed = await deserializeMindlaneFile(xml)
    expect(parsed.assets).toHaveLength(0)
    const palace = parsed.mindmap.nodes.find((n) => n.id === 'p1')!
    expect((palace.data as { imageUrl?: string }).imageUrl).toBe('https://example.com/gone.png')
  })

  it('output roundtrips through the runtime deserializer', async () => {
    const file = legacyJsonFile()
    file.mindmap.nodes.push({
      id: 'p1',
      type: 'palace',
      position: { x: 0, y: 0 },
      data: {
        label: '宫殿',
        imageUrl: 'https://example.com/a.png',
        stations: [
          {
            order: 1,
            content: '第一站',
            anchorVisual: '灯塔',
            x: 1,
            y: 2,
            linkedNodeId: 'root',
          },
        ],
        sourceNodeIds: ['root'],
      },
    })
    file.mindmap.edges.push({ id: 'e-root-p1', source: 'root', target: 'p1' })
    const { xml } = await migrateJsonFileToXml(file, {
      downloadImage: async () => ({ mime: 'image/png', data: 'QUJD' }),
    })
    const parsed = await deserializeMindlaneFile(xml)
    const palace = parsed.mindmap.nodes.find((n) => n.id === 'p1')!
    expect((palace.data as { stations: Array<{ content: string }> }).stations[0]!.content).toBe(
      '第一站',
    )
    expect(serializeBackAndForth(parsed)).toBe(xml)
  })
})

function serializeBackAndForth(parsed: MindLaneFile): string {
  // 重新序列化必须与迁移输出逐字节一致（迁移与运行时共用同一 writer）
  return serializeMindlaneFile(parsed)
}
