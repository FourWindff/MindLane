/**
 * Mindmap subgraph model protocol (ADR-0016): the model dialect of the leaf
 * extraction / merge / repair loop.
 *
 * Model dialect: nested `<node>label</node>`, where the element text carries the
 * label (trimmed at parse time), with zero attributes and no ids (ids are minted
 * by the editor). Parsing goes through the shared tolerant kernel
 * (parseXmlTolerant, the same one as insertXmlFragment), and escaping reuses the
 * shared escapeXml; this module does not build a parallel toolkit.
 *
 * Validation rules: exactly one root (a multi-root fragment is wrapped in a
 * synthetic root instead of failing), non-empty root label, root has >= 1 child,
 * every node label non-empty, and any attribute is rejected as a protocol
 * violation. Failures carry the shared MindmapXmlError code prefix in their
 * reason (`[code] message`) so the repair loop can hand them back to the model.
 */

import {
  escapeXml,
  formatXmlError,
  isNodeElement,
  normalizeSelfClosingTags,
  parseXmlTolerant,
  topLevelElements,
  type DomElementLike,
} from '../../../contracts/mindmapXml/index.js'

/** Subgraph-internal tree type (ADR-0016: reduced to {label, children}; page_range/summary were removed). */
export interface MindmapOutlineNode {
  label: string
  children: MindmapOutlineNode[]
}

type MindmapOutlineParseResult =
  { ok: true; tree: MindmapOutlineNode } | { ok: false; reason: string }

/** Element label = trimmed concatenation of direct text children (nested <node> elements are carried by children, not counted as label). */
function elementLabel(el: DomElementLike): string {
  let text = ''
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) text += child.textContent ?? ''
  }
  return text.trim()
}

/**
 * Parse and validate a model-dialect XML fragment.
 *
 * - Empty output → `[empty_xml] Model returned an empty response`;
 * - Incomplete / unparsable structure → `[xml_parse_error]` with a positioned parse error;
 * - No `<node>` found → `[empty_xml]`;
 * - Every node label non-empty (root included); root has >= 1 child; zero attributes;
 * - A multi-root fragment is wrapped in a synthetic root (fallbackTitle) instead of
 *   failing the whole round.
 */
export function parseOutlineXml(text: string, fallbackTitle: string): MindmapOutlineParseResult {
  const trimmed = text.trim()
  if (!trimmed) {
    return { ok: false, reason: '[empty_xml] Model returned an empty response' }
  }

  let doc: ReturnType<typeof parseXmlTolerant>
  try {
    doc = parseXmlTolerant(normalizeSelfClosingTags(trimmed))
  } catch (error) {
    return { ok: false, reason: formatXmlError(error) }
  }

  const rootElements = topLevelElements(doc).filter(isNodeElement)
  if (rootElements.length === 0) {
    return { ok: false, reason: '[empty_xml] No <node> element found in the XML fragment' }
  }

  const trees: MindmapOutlineNode[] = []
  for (const el of rootElements) {
    const result = nodeFromElement(el)
    if (!result.ok) return result
    trees.push(result.tree)
  }

  const candidate: MindmapOutlineNode =
    trees.length === 1 ? trees[0]! : { label: fallbackTitle, children: trees }

  if (!candidate.label.trim()) {
    return { ok: false, reason: '[tree_invalid] XML root node label is empty' }
  }
  if (candidate.children.length === 0) {
    return {
      ok: false,
      reason: '[tree_invalid] XML root node must contain at least one child node',
    }
  }

  return { ok: true, tree: candidate }
}

/** Recursively convert a single <node> element; a protocol violation at any level (attribute / empty label) fails the whole thing. */
function nodeFromElement(
  el: DomElementLike,
): { ok: true; tree: MindmapOutlineNode } | { ok: false; reason: string } {
  for (const attr of Array.from(el.attributes)) {
    return {
      ok: false,
      reason: `[tree_invalid] <node> must not carry attribute "${attr.name}" (the model dialect allows zero attributes)`,
    }
  }

  const label = elementLabel(el)
  if (!label) {
    return { ok: false, reason: '[tree_invalid] XML contains an empty node label' }
  }

  const children: MindmapOutlineNode[] = []
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType !== 1) continue
    if (!isNodeElement(child as DomElementLike)) continue
    const sub = nodeFromElement(child as DomElementLike)
    if (!sub.ok) return sub
    children.push(sub.tree)
  }

  return { ok: true, tree: { label, children } }
}

/**
 * Model-dialect serialization (merge input side): nested `<node>label</node>`, labels escaped
 * through the shared helper. The output can be parsed back by parseOutlineXml as-is
 * (multiple roots get wrapped in a synthetic root).
 */
export function serializeOutlineXml(node: MindmapOutlineNode, depth = 0): string {
  const indent = '  '.repeat(depth)
  const childrenXml = node.children.map((child) => serializeOutlineXml(child, depth + 1))
  if (childrenXml.length === 0) {
    return `${indent}<node>${escapeXml(node.label)}</node>`
  }
  return `${indent}<node>${escapeXml(node.label)}\n${childrenXml.join('\n')}\n${indent}</node>`
}

/**
 * Storage-dialect writer (subgraph output side): re-serializes a validated tree into the
 * `<node type="text" content="…" />` storage shape. The model's raw string never leaks out;
 * the final fragment is always well-formed storage dialect (ids are minted by the editor
 * on insert).
 */
export function serializeStorageFragment(node: MindmapOutlineNode, depth = 0): string {
  const indent = '  '.repeat(depth)
  const attrs = `type="text" content="${escapeXml(node.label)}"`
  const childrenXml = node.children.map((child) => serializeStorageFragment(child, depth + 1))
  if (childrenXml.length === 0) {
    return `${indent}<node ${attrs} />`
  }
  return `${indent}<node ${attrs}>\n${childrenXml.join('\n')}\n${indent}</node>`
}
