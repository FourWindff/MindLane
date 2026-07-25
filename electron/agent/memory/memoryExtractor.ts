import { SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { LLMProvider } from '../providers/index.js'
import { MemoryManager } from './memoryManager.js'
import type { EditLogEntry, EditLogStore } from './editLogStore.js'
import fs from 'node:fs'
import type { MindLaneFile } from '../../../src/shared/lib/fileFormat.js'
import { logger } from '../../shared/logger.js'
import { messageContentToString } from '../utils.js'

const DISCIPLINES = [
  'formal-sciences',
  'natural-sciences',
  'engineering',
  'humanities',
  'social-sciences',
  'creative-arts',
] as const

type Discipline = (typeof DISCIPLINES)[number]

interface ExtractedPattern {
  discipline: Discipline
  subTag: string
  description: string
  observation: string
}

interface LLMExtractionResponse {
  disciplines: Array<{
    name: string
    patterns: Array<{
      subTag: string
      description: string
      observation: string
      evidence?: string[]
    }>
  }>
}

interface ExtractOptions {
  provider: LLMProvider
  /** Archived message slice supplied by the caller (the extraction cursor rides on `lastConsolidated`). */
  messages: BaseMessage[]
  /** Node edit history for the current fileUuid (may be empty). */
  editlogEntries: EditLogEntry[]
  /** .mindlane path for metadata.tags update; skipped when absent. */
  filePath?: string
}

export class MemoryExtractor {
  constructor(private manager: MemoryManager) {}

  /**
   * Extract thinking patterns from the given evidence slice using LLM,
   * persist them to memory files, and update .mindlane tags.
   */
  async extractAndPersist(options: ExtractOptions): Promise<void> {
    const { provider, messages, editlogEntries, filePath } = options
    logger.withContext('memory').debug('Starting extraction for file:', filePath ?? '(unknown)')
    const patterns = await this.extract(provider, messages, editlogEntries)
    if (patterns.length === 0) {
      logger.withContext('memory').debug('No patterns extracted, skipping persist')
      return
    }
    logger.withContext('memory').debug(
      `Extracted ${patterns.length} pattern(s):`,
      patterns.map((p) => `${p.discipline}-${p.subTag}`),
    )

    await Promise.all([this.persist(patterns), this.updateMindlaneTags(filePath, patterns)])
    logger.withContext('memory').debug('Persist and tag update completed')
  }

  /** Call LLM to extract thinking patterns from the evidence slice. */
  private async extract(
    provider: LLMProvider,
    messages: BaseMessage[],
    editlogEntries: EditLogEntry[],
  ): Promise<ExtractedPattern[]> {
    const existingTags = await this.manager.listTags()
    const prompt = this.buildExtractionPrompt(messages, editlogEntries, existingTags)
    const response = await provider.chatModel.invoke([new SystemMessage(prompt)])
    return this.parseExtractionResponse(response.content)
  }

  /** Persist extracted patterns to memory files and rebuild index once. */
  async persist(patterns: ExtractedPattern[]): Promise<void> {
    for (const p of patterns) {
      const tag = `${p.discipline}-${p.subTag}`
      await this.manager.writeMemory(tag, p.description, p.observation, { skipIndexRebuild: true })
    }
    await this.manager.rebuildIndex()
  }

  /** Update .mindlane file metadata.tags with discovered disciplines. */
  private async updateMindlaneTags(
    filePath: string | undefined,
    patterns: ExtractedPattern[],
  ): Promise<void> {
    if (!filePath) return
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8')
      const data = JSON.parse(raw) as MindLaneFile
      const existing = new Set(data.metadata.tags || [])
      const originalSize = existing.size
      for (const p of patterns) {
        existing.add(p.discipline)
      }
      if (existing.size === originalSize) {
        logger.withContext('memory').debug('No new tags to add, skipping .mindlane rewrite')
        return
      }
      data.metadata.tags = Array.from(existing)
      data.metadata.updatedAt = new Date().toISOString()
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
      logger
        .withContext('memory')
        .debug('Updated .mindlane tags:', Array.from(existing), 'file:', filePath)
    } catch (e) {
      logger.withContext('memory').warn('Failed to update .mindlane tags:', e, 'file:', filePath)
    }
  }

  private buildExtractionPrompt(
    messages: BaseMessage[],
    editlogEntries: EditLogEntry[],
    existingTags: string[],
  ): string {
    const conversation = messages
      .filter((m) => m.getType() === 'human' || m.getType() === 'ai')
      .map((m) => {
        const role = m.getType() === 'human' ? '用户' : 'AI'
        return `${role}: ${messageContentToString(m.content)}`
      })
      .join('\n')

    const editlog =
      editlogEntries.length > 0
        ? editlogEntries.map((e) => `节点 ${e.nodeId}: 「${e.before}」→「${e.after}」`).join('\n')
        : '（无）'

    const tagList = existingTags.length > 0 ? existingTags.join('\n') : '（暂无已有标签）'

    return `你是一位认知模式分析师。请分析以下对话和节点编辑历史，识别用户的思维模式与偏好。

任务：
1. 识别对话涉及的一个或多个学科（从以下6个类别中选择）。
2. 对每个学科，提取用户的思维模式与偏好。
3. 以JSON格式输出。

学科：
1. formal-sciences: 数学、统计学、形式逻辑、计算机科学（算法/架构）、密码学
2. natural-sciences: 物理、化学、生物、医学、地理、天文学
3. engineering: 软件工程、机械制造、项目管理、产品设计、自动化
4. humanities: 历史、哲学、文学、语言学、艺术理论
5. social-sciences: 经济学、心理学、社会学、政治学、金融/商业分析
6. creative-arts: 视觉设计、音乐创作、影视编剧、建筑创意

对每个学科，考察以下维度：
- formal-sciences: 演绎vs归纳？符号敏感度vs几何直觉？
- natural-sciences: 还原论vs系统论？对实验数据的依赖程度？
- engineering: 模块化设计偏好？先搭框架vs先跑MVP？
- humanities: 时间轴纵向叙事vs空间/流派横向对比？隐喻理解能力？
- social-sciences: 利益相关者分析？供需关系？心理动机模型？
- creative-arts: 多模态脑暴偏好？视觉联想和非线性跳跃频率？

输出格式（严格JSON）：
{
  "disciplines": [
    {
      "name": "engineering",
      "patterns": [
        {
          "subTag": "modular",
          "description": "一句话摘要",
          "observation": "详细描述用户的思维模式和偏好...",
          "evidence": ["对话中的具体表述"]
        }
      ]
    }
  ]
}

规则：
- 只输出JSON，不要其他文本
- 如果没有明显可识别的模式，返回 {"disciplines": []}
- subTag 使用 kebab-case（例如 modular, timeline, deductive）
- **subTag 复用优先**：优先从下方「已有标签清单」中选择匹配的 subTag（取 "-" 后的部分）；只有现有标签均不匹配时才允许新建
- description 是一行摘要（30字以内）
- observation 是详细描述（包含具体证据和观察）
- evidence 是对话或编辑历史中支持该观察的具体原文引用

已有标签清单（复用优先）：
${tagList}

对话内容：
${conversation}

节点编辑历史（用户手动修改节点文本的前后对比）：
${editlog}

请输出JSON格式的分析结果。`
  }

  private parseExtractionResponse(content: unknown): ExtractedPattern[] {
    const text = typeof content === 'string' ? content : JSON.stringify(content)

    const jsonText = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim()

    try {
      const parsed = JSON.parse(jsonText) as LLMExtractionResponse
      const patterns: ExtractedPattern[] = []

      for (const d of parsed.disciplines || []) {
        for (const p of d.patterns || []) {
          if (d.name && p.subTag && p.description && p.observation) {
            const discipline = d.name as Discipline
            if (!DISCIPLINES.includes(discipline)) continue
            patterns.push({
              discipline,
              subTag: p.subTag,
              description: p.description,
              observation: p.observation,
            })
          }
        }
      }

      return patterns
    } catch (e) {
      logger
        .withContext('memory')
        .warn('Failed to parse LLM response:', e, 'raw:', text.slice(0, 500))
      return []
    }
  }
}

/**
 * Build the Consolidator `onArchived` callback: reads the file's editlog,
 * runs extraction on the archived slice, and deletes the editlog only after
 * a successful extraction (kept on failure so evidence is not lost).
 */
export function createExtractionCallback(deps: {
  extractor: MemoryExtractor
  editLogStore: EditLogStore
  provider: LLMProvider
  workspaceUuid: string
  fileUuid: string
  filePath?: string
}): (messages: BaseMessage[]) => Promise<void> {
  return async (messages) => {
    const editlogEntries = await deps.editLogStore.read(deps.workspaceUuid, deps.fileUuid)
    await deps.extractor.extractAndPersist({
      provider: deps.provider,
      messages,
      editlogEntries,
      filePath: deps.filePath,
    })
    if (editlogEntries.length > 0) {
      await deps.editLogStore.delete(deps.workspaceUuid, deps.fileUuid)
    }
  }
}
