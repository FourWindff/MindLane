import { describe, it, expect } from 'vitest'
import { parseXmlFragment, deserializeMindlaneFile } from '../deserializer'
import { MindmapXmlError } from '../types'

describe('parseXmlFragment', () => {
  it('parses nested nodes with minted ids and derived edges', async () => {
    const result = await parseXmlFragment(
      `<node type="text" content="中心主题">
         <node type="text" content="分支A" />
         <node type="text" content="分支B" collapsed="true">
           <node type="text" content="叶子" />
         </node>
       </node>`,
    )

    expect(result.rootIds).toHaveLength(1)
    expect(result.nodes).toHaveLength(4)
    expect(result.edges).toHaveLength(3)

    const root = result.nodes[0]!
    expect(root.type).toBe('text')
    expect((root.data as { label: string }).label).toBe('中心主题')
    expect(result.nodes[0]!.id).toMatch(/^[A-Za-z0-9_-]{8}$/)

    // 边由嵌套派生
    const labels = new Map(result.nodes.map((n) => [n.id, (n.data as { label: string }).label]))
    const childrenOf = new Map<string, string[]>()
    for (const e of result.edges) {
      const list = childrenOf.get(e.source) ?? []
      list.push(e.target)
      childrenOf.set(e.source, list)
    }
    const rootChildren = (childrenOf.get(result.nodes[0]!.id) ?? []).map((id) => labels.get(id))
    expect(rootChildren).toEqual(['分支A', '分支B'])

    // collapsed 保留
    const branchB = result.nodes.find((n) => (n.data as { label: string }).label === '分支B')!
    expect((branchB.data as { collapsed?: boolean }).collapsed).toBe(true)
  })

  it('mints ids only when missing, keeps provided ids', async () => {
    const result = await parseXmlFragment(
      `<node id="n1" type="text" content="a"><node type="text" content="b" /></node>`,
    )
    expect(result.nodes[0]!.id).toBe('n1')
    expect(result.nodes[1]!.id).toMatch(/^[A-Za-z0-9_-]{8}$/)
  })

  it('supports multi-root fragments (batch insert)', async () => {
    const result = await parseXmlFragment(
      `<node type="text" content="A" /><node type="text" content="B" />`,
    )
    expect(result.rootIds).toHaveLength(2)
    expect(result.nodes).toHaveLength(2)
    expect(result.edges).toHaveLength(0)
  })

  it('parses image nodes with asset reference', async () => {
    const result = await parseXmlFragment(
      `<node type="image" asset="a1" alt="架构图" width="400" height="300" />`,
    )
    const node = result.nodes[0]!
    expect(node.type).toBe('image')
    expect((node.data as { assetId: string }).assetId).toBe('a1')
    expect((node.data as { width?: number }).width).toBe(400)
    expect((node.data as { height?: number }).height).toBe(300)
  })

  it('parses palace nodes with stations', async () => {
    const result = await parseXmlFragment(
      `<node type="palace" content="宫殿" asset="a1" sourceNodeIds="n1,n2">
         <station order="1" x="10" y="20" linkedNodeId="n1" anchorVisual="灯塔">记忆内容</station>
       </node>`,
    )
    const data = result.nodes[0]!.data as {
      label: string
      assetId: string
      sourceNodeIds: string[]
      stations: Array<{ order: number; content: string; linkedNodeId: string }>
    }
    expect(data.label).toBe('宫殿')
    expect(data.assetId).toBe('a1')
    expect(data.sourceNodeIds).toEqual(['n1', 'n2'])
    expect(data.stations).toHaveLength(1)
    expect(data.stations[0]).toMatchObject({ order: 1, content: '记忆内容', linkedNodeId: 'n1' })
  })

  describe('error mapping (no bare throws)', () => {
    it('empty input → empty_xml', async () => {
      await expect(parseXmlFragment('   ')).rejects.toMatchObject({ code: 'empty_xml' })
    })

    it('no <node> elements → empty_xml', async () => {
      await expect(parseXmlFragment('<foo>bar</foo>')).rejects.toMatchObject({ code: 'empty_xml' })
    })

    it('missing type → invalid_type', async () => {
      await expect(parseXmlFragment('<node content="x" />')).rejects.toMatchObject({
        code: 'invalid_type',
      })
    })

    it('unknown type → invalid_type', async () => {
      await expect(parseXmlFragment('<node type="video" content="x" />')).rejects.toMatchObject({
        code: 'invalid_type',
      })
    })

    it('unescaped < in attribute → text_unescaped', async () => {
      await expect(parseXmlFragment('<node type="text" content="a<b" />')).rejects.toMatchObject({
        code: 'text_unescaped',
      })
    })

    it('duplicate id → tree_invalid', async () => {
      await expect(
        parseXmlFragment(
          `<node id="x" type="text" content="a" /><node id="x" type="text" content="b" />`,
        ),
      ).rejects.toMatchObject({ code: 'tree_invalid' })
    })

    it('id=root in fragment → tree_invalid', async () => {
      await expect(
        parseXmlFragment(`<node id="root" type="text" content="x" />`),
      ).rejects.toMatchObject({ code: 'tree_invalid' })
    })

    it('image without asset → asset_not_found', async () => {
      await expect(parseXmlFragment(`<node type="image" />`)).rejects.toMatchObject({
        code: 'asset_not_found',
      })
    })

    it('malformed xml (unclosed tag) → xml_parse_error', async () => {
      await expect(parseXmlFragment('<node type="text" content="a"><node>')).rejects.toMatchObject({
        code: 'xml_parse_error',
      })
    })
  })
})

