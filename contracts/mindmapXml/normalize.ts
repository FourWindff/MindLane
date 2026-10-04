/**
 * Tolerant-HTML-parser preprocessing: self-closing tag expansion + raw `<`
 * detection in text.
 *
 * Tolerant HTML parsers (browser DOMParser('text/html') / main-process linkedom)
 * treat a custom tag's `/>` as ordinary attribute characters — `<node id="a" />`
 * gets swallowed into `<node id="a">` and every following sibling becomes its
 * subtree. So before parsing an AI fragment, normalize: every self-closing
 * non-void tag expands to an open/close pair (verified to match linkedom and
 * browser behavior).
 */

/** HTML void elements: they may legitimately self-close and are not expanded. */
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
 * Expand a self-closing non-void tag `<tag … />` into `<tag …></tag>`.
 * Comments/CDATA/processing instructions are untouched (they do not start with
 * `<letter`).
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
 * Detect a raw `<` or `&` inside attribute values (a common AI trap: an
 * unescaped `content="a<b"`). A tolerant HTML parser swallows the content as a
 * new tag and reports no parse error — so raw text must be checked, and a hit
 * returns the `text_unescaped` error code instead of a parse failure.
 *
 * @returns A location description of the unescaped fragment on a hit, else null.
 */
export function findUnescapedInAttrValues(xml: string): string | null {
  let match: RegExpExecArray | null
  ATTR_VALUE_RE.lastIndex = 0
  while ((match = ATTR_VALUE_RE.exec(xml)) !== null) {
    const value = match[3] ?? match[4] ?? ''
    for (let i = 0; i < value.length; i++) {
      const ch = value[i]!
      if (ch === '<') return `Attribute value contains an unescaped '<' (fragment ${match[1]})`
      if (ch === '&' && !VALID_ENTITY_RE.test(value.slice(i))) {
        return `Attribute value contains an unescaped '&' (fragment ${match[1]})`
      }
    }
  }
  return null
}

/**
 * Structural integrity check for tag pairing (quote-aware; skips
 * comments/CDATA/processing instructions).
 *
 * linkedom's XML mode reports no malformed input (it yields no parsererror) and
 * the browser HTML mode never errors either; to make the `xml_parse_error` code
 * deterministic across environments, the raw text gets one lightweight check:
 * open/close tags must pair and attribute quotes must be closed.
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

    // Comment / CDATA / processing instruction: skip to the matching terminator
    if (xml.startsWith('<!--', lt)) {
      if (!skipUntil('-->')) return 'Unclosed comment'
      continue
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      if (!skipUntil(']]>')) return 'Unclosed CDATA'
      continue
    }
    if (xml.startsWith('<?', lt)) {
      if (!skipUntil('?>')) return 'Unclosed processing instruction'
      continue
    }

    // Tag: find the name
    const nameMatch = /^<\/?([A-Za-z][A-Za-z0-9_.:-]*)/.exec(xml.slice(lt))
    if (!nameMatch) {
      return `Unrecognized '<' at position ${lt}`
    }
    const isClose = xml[lt + 1] === '/'
    const name = nameMatch[1]!

    // Quote-aware scan to the end of the tag '>'
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
    if (j >= n) return `Tag <${name}> is not closed`
    const tagBody = xml.slice(lt + nameMatch[0].length, j)
    const selfClosing = /\/\s*$/.test(tagBody)

    if (isClose) {
      const open = stack.pop()
      if (open !== name) {
        return open ? `Tag mismatch: </${name}> closes <${open}>` : `Stray closing tag </${name}>`
      }
    } else if (!selfClosing) {
      stack.push(name)
    }
    i = j + 1
  }

  if (stack.length > 0) {
    return `Tag <${stack[stack.length - 1]}> is not closed`
  }
  return null
}
