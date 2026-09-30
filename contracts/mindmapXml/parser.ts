/**
 * 解析内核（不自研）：浏览器端 DOMParser，主进程 linkedom。
 *
 * 两套严格度分开（PRD 1.3-2）：
 * - 文件（编辑器生成）→ 严格 XML 模式，畸形输入映射 `xml_parse_error`；
 * - AI 交互片段（工具参数/上下文）→ 容错 HTML 模式。
 *
 * 解析器按进程装配（设计文档：浏览器端 DOMParser，主进程 linkedom）：
 * - 渲染层：`globalThis.DOMParser` 恒可用，本模块不 import linkedom
 *   （linkedom 的可选依赖 canvas 无法被 Vite/Rollup 静态解析，必须留在渲染层图外）；
 * - 主进程：启动时 `registerXmlDomParser(linkedom.DOMParser)` 注入；
 * - 测试环境（Electron-as-Node）：vitest setup 注入。
 */

import { MindmapXmlError } from './types.js'
import { checkXmlWellFormed } from './normalize.js'
import type { DomElementLike, DomNodeLike, ParsedDocumentLike } from './dom.js'

export type { DomElementLike, DomNodeLike, ParsedDocumentLike } from './dom.js'

type DomParserCtor = new () => {
  parseFromString(xml: string, contentType: string): ParsedDocumentLike
}

let injectedParser: DomParserCtor | undefined

/** 主进程装配入口：把进程内 XML/HTML parser 注入（Node 侧为 linkedom.DOMParser）。
 * 参数用 unknown 接受：linkedom 的 DOM 类型与浏览器 lib.dom 结构不兼容，装配处收窄。 */
export function registerXmlDomParser(ctor: unknown): void {
  injectedParser = ctor as DomParserCtor
}

function getDomParser(): DomParserCtor {
  const global = globalThis as { DOMParser?: DomParserCtor }
  if (typeof global.DOMParser === 'function') return global.DOMParser
  if (injectedParser) return injectedParser
  throw new MindmapXmlError(
    'xml_parse_error',
    '当前环境没有可用的 XML parser：渲染层需 DOMParser，主进程/测试环境需注入 linkedom',
  )
}

/**
 * 严格解析 XML（文件面）。畸形输入抛 `xml_parse_error`，绝不裸抛。
 */
export function parseXmlStrict(xml: string): ParsedDocumentLike {
  const structureError = checkXmlWellFormed(xml)
  if (structureError) {
    throw new MindmapXmlError('xml_parse_error', `XML 结构不完整：${structureError}`)
  }
  const Parser = getDomParser()
  try {
    const doc = new Parser().parseFromString(xml, 'application/xml')
    const parserError = doc.querySelector?.('parsererror')
    if (parserError) {
      const detail = parserError.textContent?.trim().slice(0, 200) ?? ''
      throw new MindmapXmlError('xml_parse_error', `XML 解析失败：${detail}`)
    }
    if (!doc.documentElement) {
      throw new MindmapXmlError('xml_parse_error', 'XML 为空或没有根元素')
    }
    return doc
  } catch (err) {
    if (err instanceof MindmapXmlError) throw err
    throw new MindmapXmlError(
      'xml_parse_error',
      `XML 解析失败：${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * 容错解析（AI 片段面）：HTML parser 容忍 AI 的不规范输出。
 * 调用方应先经 normalizeSelfClosingTags 预处理。
 */
export function parseXmlTolerant(xml: string): ParsedDocumentLike {
  const structureError = checkXmlWellFormed(xml)
  if (structureError) {
    // 容错模式的底线：标签配对仍必须成立，否则 AI 拿到的是残缺结构
    throw new MindmapXmlError('xml_parse_error', `XML 结构不完整：${structureError}`)
  }
  const Parser = getDomParser()
  try {
    return new Parser().parseFromString(xml, 'text/html')
  } catch (err) {
    throw new MindmapXmlError(
      'xml_parse_error',
      `XML 解析失败：${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** 解析结果中的顶层元素列表。 */
export function topLevelElements(doc: ParsedDocumentLike): DomElementLike[] {
  const root = doc.documentElement
  if (!root) return []
  if (root.tagName.toLowerCase() === 'html') {
    const body = doc.body ?? root
    const children: DomElementLike[] = []
    for (const child of Array.from(body.childNodes)) {
      if (child.nodeType === 1) children.push(child as DomElementLike)
    }
    return children
  }
  const result: DomElementLike[] = []
  let el: DomElementLike | null = root
  while (el) {
    if (el.nodeType === 1) result.push(el)
    let next: DomNodeLike | null = el.nextSibling
    while (next && next.nodeType !== 1) next = next.nextSibling
    el = next as DomElementLike | null
  }
  return result
}
