import { SystemMessage } from '@langchain/core/messages'
import type { LLMProvider } from '../providers/index.js'
import { MemoryManager } from './memoryManager.js'
import type { ChatMessage } from '../../../src/shared/lib/fileFormat.js'
import fs from 'node:fs'
import type { MindLaneFile } from '../../../src/shared/lib/fileFormat.js'
import { logger } from '../../shared/logger.js'

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
  messages: ChatMessage[]
  mindmapSummary: string
  filePath: string
}

export class MemoryExtractor {
  constructor(private manager: MemoryManager) {}

  /**
   * Extract thinking patterns from conversation using LLM,
   * persist them to memory files, and update .mindlane tags.
   */
  async extractAndPersist(options: ExtractOptions): Promise<void> {
    const { provider, messages, mindmapSummary, filePath } = options
    logger.info('[MemoryExtractor] Starting extraction for file:', filePath)
    const patterns = await this.extract(provider, messages, mindmapSummary)
    if (patterns.length === 0) {
      logger.info('[MemoryExtractor] No patterns extracted, skipping persist')
      return
    }
    logger.info(
      `[MemoryExtractor] Extracted ${patterns.length} pattern(s):`,
      patterns.map((p) => `${p.discipline}-${p.subTag}`),
    )

    await Promise.all([this.persist(patterns), this.updateMindlaneTags(filePath, patterns)])
    logger.info('[MemoryExtractor] Persist and tag update completed')
  }

  /** Call LLM to extract thinking patterns from conversation. */
  private async extract(
    provider: LLMProvider,
    messages: ChatMessage[],
    mindmapSummary: string,
  ): Promise<ExtractedPattern[]> {
    const prompt = this.buildExtractionPrompt(messages, mindmapSummary)
    const response = await provider.reasoningModel.invoke([new SystemMessage(prompt)])
    return this.parseExtractionResponse(response.content)
  }

  /** Persist extracted patterns to memory files and rebuild index once. */
  async persist(patterns: ExtractedPattern[]): Promise<void> {
    for (const p of patterns) {
      const tag = `${p.discipline}-${p.subTag}`
      await this.manager.writeMemory(tag, p.description, p.observation, { skipIndexRebuild: true })
    }
    await this.manager.rebuildIndex()

    if (await this.manager.shouldConsolidate()) {
      await this.manager.consolidate()
    }
  }

  /** Update .mindlane file metadata.tags with discovered disciplines. */
  private async updateMindlaneTags(filePath: string, patterns: ExtractedPattern[]): Promise<void> {
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8')
      const data = JSON.parse(raw) as MindLaneFile
      const existing = new Set(data.metadata.tags || [])
      const originalSize = existing.size
      for (const p of patterns) {
        existing.add(p.discipline)
      }
      if (existing.size === originalSize) {
        logger.info('[MemoryExtractor] No new tags to add, skipping .mindlane rewrite')
        return
      }
      data.metadata.tags = Array.from(existing)
      data.metadata.updatedAt = new Date().toISOString()
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
      logger.info(
        '[MemoryExtractor] Updated .mindlane tags:',
        Array.from(existing),
        'file:',
        filePath,
      )
    } catch (e) {
      logger.warn('[MemoryExtractor] Failed to update .mindlane tags:', e, 'file:', filePath)
    }
  }

  private buildExtractionPrompt(messages: ChatMessage[], mindmapSummary: string): string {
    // Limit to last 20 exchanges to avoid unbounded prompt size
    const recentMessages = messages.slice(-40)
    const conversation = recentMessages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        const role = m.role === 'user' ? '用户' : 'AI'
        return `${role}: ${m.content}`
      })
      .join('\n')

    return `你是一位认知模式分析师。请分析以下对话和思维导图内容，识别用户的思维模式与偏好。

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
- description 是一行摘要（30字以内）
- observation 是详细描述（包含具体证据和观察）
- evidence 是对话中支持该观察的具体原文引用

对话内容：
${conversation}

思维导图摘要：
${mindmapSummary || '（无）'}

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
      logger.warn('[MemoryExtractor] Failed to parse LLM response:', e, 'raw:', text.slice(0, 500))
      return []
    }
  }
}
