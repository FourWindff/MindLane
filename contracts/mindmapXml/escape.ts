/**
 * XML 转义/反转义：序列化端对文本与属性值全量转义 5 字符（`& < > " '`）。
 * base64 字符集本身 XML 安全，无需额外处理。
 */

/** 转义 5 字符：`& < > " '` → 实体。 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const ENTITY_RE = /&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g

/** 反转义 XML 实体（含数字实体）。未知实体原样保留。 */
export function unescapeXml(value: string): string {
  return value.replace(ENTITY_RE, (_match, entity: string) => {
    switch (entity) {
      case 'amp':
        return '&'
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'quot':
        return '"'
      case 'apos':
        return "'"
      default: {
        if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16))
        if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10))
        return _match
      }
    }
  })
}
