import type { ChatContext } from '../../../ipc.js'
import { MemoryManager } from '../../memory/memoryManager.js'
import { xmlNodeTypeRegistry } from '../../../../src/shared/lib/mindmapXml/registry.js'

const MEMORY_TAG = 'MEMORY'

// 系统提示只包含跨轮次逐字节稳定的前缀：记忆段 + 核心规则 + 环境策略 + `## 历史摘要`。
// 易变编辑器状态（选中节点、附件、文件身份）不进 system prompt，改由主进程序列化为
// `<EDITOR_STATE>` 块附加到用户消息末尾（轮次状态），保住前缀缓存命中。

export interface CapabilityFlags {
  hasPalace: boolean
}

/**
 * 预载记忆上下文：`MEMORY.md` 的完整内容。
 * 由 `loadMemoryContext` 一次性读盘产出，供预算估算路径复用，
 * 避免每轮估算重复读盘；supervisor 真实调用仍现读现用（新鲜优先）。
 */
export interface MemoryContext {
  memory: string
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
 * 从磁盘加载一次记忆上下文（`MEMORY.md` 全文）。
 * 无记忆管理器时返回 undefined。
 */
export async function loadMemoryContext(
  memoryManager: MemoryManager | undefined,
): Promise<MemoryContext | undefined> {
  if (!memoryManager) return undefined
  const memory = await memoryManager.loadMemory()
  return { memory }
}

/**
 * 构建监督器的 system message 全文（系统提示）。
 *
 * 调用方只提供输入，从不编排段落；段落顺序固定：
 * 记忆 → SYSTEM_PROMPT → ENV。
 * 易变编辑器状态不在此处渲染（见文件顶部注释）。
 * 新增或调整段落只有一个入口。
 */
export async function buildSystemPrompt(input: SystemPromptInput): Promise<string> {
  const parts: string[] = []

  const memorySection = await buildMemorySection(input)
  if (memorySection) parts.push(memorySection)

  parts.push(buildCorePrompt(input.capabilityFlags, input.lastSummary))
  parts.push(buildMindmapXmlContract())
  parts.push(buildEnvironmentPrompt())

  return parts.join('').trim()
}

/**
 * 记忆段：`<MEMORY>`（内容非空时）。
 * `memory` 预载优先于 `memoryManager` 加载。
 */
async function buildMemorySection(input: SystemPromptInput): Promise<string> {
  let memory: string

  if (input.memory) {
    memory = input.memory.memory
  } else if (input.memoryManager) {
    const loaded = await loadMemoryContext(input.memoryManager)
    if (!loaded) return ''
    memory = loaded.memory
  } else {
    return ''
  }

  if (!memory.trim()) return ''
  return `<${MEMORY_TAG}>\n${memory.trim()}\n</${MEMORY_TAG}>\n`
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
当用户需要从文档、URL 或文本生成思维导图时，先调用 generateMindmapFragment；工具返回 XML 片段后，再根据当前思维导图上下文调用 insertXmlFragment 选择插入位置。
当用户需要生成记忆宫殿时，先调用 generatePalace；工具返回宫殿数据后，再根据当前思维导图上下文调用 insertXmlFragment 插入 palace 节点。
generateMindmapFragment 和 generatePalace 的结果是待落图数据，不要直接复制给用户。
`

  if (lastSummary) {
    prompt += `\n## 历史摘要\n${lastSummary}\n`
  }

  prompt += `</SYSTEM_PROMPT>
`
  return prompt
}

/**
 * 导图 XML 契约段（PRD 6.5 / issue 06）：注册表描述注入稳定前缀。
 *
 * 内容完全由代码定义（xmlNodeTypeRegistry），跨轮次逐字节稳定，不破坏前缀缓存命中；
 * 新增节点类型只需注册条目，提示词段落自动更新，无需手写。
 */
export function buildMindmapXmlContract(): string {
  return `<MINDLANE_XML_CONTRACT>
## 导图 XML 契约

- 节点：<node id="…" type="text|image|…" content="内容" [collapsed="true"]>
- type 必填；未知类型报 invalid_type。
- 子树：<node> 内嵌套 <node> 即父子；同级多个 <node> 为兄弟；顶层多个 = 批量插入。
- 纯树：不允许出现环或多父；root 不可创建/删除/移动。
- content 是纯文本；含 " < > & 时用实体 &quot; &lt; &gt; &amp;。
- 图片：<node type="image" asset="a1" … />，asset 必须来自上下文（readMindmap 输出）。
- id：创建新节点时禁止编写 id；引用节点必须使用 readMindmap 提供的 id。
- 定位：insertXmlFragment 的 position 用 child（挂子节点）或 after/before（兄弟）。

### 节点类型注册表
${xmlNodeTypeRegistry.describeAll()}

## 失败恢复

- block_not_found: 重新调用 readMindmap 定位后再操作。
- xml_parse_error / text_unescaped: 修正 XML 后重试。
- invalid_type / asset_not_found: 按错误信息改用注册类型/引用。
- tree_invalid: 修正为纯树（去重 id、避开 root、目标不得在被移子树内）。
</MINDLANE_XML_CONTRACT>
`
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
