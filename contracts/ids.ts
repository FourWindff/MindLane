/**
 * nanoid(8) 风格短 id（PRD 6.4）：字母数字 + `-`/`_`，XML/JSON 安全。
 * 64⁸ 碰撞空间，单文件内唯一即可；旧文件中的 UUID id 不迁移、新旧共存；
 * 根节点固定锚点 `root`。
 *
 * Lives in the contracts layer because the XML reader/writer mints ids for
 * fragments that arrive without one.
 */
export function newId(): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let id = ''
  for (const byte of bytes) {
    id += ALPHABET[byte % ALPHABET.length]
  }
  return id
}
