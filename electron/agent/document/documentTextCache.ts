import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const DOCUMENTS_DIR = 'documents'
const SHORT_HASH_LENGTH = 8
const PREVIEW_MAX_LENGTH = 20

/** Compute the sha256 of a text */
export function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

/** Compute the sha256 of a file */
export async function hashFile(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(data).digest('hex')
}

/** Build a short hash, used in display file names */
export function shortHash(hash: string): string {
  return hash.slice(0, SHORT_HASH_LENGTH)
}

/** Sanitize a file name: drop the extension and illegal characters */
function sanitizeBaseFilename(filename: string): string {
  const withoutExt = path.basename(filename, path.extname(filename))
  return withoutExt
    .replace(/[\\/:*?"'<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

/** Build the relative path of the cache file */
function buildCacheRelativePath(baseFilename: string, hash: string): string {
  const safeName = sanitizeBaseFilename(baseFilename) || 'Untitled'
  return path.join(DOCUMENTS_DIR, `${safeName}_${hash}.txt`)
}

/** Turn a relative path into an absolute path under userData */
function resolveCacheAbsolutePath(userDataPath: string, relativePath: string): string {
  return path.join(userDataPath, relativePath)
}

/** Save the text cache: returns the relative path on success, undefined on failure */
export async function saveDocumentTextCache(
  userDataPath: string,
  baseFilename: string,
  hash: string,
  text: string,
): Promise<string | undefined> {
  const relativePath = buildCacheRelativePath(baseFilename, hash)
  const absolutePath = resolveCacheAbsolutePath(userDataPath, relativePath)

  try {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, text, 'utf8')
    return relativePath
  } catch (error) {
    // A failed cache write must not block the main flow
    console.warn('[documentTextCache] failed to save text cache:', error)
    return undefined
  }
}

/** Build a text preview: first 20 characters plus an ellipsis */
export function buildTextPreview(text: string, maxLength = PREVIEW_MAX_LENGTH): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}…`
}
