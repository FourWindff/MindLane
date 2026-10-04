/**
 * XML escaping/unescaping: the serializer escapes all 5 characters
 * (`& < > " '`) in text and attribute values. The base64 alphabet is itself
 * XML-safe and needs no extra handling.
 */

/** Escape the 5 characters: `& < > " '` → entities. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const ENTITY_RE = /&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g

/** Unescape XML entities (including numeric ones). Unknown entities are kept as-is. */
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
