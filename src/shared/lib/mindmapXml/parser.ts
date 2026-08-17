/**
 * 解析内核（不自研）：浏览器端 DOMParser，主进程/测试环境 linkedom。
 *
 * 两套严格度分开（PRD 1.3-2）：
 * - 文件（编辑器生成）→ 严格 XML 模式，畸形输入映射 `xml_parse_error`；
 * - AI 交互片段（工具参数/上下文）→ 容错 HTML 模式。
 */

import { MindmapXmlError } from './types.js'
import { checkXmlWellFormed } from './normalize.js'

type DomParserCtor = new () => {
  parseFromString(xml: string, contentType: string): Document
}

let cachedDomParser: DomParserCtor | undefined

async function getDomParser(): Promise<DomParserCtor> {
  if (cachedDomParser) return cachedDomParser
  const global = globalThis as { DOMParser?: DomParserCtor }
  if (typeof global.DOMParser === 'function') {
    cachedDomParser = global.DOMParser
    return cachedDomParser
  }
  // Node 环境（主进程 / 迁移 / 测试）：linkedom 与浏览器 DOMParser 同构。
  const linkedom = (await import('linkedom')) as { DOMParser: DomParserCtor }
  cachedDomParser = linkedom.DOMParser
  return cachedDomParser
}

/**
 * 严格解析 XML（文件面）。畸形输入抛 `xml_parse_error`，绝不裸抛。
 */
export async function parseXmlStrict(xml: string): Promise<Document> {
  const structureError = checkXmlWellFormed(xml)
  if (structureError) {
    throw new MindmapXmlError('xml_parse_error', `XML 结构不完整：${structureError}`)
  }
  const Parser = await getDomParser()
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
export async function parseXmlTolerant(xml: string): Promise<Document> {
  const structureError = checkXmlWellFormed(xml)
  if (structureError) {
    // 容错模式的底线：标签配对仍必须成立，否则 AI 拿到的是残缺结构
    throw new MindmapXmlError('xml_parse_error', `XML 结构不完整：${structureError}`)
  }
  const Parser = await getDomParser()
  try {
    return new Parser().parseFromString(xml, 'text/html')
  } catch (err) {
    throw new MindmapXmlError(
      'xml_parse_error',
      `XML 解析失败：${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** 解析结果中的顶层元素列表。
 * 浏览器 HTML 模式：documentElement 为 html，取 body 子元素；
 * linkedom HTML 模式：documentElement 即片段首个元素，其余顶层元素是其元素级兄弟。 */
export function topLevelElements(doc: Document): Element[] {
  const root = doc.documentElement
  if (!root) return []
  if (root.tagName.toLowerCase() === 'html') {
    const body = doc.body ?? root
    const children: Element[] = []
    for (const child of Array.from(body.childNodes)) {
      if (child.nodeType === 1) children.push(child as Element)
    }
    return children
  }
  const result: Element[] = []
  let el: Element | null = root
  while (el) {
    if (el.nodeType === 1) result.push(el)
    let next: ChildNode | null = el.nextSibling
    while (next && next.nodeType !== 1) next = next.nextSibling
    el = next as Element | null
  }
  return result
}
