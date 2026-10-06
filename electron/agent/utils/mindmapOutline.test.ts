import { describe, expect, it } from 'vitest'
import {
  parseOutlineXml,
  serializeOutlineXml,
  serializeStorageFragment,
  type MindmapOutlineNode,
} from './mindmapOutline.js'

const VALID_TREE_XML = `<node>Introduction to AI
  <node>Machine Learning
    <node>Supervised Learning</node>
    <node>Unsupervised Learning</node>
  </node>
  <node>Deep Learning
    <node>Neural Networks</node>
    <node>Backpropagation</node>
  </node>
</node>`

describe('parseOutlineXml', () => {
  it('parses a valid single-root tree with nested children', () => {
    const result = parseOutlineXml(VALID_TREE_XML, 'Batch 1')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tree.label).toBe('Introduction to AI')
      expect(result.tree.children.map((n) => n.label)).toEqual([
        'Machine Learning',
        'Deep Learning',
      ])
      expect(result.tree.children[0]!.children.map((n) => n.label)).toEqual([
        'Supervised Learning',
        'Unsupervised Learning',
      ])
    }
  })

  it('trims label whitespace and decodes entities', () => {
    const result = parseOutlineXml(
      `<node>  Root  \n  <node>A &amp; B</node>\n  <node>R&amp;D &lt;fast&gt;</node>\n</node>`,
      'Batch 1',
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tree.label).toBe('Root')
      expect(result.tree.children.map((n) => n.label)).toEqual(['A & B', 'R&D <fast>'])
    }
  })

  it('accepts inline nesting without indentation', () => {
    const result = parseOutlineXml(
      '<node>Root<node>A<node>A1</node></node><node>B</node></node>',
      'Batch 1',
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tree.children).toHaveLength(2)
      expect(result.tree.children[0]!.children[0]!.label).toBe('A1')
    }
  })

  it('rejects empty output with empty_xml', () => {
    const result = parseOutlineXml('   \n ', 'Batch 1')

    expect(result).toMatchObject({
      ok: false,
      reason: '[empty_xml] Model returned an empty response',
    })
  })

  it('rejects output without any <node> element with empty_xml', () => {
    const result = parseOutlineXml('just some text', 'Batch 1')

    expect(result).toMatchObject({
      ok: false,
      reason: '[empty_xml] No <node> element found in the XML fragment',
    })
  })

  it('rejects malformed XML with a positioned xml_parse_error', () => {
    const result = parseOutlineXml('<node>Root\n  <node>Child</node>', 'Batch 1')

    expect(result).toMatchObject({
      ok: false,
      reason: '[xml_parse_error] XML structure is incomplete: Tag <node> is not closed',
    })
  })

  it('rejects unescaped < in text with a positioned xml_parse_error', () => {
    const result = parseOutlineXml('<node>a < b</node>', 'Batch 1')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('[xml_parse_error]')
      expect(result.reason).toContain('position')
    }
  })

  it('rejects a root without children', () => {
    const result = parseOutlineXml('<node>Root</node>', 'Batch 1')

    expect(result).toMatchObject({
      ok: false,
      reason: '[tree_invalid] XML root node must contain at least one child node',
    })
  })

  it('rejects nodes with empty labels anywhere in the tree', () => {
    const emptyChild = parseOutlineXml('<node>Root\n  <node>   </node>\n</node>', 'Batch 1')
    const emptyRoot = parseOutlineXml('<node><node>Child</node></node>', 'Batch 1')

    expect(emptyChild).toMatchObject({
      ok: false,
      reason: '[tree_invalid] XML contains an empty node label',
    })
    expect(emptyRoot).toMatchObject({
      ok: false,
      reason: '[tree_invalid] XML contains an empty node label',
    })
  })

  it('rejects attributes on <node> as protocol violations', () => {
    const typed = parseOutlineXml('<node type="text">Root\n  <node>A</node>\n</node>', 'Batch 1')
    const withId = parseOutlineXml('<node id="n1">Root\n  <node>A</node>\n</node>', 'Batch 1')

    expect(typed).toMatchObject({
      ok: false,
      reason:
        '[tree_invalid] <node> must not carry attribute "type" (the model dialect allows zero attributes)',
    })
    expect(withId).toMatchObject({
      ok: false,
      reason:
        '[tree_invalid] <node> must not carry attribute "id" (the model dialect allows zero attributes)',
    })
  })

  it('wraps a multi-root fragment in a synthetic root', () => {
    const result = parseOutlineXml(
      '<node>Section A\n  <node>A1</node>\n</node>\n<node>Section B\n  <node>B1</node>\n</node>',
      'Batch 1',
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tree.label).toBe('Batch 1')
      expect(result.tree.children.map((n) => n.label)).toEqual(['Section A', 'Section B'])
      expect(result.tree.children[0]!.children[0]!.label).toBe('A1')
    }
  })

  it('rejects a wrapped root whose fallbackTitle is empty', () => {
    const result = parseOutlineXml('<node>A</node><node>B</node>', '  ')

    expect(result).toMatchObject({
      ok: false,
      reason: '[tree_invalid] XML root node label is empty',
    })
  })
})

describe('serializeOutlineXml', () => {
  it('serializes a tree into model dialect', () => {
    const tree: MindmapOutlineNode = {
      label: 'Root',
      children: [
        { label: 'A', children: [{ label: 'A1', children: [] }] },
        { label: 'B', children: [] },
      ],
    }

    expect(serializeOutlineXml(tree)).toBe(
      `<node>Root\n  <node>A\n    <node>A1</node>\n  </node>\n  <node>B</node>\n</node>`,
    )
  })

  it('escapes special characters in labels', () => {
    const tree: MindmapOutlineNode = {
      label: 'R&D <fast>',
      children: [{ label: 'a > b & c', children: [] }],
    }

    const xml = serializeOutlineXml(tree)
    expect(xml).toContain('<node>R&amp;D &lt;fast&gt;')
    expect(xml).toContain('<node>a &gt; b &amp; c</node>')
    // round-trips through the parser
    const parsed = parseOutlineXml(xml, 'Fallback')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.tree.label).toBe('R&D <fast>')
      expect(parsed.tree.children[0]!.label).toBe('a > b & c')
    }
  })
})

describe('serializeStorageFragment', () => {
  it('normalizes a tree into storage dialect with type/content attributes', () => {
    const tree: MindmapOutlineNode = {
      label: 'Root',
      children: [{ label: 'Leaf', children: [] }],
    }

    expect(serializeStorageFragment(tree)).toBe(
      `<node type="text" content="Root">\n  <node type="text" content="Leaf" />\n</node>`,
    )
  })

  it('escapes special characters and adds no ids or extra attributes', () => {
    const tree: MindmapOutlineNode = {
      label: 'R&D <fast> & "quoted"',
      children: [{ label: "it's", children: [] }],
    }

    const xml = serializeStorageFragment(tree)
    expect(xml).toContain('content="R&amp;D &lt;fast&gt; &amp; &quot;quoted&quot;"')
    expect(xml).not.toContain('id=')
    expect(xml).not.toContain('pageRange')
    expect(xml).not.toContain('summary')
  })
})