describe('deserializeMindlaneFile', () => {
  const fullXml = `<mindlane version="1.0">
  <metadata>
    <fileUuid>bb29af86-1ae4-4e53-ac4a-9d23113b123e</fileUuid>
    <title>产品规划</title>
    <createdAt>2026-08-07T03:31:41.477Z</createdAt>
    <updatedAt>2026-08-16T15:08:22.553Z</updatedAt>
    <viewport x="10" y="-5" zoom="0.8" />
    <style structureType="mindmap" visualVariant="card" colorScheme="rainbow" />
  </metadata>
  <mindmap>
    <node id="root" type="text" content="中心主题">
      <node id="aherncoskp" type="text" content="父节点" collapsed="true">
        <node id="eu_sdpop" type="text" content="子节点1" />
      </node>
      <node id="123asd23" type="image" asset="a1" alt="架构图" width="400" height="300" />
    </node>
  </mindmap>
  <assets>
    <asset id="a1" mime="image/png" sha256="d2c…">iVBORw0KGgo=</asset>
  </assets>
  <documents>
    <document id="d1" type="pdf" source="/tmp/a.pdf" filename="指南.pdf" importedAt="2026-08-07T03:31:41.477Z" pageCount="3" sha256="abc" />
  </documents>
</mindlane>`

  it('parses all four sections', async () => {
    const file = await deserializeMindlaneFile(fullXml)

    expect(file.version).toBe('1.0')
    expect(file.metadata).toMatchObject({
      fileUuid: 'bb29af86-1ae4-4e53-ac4a-9d23113b123e',
      title: '产品规划',
      createdAt: '2026-08-07T03:31:41.477Z',
    })
    expect(file.mindmap.viewport).toEqual({ x: 10, y: -5, zoom: 0.8 })
    expect(file.mindmap.style).toEqual({
      structureType: 'mindmap',
      visualVariant: 'card',
      colorScheme: 'rainbow',
    })
    expect(file.mindmap.nodes).toHaveLength(4)
    expect(file.mindmap.edges).toHaveLength(3)
    expect(file.mindmap.nodes[0]!.id).toBe('root')
    expect(file.assets).toEqual([
      { id: 'a1', mime: 'image/png', sha256: 'd2c…', data: 'iVBORw0KGgo=' },
    ])
    expect(file.documents).toHaveLength(1)
    expect(file.documents[0]).toMatchObject({ id: 'd1', type: 'pdf', pageCount: 3 })
  })

  it('positions are not persisted (all zero, layout recomputes)', async () => {
    const file = await deserializeMindlaneFile(fullXml)
    for (const node of file.mindmap.nodes) {
      expect(node.position).toEqual({ x: 0, y: 0 })
    }
  })

  it('rejects non-mindlane root', async () => {
    await expect(deserializeMindlaneFile('<foo />')).rejects.toMatchObject({
      code: 'xml_parse_error',
    })
  })

  it('rejects wrong version', async () => {
    await expect(
      deserializeMindlaneFile('<mindlane version="2.0"><mindmap /></mindlane>'),
    ).rejects.toMatchObject({ code: 'xml_parse_error' })
  })

  it('rejects multi-root mindmap', async () => {
    await expect(
      deserializeMindlaneFile(
        `<mindlane version="1.0"><mindmap><node id="root" type="text" content="a" /><node id="b" type="text" content="c" /></mindmap></mindlane>`,
      ),
    ).rejects.toMatchObject({ code: 'tree_invalid' })
  })

  it('rejects non-root root id', async () => {
    await expect(
      deserializeMindlaneFile(
        `<mindlane version="1.0"><mindmap><node id="x" type="text" content="a" /></mindmap></mindlane>`,
      ),
    ).rejects.toMatchObject({ code: 'tree_invalid' })
  })

  it('maps malformed xml to xml_parse_error', async () => {
    await expect(
      deserializeMindlaneFile('<mindlane version="1.0"><metadata></mindlane>'),
    ).rejects.toMatchObject({ code: 'xml_parse_error' })
  })

  it('exposes MindmapXmlError with code', async () => {
    try {
      await parseXmlFragment('')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(MindmapXmlError)
      expect((err as MindmapXmlError).code).toBe('empty_xml')
    }
  })
})
