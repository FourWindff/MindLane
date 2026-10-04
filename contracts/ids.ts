/**
 * Short nanoid(8)-style id (PRD 6.4): alphanumeric + `-`/`_`, safe in XML/JSON.
 * A 64^8 collision space; unique within a single file is enough. UUID ids in
 * old files are not migrated — old and new coexist; the root node is the fixed
 * anchor `root`.
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
