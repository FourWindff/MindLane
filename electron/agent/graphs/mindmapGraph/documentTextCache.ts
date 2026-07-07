import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const DOCUMENTS_DIR = 'documents'
const SHORT_HASH_LENGTH = 8
const PREVIEW_MAX_LENGTH = 20

/** 计算文本的 sha256 */
export function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

/** 计算文件的 sha256 */
export async function hashFile(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(data).digest('hex')
}

/** 生成短哈希，用于显示文件名 */
export function shortHash(hash: string): string {
  return hash.slice(0, SHORT_HASH_LENGTH)
}

/** 清洗文件名，去掉扩展名和非法字符 */
export function sanitizeBaseFilename(filename: string): string {
  const withoutExt = path.basename(filename, path.extname(filename))
  return withoutExt
    .replace(/[\\/:*?"'<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

/** 构建缓存文件的相对路径 */
export function buildCacheRelativePath(baseFilename: string, hash: string): string {
  const safeName = sanitizeBaseFilename(baseFilename) || '未命名'
  return path.join(DOCUMENTS_DIR, `${safeName}_${hash}.txt`)
}

/** 把相对路径转成 userData 下的绝对路径 */
export function resolveCacheAbsolutePath(userDataPath: string, relativePath: string): string {
  return path.join(userDataPath, relativePath)
}

/** 保存文本缓存，成功返回相对路径，失败返回 undefined */
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
    // 缓存写入失败不应阻塞主流程
    console.warn('[documentTextCache] 保存文本缓存失败:', error)
    return undefined
  }
}

/** 生成文本预览：前 20 字符 + 省略号 */
export function buildTextPreview(text: string, maxLength = PREVIEW_MAX_LENGTH): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}…`
}
