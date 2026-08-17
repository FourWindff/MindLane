/**
 * HTML 解析器容错预处理：自闭合标签展开 + 文本残留裸 `<` 检测。
 *
 * 容错 HTML parser（浏览器 DOMParser('text/html') / 主进程 linkedom）会把自定义
 * 标签的 `/>` 当作普通属性字符——`<node id="a" />` 被吞成 `<node id="a">`，
 * 后续兄弟节点全部变成它的子树。因此解析 AI 片段前先归一：非 void 标签的自闭合
 * 一律展开为开闭配对（已实测 linkedom 与浏览器行为一致）。
 */

/** HTML void 元素：它们可以合法自闭合，不展开。 */
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

const SELF_CLOSING_RE = /<([A-Za-z][A-Za-z0-9_-]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)\s*\/\s*>/g

/**
 * 把非 void 标签的自闭合形式 `<tag … />` 展开为 `<tag …></tag>`。
 * 不触碰注释/CDATA/处理指令（它们不以 `<字母` 开头）。
 */
export function normalizeSelfClosingTags(xml: string): string {
  return xml.replace(SELF_CLOSING_RE, (match, tag: string, attrs: string) => {
    const lower = tag.toLowerCase()
    if (VOID_TAGS.has(lower)) return match
    return `<${tag}${attrs}></${tag}>`
  })
}

const ATTR_VALUE_RE = /(?:^|\s)([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g

const VALID_ENTITY_RE = /^&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/

/**
 * 检测属性值中的裸 `<` 或 `&`（AI 常见陷阱：`content="a<b"` 未转义）。
 * 容错 HTML parser 会把裸 `<` 当作新标签吞掉内容，解析不报错——
 * 必须在原始文本上做残留检测，命中即返回 `text_unescaped` 错误码。
 *
 * @returns 命中时返回未转义片段的位置描述，否则 null。
 */
export function findUnescapedInAttrValues(xml: string): string | null {
  let match: RegExpExecArray | null
  ATTR_VALUE_RE.lastIndex = 0
  while ((match = ATTR_VALUE_RE.exec(xml)) !== null) {
    const value = match[3] ?? match[4] ?? ''
    for (let i = 0; i < value.length; i++) {
      const ch = value[i]!
      if (ch === '<') return `属性值含未转义的 '<'（片段 ${match[1]}）`
      if (ch === '&' && !VALID_ENTITY_RE.test(value.slice(i))) {
        return `属性值含未转义的 '&'（片段 ${match[1]}）`
      }
    }
  }
  return null
}

/**
 * 标签配对的结构完整性检查（引号感知、跳过注释/CDATA/处理指令）。
 *
 * linkedom 的 XML 模式对畸形输入不报错（不产生 parsererror），浏览器 HTML 模式
 * 也从不报错；为了让 `xml_parse_error` 错误码跨环境确定，必须在原始文本上做一次
 * 轻量级检查：开闭标签必须配对、属性引号必须闭合。
 */
export function checkXmlWellFormed(xml: string): string | null {
  const stack: string[] = []
  let i = 0
  const n = xml.length

  const skipUntil = (needle: string): boolean => {
    const idx = xml.indexOf(needle, i)
    if (idx < 0) return false
    i = idx + needle.length
    return true
  }

  while (i < n) {
    const lt = xml.indexOf('<', i)
    if (lt < 0) break

    // 注释 / CDATA / 处理指令：跳到对应结束符
    if (xml.startsWith('<!--', lt)) {
      if (!skipUntil('-->')) return '未闭合的注释'
      continue
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      if (!skipUntil(']]>')) return '未闭合的 CDATA'
      continue
    }
    if (xml.startsWith('<?', lt)) {
      if (!skipUntil('?>')) return '未闭合的处理指令'
      continue
    }

    // 标签：找到名称
    const nameMatch = /^<\/?([A-Za-z][A-Za-z0-9_.:-]*)/.exec(xml.slice(lt))
    if (!nameMatch) {
      return `位置 ${lt} 存在无法识别的 '<'`
    }
    const isClose = xml[lt + 1] === '/'
    const name = nameMatch[1]!

    // 引号感知地扫描到标签结束 '>'
    let j = lt + nameMatch[0].length
    let quote: string | null = null
    for (; j < n; j++) {
      const ch = xml[j]!
      if (quote) {
        if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'") {
        quote = ch
        continue
      }
      if (ch === '>') break
    }
    if (j >= n) return `标签 <${name}> 未闭合`
    const tagBody = xml.slice(lt + nameMatch[0].length, j)
    const selfClosing = /\/\s*$/.test(tagBody)

    if (isClose) {
      const open = stack.pop()
      if (open !== name) {
        return open ? `标签不配对：</${name}> 闭合了 <${open}>` : `多余的闭合标签 </${name}>`
      }
    } else if (!selfClosing) {
      stack.push(name)
    }
    i = j + 1
  }

  if (stack.length > 0) {
    return `标签 <${stack[stack.length - 1]}> 未闭合`
  }
  return null
}
