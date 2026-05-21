import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'
import { LeafTaskSchema, MergeTaskSchema, TreeSchema } from './schemas.js'
import { serializeMindmapForestOutline, serializeMindmapOutline } from '../../../utils/yamlMindmap.js'
import type {
  ChatModelLike,
  DocumentMeta,
  LoggerLike,
  MergeGroup,
  MindmapYamlNode,
  PdfChunk,
  WorkflowError,
} from './types.js'
import {
  derivePageRange,
  fallbackLeafNode,
  fallbackMergeNode,
  parseLeafBatchText,
} from './utils.js'
import {
  extractYaml,
  formatPageRange,
  normalizeTree,
  responseToText,
  sanitizeTreeCandidate,
  withRetries,
} from '../../../utils/yamlMindmap.js'

export class LeafExtractAgent {
  constructor(
    private model: ChatModelLike,
    private logger: LoggerLike,
  ) {}

  async invoke(
    state: z.infer<typeof LeafTaskSchema>,
  ): Promise<Array<{
    tree: MindmapYamlNode
    ok: boolean
    error?: WorkflowError
    chunkIndex: number
    chunkId: string
  }>> {
    const { chunks, document } = LeafTaskSchema.parse(state)
    const firstChunk = chunks[0]!
    const lastChunk = chunks[chunks.length - 1]!
    const batchPrefix = `[leaf batch ${firstChunk.index + 1}-${lastChunk.index + 1}]`

    await this.logger.info(`${batchPrefix} 提炼 ${chunks.length} 个 chunk`)
    for (const chunk of chunks) {
      const range = formatPageRange(chunk.startPage, chunk.endPage)
      await this.logger.info(
        `${prefixForChunk(chunk)} 输入 chunk p${range}（${chunk.text.length} chars）`,
      )
    }

    try {
      const resultMap = await withRetries(
        async () => this.extractTrees(document, chunks),
        2,
      )

      return Promise.all(chunks.map(async (chunk) => {
        const tree = resultMap.get(chunk.id)
        if (!tree) {
          const degradedTree = fallbackLeafNode(chunk)
          return {
            tree: degradedTree,
            ok: false,
            chunkIndex: chunk.index,
            chunkId: chunk.id,
            error: {
              stage: 'leaf' as const,
              message: `chunk ${chunk.index + 1} missing from batch result`,
            },
          }
        }

        await this.logger.info(
          `${prefixForChunk(chunk)} YAML 输出:\n${serializeMindmapOutline(tree)}`,
        )

        return {
          tree,
          ok: true,
          chunkIndex: chunk.index,
          chunkId: chunk.id,
        }
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.logger.warn(`${batchPrefix} 解析失败，批量使用降级节点：${message}`)
      return Promise.all(chunks.map(async (chunk) => {
        const degradedTree = fallbackLeafNode(chunk)
        await this.logger.warn(
          `${prefixForChunk(chunk)} 降级 YAML 输出:\n${serializeMindmapOutline(degradedTree)}`,
        )
        return {
          tree: degradedTree,
          ok: false,
          chunkIndex: chunk.index,
          chunkId: chunk.id,
          error: {
            stage: 'leaf' as const,
            message: `chunk ${chunk.index + 1} failed`,
            detail: message,
          },
        }
      }))
    }
  }

  private async extractTrees(
    document: DocumentMeta,
    chunks: PdfChunk[],
  ): Promise<Map<string, MindmapYamlNode>> {
    const firstChunk = chunks[0]!
    const lastChunk = chunks[chunks.length - 1]!
    const range = formatPageRange(firstChunk.startPage, lastChunk.endPage)
    const messages = [
      new SystemMessage(
        [
          '你是一个严谨的知识结构提炼助手。',
          '请根据用户给出的多个 PDF 文本块，分别提炼出对应的局部思维导图。',
          '只输出 YAML，不要 JSON，不要 Markdown 解释，不要额外前后缀。',
          '你输出的是思维导图中的层级节点关系，不是文章目录，也不要求每一层都是"主题标题"。',
          '节点可以是概念、事实、方法、步骤、约束、案例、结论、现象或具体内容，只要能真实表达上下级包含关系即可。',
          '输出格式：',
          'results:',
          ' - chunk_id: chunk-1',
          '   mindmap:',
          '    智能体构建要素:',
          '     - 模型选择:',
          '      - 上下文窗口影响任务切分',
          '     - 工具调用失败需要重试',
          ' - chunk_id: chunk-2',
          '   mindmap:',
          '    另一段核心内容:',
          '     - 关键事实',
          '要求：',
          '- 顶层必须输出 results 列表',
          '- 每个输入 chunk 都必须返回一个 results 项，且 chunk_id 必须与输入完全一致',
          '- 每个 results 项里必须包含 mindmap 字段',
          '- 每棵 mindmap 顶层只能有 1 个根节点',
          '- 有子节点的节点使用"节点内容:"',
          '- 子节点必须使用"- 节点内容"开头',
          '- 没有子节点的叶子节点不要再写 children、label、page_range 之类字段',
          '- 不要输出页码、括号页码、page_range 字段或任何来源定位信息',
          '- 只能使用空格缩进，绝对不要使用 Tab',
          '- 根节点顶格写，不要在前面加 -',
          '- 缩进规则只有一条：每下降一级，就在上一层前缀基础上只多 1 个前导空格，然后接"- "',
          '- 缩进示例必须严格写成：根节点"根内容:"，二级" - 节点内容"，三级"  - 节点内容"',
          '- 冒号后面不要再写同一行内容；有子节点就换行后继续缩进',
          '- 不要为了凑格式把节点写成"一级主题、二级主题、三级主题"这类空泛词',
          '- 节点内容优先保留真实信息，而不是标题化改写',
          '- 各 chunk 分开提炼，不要跨 chunk 合并，不要遗漏任何 chunk',
          '- 每棵 mindmap 仅保留 2-3 层结构',
          '- 每层最多 8 个子节点',
          `- 本轮输入总覆盖页段 ${range}`,
        ].join('\n'),
      ),
      new HumanMessage(
        [
          `文档标题：${document.title}`,
          `本轮输入页码：${range}`,
          '请按以下 chunk 顺序逐个输出结果：',
          ...chunks.flatMap((chunk) => [
            `chunk_id: ${chunk.id}`,
            `page_range: ${formatPageRange(chunk.startPage, chunk.endPage)}`,
            'content:',
            chunk.text,
            '',
          ]),
        ].join('\n\n'),
      ),
    ]

    const response = await this.model.invoke(messages)
    const text = responseToText(response)
    await this.logger.debug(`${prefixForChunkGroup(chunks)} 原始 YAML 响应:\n${text.trim()}`)
    const parsed = parseLeafBatchText(text)
    const resultMap = new Map<string, MindmapYamlNode>()

    const chunkRangeMap = new Map(
      chunks.map((chunk) => [chunk.id, formatPageRange(chunk.startPage, chunk.endPage)]),
    )

    for (const item of parsed.results) {
      if (!item.mindmap) continue
      const tree = TreeSchema.parse(sanitizeTreeCandidate(item.mindmap))
      const chunkRange = chunkRangeMap.get(item.chunk_id) ?? ''
      resultMap.set(item.chunk_id, normalizeTree(tree, chunkRange))
    }

    return resultMap
  }
}

export class MergeAgent {
  constructor(
    private model: ChatModelLike,
    private logger: LoggerLike,
  ) {}

  async invoke(
    state: z.infer<typeof MergeTaskSchema>,
  ): Promise<{
    tree: MindmapYamlNode
    error?: WorkflowError
    groupIndex: number
  }> {
    const { group, round, document } = MergeTaskSchema.parse(state)
    const prefix = `[merge r${round} g${group.groupIndex + 1}]`

    await this.logger.info(
      `${prefix} 合并 ${group.trees.length} 棵子树`,
    )

    try {
      const tree = await withRetries(
        async () => this.mergeTrees(document, group, round),
        2,
      )
      await this.logger.info(
        `${prefix} YAML 输出:\n${serializeMindmapOutline(tree)}`,
      )

      return {
        tree,
        groupIndex: group.groupIndex,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const degradedTree = fallbackMergeNode(group.trees, document.title)
      await this.logger.warn(`${prefix} 合并失败，使用包裹型节点：${message}`)
      await this.logger.warn(
        `${prefix} 降级 YAML 输出:\n${serializeMindmapOutline(degradedTree)}`,
      )
      return {
        tree: degradedTree,
        groupIndex: group.groupIndex,
        error: {
          stage: 'merge',
          message: `merge group ${group.groupIndex + 1} failed`,
          detail: message,
        },
      }
    }
  }

  private async mergeTrees(
    document: DocumentMeta,
    group: MergeGroup,
    round: number,
  ): Promise<MindmapYamlNode> {
    const inputRange = derivePageRange(group.trees)
    const messages = [
      new SystemMessage(
        [
          '你是一个结构合并助手。',
          '请把多棵局部知识树合并成一棵更高层的树，输出严格 YAML 脑图大纲。',
          '只输出 YAML，不要 JSON，不要 Markdown 解释，不要额外前后缀。',
          '不要记录页码，不要在标题后添加 [p1-10] 之类标记。',
          '你输出的是思维导图中的层级节点关系，不是文章目录，也不要求每一层都是"主题标题"。',
          '节点可以是概念、事实、方法、步骤、约束、案例、结论、现象或具体内容，只要能真实表达上下级包含关系即可。',
          '输出结构示例：',
          '智能体系统设计:',
          ' - 推理与规划:',
          '  - 长链路任务需要拆分执行',
          ' - 工具与记忆协同',
          '要求：',
          '- 顶层只能有 1 个根节点',
          '- 有子节点的节点使用"节点内容:"',
          '- 子节点必须使用"- 节点内容"开头',
          '- 没有子节点的叶子节点不要再写 children、label、page_range 之类字段',
          '- 不要输出页码、括号页码、page_range 字段或任何来源定位信息',
          '- 只能使用空格缩进，绝对不要使用 Tab',
          '- 根节点顶格写，不要在前面加 -',
          '- 缩进规则只有一条：每下降一级，就在上一层前缀基础上只多 1 个前导空格，然后接"- "',
          '- 缩进示例必须严格写成：根节点"根内容:"，二级" - 节点内容"，三级"  - 节点内容"',
          '- 冒号后面不要再写同一行内容；有子节点就换行后继续缩进',
          '- 不要为了凑格式把节点写成"一级主题、二级主题、三级主题"这类空泛词',
          '- 节点内容优先保留真实信息，而不是标题化改写',
          '- 可以重命名父节点，但不能丢失关键主题',
          '- 合并重复主题，保持层次清晰',
          `- 根节点需要概括输入树覆盖范围 ${inputRange} 的共同内容`,
        ].join('\n'),
      ),
      new HumanMessage(
        [
          `文档标题：${document.title}`,
          `当前轮次：${round}`,
          `输入覆盖页段：${inputRange}`,
          '待合并 YAML：',
          serializeMindmapForestOutline(group.trees),
        ].join('\n\n'),
      ),
    ]

    const response = await this.model.invoke(messages)
    const text = responseToText(response)
    await this.logger.debug(`${prefixForMerge(round, group.groupIndex)} 原始 YAML 响应:\n${text.trim()}`)
    const parsed = TreeSchema.parse(sanitizeTreeCandidate(extractYaml(text)))
    return normalizeTree(parsed, inputRange)
  }
}

function prefixForChunk(chunk: PdfChunk): string {
  return `[leaf ${chunk.index + 1}]`
}

function prefixForChunkGroup(chunks: PdfChunk[]): string {
  const firstChunk = chunks[0]!
  const lastChunk = chunks[chunks.length - 1]!
  return `[leaf batch ${firstChunk.index + 1}-${lastChunk.index + 1}]`
}

function prefixForMerge(round: number, groupIndex: number): string {
  return `[merge r${round} g${groupIndex + 1}]`
}
