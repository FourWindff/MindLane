import type { ChatContext } from '../../../ipc.js'
import { MemoryManager } from '../../memory/memoryManager.js'

const MEMORY_INDEX_TAG = 'USER_MEMORY_INDEX'
const RELEVANT_MEMORIES_TAG = 'RELEVANT_MEMORIES'

export interface CapabilityFlags {
  hasPalace: boolean
}

/**
 * 预载记忆上下文：索引 + 按文件标签命中的相关记忆。
 * 由 `loadMemoryContext` 一次性读盘产出，供预算估算路径复用，
 * 避免每轮估算重复读盘；supervisor 真实调用仍现读现用（新鲜优先）。
 */
export interface MemoryContext {
  index: string
  memories: string[]
}

export interface SystemPromptInput {
  context?: ChatContext
  capabilityFlags?: CapabilityFlags
  memoryManager?: MemoryManager
  lastSummary?: string
  /** 预载记忆：提供时跳过 `memoryManager` 的磁盘加载。 */
  memory?: MemoryContext
}

/**
 * 从磁盘加载一次记忆上下文（索引 + 相关记忆）。
 * 无记忆管理器时返回 undefined。
 */
export async function loadMemoryContext(
  context: ChatContext | undefined,
  memoryManager: MemoryManager | undefined,
): Promise<MemoryContext | undefined> {
  if (!memoryManager) return undefined
  const tags = context?.fileTags
  const [index, memories] = await Promise.all([
    memoryManager.loadIndex(),
    tags?.length ? memoryManager.loadMemoriesForTags(tags) : Promise.resolve([] as string[]),
  ])
  return { index, memories }
}

/**
 * 构建监督器的 system message 全文（系统提示）。
 *
 * 调用方只提供输入，从不编排段落；段落顺序固定：
 * 记忆 → SYSTEM_PROMPT → ENV → MINDMAP/附件。
 * 新增或调整段落只有一个入口。
 */
export async function buildSystemPrompt(input: SystemPromptInput): Promise<string> {
  const parts: string[] = []

  const memorySection = await buildMemorySection(input)
  if (memorySection) parts.push(memorySection)

  parts.push(buildCorePrompt(input.capabilityFlags, input.lastSummary))
  parts.push(buildEnvironmentPrompt())

  const mindmapSection = buildMindmapContext(input.context)
  if (mindmapSection) parts.push(mindmapSection)

  return parts.join('').trim()
}

/**
 * 记忆段：`USER_MEMORY_INDEX`（索引非空时）+ `RELEVANT_MEMORIES`（命中且带 tags 时）。
 * `memory` 预载优先于 `memoryManager` 加载。
 */
async function buildMemorySection(input: SystemPromptInput): Promise<string> {
  const tags = input.context?.fileTags

  let index: string
  let memories: string[]

  if (input.memory) {
    index = input.memory.index
    memories = input.memory.memories
  } else if (input.memoryManager) {
    const loaded = await loadMemoryContext(input.context, input.memoryManager)
    if (!loaded) return ''
    index = loaded.index
    memories = loaded.memories
  } else {
    return ''
  }

  let section = ''
  if (index.trim()) {
    section += `<${MEMORY_INDEX_TAG}>\n${index.trim()}\n</${MEMORY_INDEX_TAG}>\n`
  }
  if (memories.length > 0 && tags) {
    section += `<${RELEVANT_MEMORIES_TAG} tags="${tags.join(',')}">\n${memories.join('\n\n')}\n</${RELEVANT_MEMORIES_TAG}>\n`
  }
  return section
}

function buildCorePrompt(
  capabilityFlags: CapabilityFlags | undefined,
  lastSummary: string | undefined,
): string {
  const flags = capabilityFlags ?? { hasPalace: true }
  const features = ['思维导图创作']
  if (flags.hasPalace) {
    features.push('记忆训练')
  }

  let prompt = `<SYSTEM_PROMPT>
你是 MindLane 的 AI 助手，帮助用户进行${features.join('、')}。
当用户需要从文档、URL 或文本生成思维导图时，先调用 generateMindmapFragment；工具返回 YAML 后，再根据当前思维导图上下文调用 batchAddMindmapNodes 选择插入位置。
当用户需要生成记忆宫殿时，先调用 generatePalace；工具返回宫殿数据后，再根据当前思维导图上下文调用 addPalaceNode 选择插入位置。
generateMindmapFragment 和 generatePalace 的结果是待落图数据，不要直接复制给用户。
`

  if (lastSummary) {
    prompt += `\n## 历史摘要\n${lastSummary}\n`
  }

  prompt += `</SYSTEM_PROMPT>
`
  return prompt
}

function buildEnvironmentPrompt(): string {
  const platform = process.platform
  const isWindows = platform === 'win32'
  const runtime = isWindows ? `Windows` : platform === 'darwin' ? `macOS` : `Linux`

  const platformPolicy = isWindows
    ? `## Platform Policy (Windows)
- You are running on Windows. Do not assume GNU tools like \`grep\`, \`sed\`, or \`awk\` exist.
- Prefer Windows-native commands or file tools when they are more reliable.`
    : `## Platform Policy (POSIX)
- You are running on a POSIX system (macOS/Linux). Prefer UTF-8 and standard shell tools.`

  return `<ENV>
# runtime: ${runtime}
# platform_policy: ${platformPolicy}
</ENV>
`
}

function buildMindmapContext(context: ChatContext | undefined): string {
  if (!context) return ''

  let section = ''

  if (context.hasDocumentOpen) {
    section += `<MINDMAP file_path="${context.filePath || ''}">
# ${context.fileTitle || '未命名思维导图'}
`

    if (context.mindmapSummary) {
      section += `${context.mindmapSummary}\n`
    }

    if (context.selectedNodes && context.selectedNodes.length > 0) {
      section += `<SELECTED_NODES count="${context.selectedNodes.length}">\n`
      for (const node of context.selectedNodes) {
        section += `  <node id="${node.id}" type="${node.type}" label="${node.label || ''}"/>\n`
      }
      section += `</SELECTED_NODES>\n`
    }

    section += `</MINDMAP>
`
  }

  if (context.attachedDocument) {
    const doc = context.attachedDocument
    section += `<ATTACHED_DOCUMENT type="${doc.type}" filename="${doc.filename}" path="${doc.source}">
用户已附加文档「${doc.filename}」，请根据此文档内容生成思维导图。
</ATTACHED_DOCUMENT>
`
  }

  if (context.linkedDocuments && context.linkedDocuments.length > 0) {
    section += `<LINKED_DOCUMENTS count="${context.linkedDocuments.length}">
`
    for (const doc of context.linkedDocuments) {
      const textCacheKey = doc.id
      section += `  <document id="${doc.id}" type="${doc.type}" filename="${doc.filename}" text_cache_key="${textCacheKey}"/>
`
    }
    section += `</LINKED_DOCUMENTS>
`
  }

  return section
}
