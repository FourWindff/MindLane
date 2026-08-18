/**
 * mindmap 子图模型协议（ADR-0016）：leaf 提取 / 归并 / 修复循环的模型方言。
 *
 * 模型方言：`<node>标题</node>` 嵌套，元素文本承载 label（解析时 trim），
 * 零属性、无 id（id 由编辑器 mint）。解析走共享容错内核（parseXmlTolerant，
 * 与 insertXmlFragment 同源），转义复用共享 escapeXml；不在本模块再造平行工具。
 *
 * 校验规则：恰好单根（多根片段包合成根容错）、根 label 非空、根 ≥1 子节点、
 * 全节点 label 非空、任何属性视为协议违例拒绝。失败 reason 带共享
 * MindmapXmlError 错误码前缀（`[code] message`），供修复循环回传给模型。
 */

import {
  MindmapXmlError,
  NODE_TAG,
  escapeXml,
  normalizeSelfClosingTags,
  parseXmlTolerant,
  topLevelElements,
} from '../../../src/shared/lib/mindmapXml/index.js'

/** 子图内部树类型（ADR-0016：降为 {label, children}，page_range/summary 已删）。 */
export interface MindmapOutlineNode {
  label: string
  children: MindmapOutlineNode[]
}

export type MindmapOutlineParseResult =
  { ok: true; tree: MindmapOutlineNode } | { ok: false; reason: string }

/** 把共享错误格式化为 `[code] message`（与写工具错误回传约定一致）。 */
function formatXmlError(error: unknown): string {
  if (error instanceof MindmapXmlError) {
    return `[${error.code}] ${error.message}`
  }
  return error instanceof Error ? error.message : String(error)
}

function isNodeElement(el: Element): boolean {
  return el.tagName.toLowerCase() === NODE_TAG
}

/** 元素 label = 直接文本子节点拼接后 trim（嵌套 <node> 由 children 承载，不算 label）。 */
function elementLabel(el: Element): string {
  let text = ''
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) text += child.textContent ?? ''
  }
  return text.trim()
}

/**
 * 解析并校验模型方言 XML 片段。
 *
 * - 空输出 → `[empty_xml] 模型返回为空`；
 * - 结构不完整/不可解析 → `[xml_parse_error]` 带位置的解析错误；
 * - 未找到任何 `<node>` → `[empty_xml]`；
 * - 全节点 label 非空（含根）；根 ≥1 子节点；零属性；
 * - 多根片段包一个合成根（fallbackTitle）容错，不整轮失败。
 */
export function parseOutlineXml(text: string, fallbackTitle: string): MindmapOutlineParseResult {
  const trimmed = text.trim()
  if (!trimmed) {
    return { ok: false, reason: '[empty_xml] 模型返回为空' }
  }

  let doc: ReturnType<typeof parseXmlTolerant>
  try {
    doc = parseXmlTolerant(normalizeSelfClosingTags(trimmed))
  } catch (error) {
    return { ok: false, reason: formatXmlError(error) }
  }

  const rootElements = topLevelElements(doc).filter(isNodeElement)
  if (rootElements.length === 0) {
    return { ok: false, reason: '[empty_xml] XML 片段中未找到任何 <node> 元素' }
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
    return { ok: false, reason: '[tree_invalid] XML 根节点 label 为空' }
  }
  if (candidate.children.length === 0) {
    return { ok: false, reason: '[tree_invalid] XML 根节点必须包含至少一个子节点' }
  }

  return { ok: true, tree: candidate }
}

/** 递归转换单个 <node> 元素；任一层级协议违例（属性/空 label）即整体失败。 */
function nodeFromElement(
  el: Element,
): { ok: true; tree: MindmapOutlineNode } | { ok: false; reason: string } {
  for (const attr of Array.from(el.attributes)) {
    return {
      ok: false,
      reason: `[tree_invalid] <node> 不允许携带属性「${attr.name}」（模型方言零属性）`,
    }
  }

  const label = elementLabel(el)
  if (!label) {
    return { ok: false, reason: '[tree_invalid] XML 包含空节点标签' }
  }

  const children: MindmapOutlineNode[] = []
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType !== 1) continue
    if (!isNodeElement(child as Element)) continue
    const sub = nodeFromElement(child as Element)
    if (!sub.ok) return sub
    children.push(sub.tree)
  }

  return { ok: true, tree: { label, children } }
}

/**
 * 模型方言序列化（merge 输入面）：`<node>标题</node>` 嵌套，label 经共享转义。
 * 输出可被 parseOutlineXml 原样解析（多根则包合成根）。
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
 * 存储方言 writer（子图输出面）：规范化重序列化校验后的树为
 * `<node type="text" content="…" />` 存储形状。模型原串不外泄，最终片段
 * 恒为 well-formed 存储方言（id 由编辑器插入时 mint）。
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
