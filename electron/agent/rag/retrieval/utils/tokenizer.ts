const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf]/
const TOKEN_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf]|[a-z]+|[0-9]+/g

/**
 * Tokenize text for BM25 search.
 * CJK characters are split individually + bigrams; English words split by whitespace.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  const normalized = text.toLowerCase().trim()

  let match: RegExpExecArray | null
  const cloned = new RegExp(TOKEN_REGEX.source, TOKEN_REGEX.flags)

  while ((match = cloned.exec(normalized)) !== null) {
    tokens.push(match[0])
  }

  // Generate CJK bigrams for better phrase matching
  const cjkChars = tokens.filter((t) => CJK_REGEX.test(t) && t.length === 1)
  for (let i = 0; i < cjkChars.length - 1; i++) {
    tokens.push(cjkChars[i] + cjkChars[i + 1])
  }

  return tokens
}

export function countOccurrences(tokens: string[], term: string): number {
  return tokens.filter((t) => t === term).length
}
