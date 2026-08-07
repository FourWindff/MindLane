import fs from 'node:fs'
import type { MindLaneFile } from '../../src/shared/lib/fileFormat.js'

/**
 * 从文件的 metadata.tags 读取标签；文件不存在/损坏/无标签时静默返回 undefined。
 * 纯函数，便于单测。
 */
export async function readFileTags(filePath: string): Promise<string[] | undefined> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8')
    const data = JSON.parse(raw) as MindLaneFile
    return data.metadata.tags
  } catch {
    return undefined
  }
}
