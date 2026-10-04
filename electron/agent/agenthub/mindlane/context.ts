import type { ChatContext } from '../../../ipc.js'
import { MemoryManager } from '../../memory/memoryManager.js'
import { xmlNodeTypeRegistry } from '../../../../contracts/mindmapXml/registry.js'

const MEMORY_TAG = 'MEMORY'

// The system prompt holds only the byte-stable prefix shared across turns: memory section + core
// rules + environment policy + `## History Summary`. Volatile editor state (selected nodes,
// attachments, file identity) never enters the system prompt; the main process serializes it into
// an `<EDITOR_STATE>` block appended to the last user message (turn state) to preserve prefix-cache hits.

/**
 * Preloaded memory context: the full contents of `MEMORY.md`.
 * Produced by a single `loadMemoryContext` disk read so the budget-estimation path can reuse it
 * instead of re-reading the disk every turn; real supervisor calls still read on demand (freshness first).
 */
interface MemoryContext {
  memory: string
}

export interface SystemPromptInput {
  context?: ChatContext
  memoryManager?: MemoryManager
  lastSummary?: string
  /** Preloaded memory: when provided, skips the `memoryManager` disk load. */
  memory?: MemoryContext
}

/**
 * Load the memory context (`MEMORY.md` full text) from disk once.
 * Returns undefined when there is no memory manager.
 */
export async function loadMemoryContext(
  memoryManager: MemoryManager | undefined,
): Promise<MemoryContext | undefined> {
  if (!memoryManager) return undefined
  const memory = await memoryManager.loadMemory()
  return { memory }
}

/**
 * Build the supervisor's full system message (the system prompt).
 *
 * Callers only supply input, never compose sections; the section order is fixed:
 * memory → SYSTEM_PROMPT → ENV.
 * Volatile editor state is not rendered here (see the file header comment).
 * There is a single entry point for adding or adjusting sections.
 */
export async function buildSystemPrompt(input: SystemPromptInput): Promise<string> {
  const parts: string[] = []

  const memorySection = await buildMemorySection(input)
  if (memorySection) parts.push(memorySection)

  parts.push(buildCorePrompt(input.lastSummary))
  parts.push(buildMindmapXmlContract())
  parts.push(buildEnvironmentPrompt())

  return parts.join('').trim()
}

/**
 * Memory section: `<MEMORY>` (only when the content is non-empty).
 * A preloaded `memory` takes precedence over loading through `memoryManager`.
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

function buildCorePrompt(lastSummary: string | undefined): string {
  const features = ['mindmap authoring', 'memory training']

  let prompt = `<SYSTEM_PROMPT>
You are MindLane's AI assistant, helping users with ${features.join(' and ')}.
When the user needs a mindmap, whether to call generateMindmapFragment first is decided by that tool's description (write short content as XML yourself; only documents or long text go through it). After the call the tool returns an XML fragment, and you then call insertXmlFragment to choose the insertion position based on the current mindmap context.
When the user needs a memory palace, call generatePalace; the system places the palace automatically at the level of the selected nodes (you do not need to call insertXmlFragment to place it, and do not repeat station data back to the user).
The results of generateMindmapFragment and generatePalace are data waiting to be placed into the map, so do not copy them directly to the user.
`

  if (lastSummary) {
    prompt += `\n## History Summary\n${lastSummary}\n`
  }

  prompt += `</SYSTEM_PROMPT>
`
  return prompt
}

/**
 * Mindmap XML contract section (PRD 6.5 / issue 06): the registry description joins the stable prefix.
 *
 * The content is entirely code-defined (xmlNodeTypeRegistry) and byte-stable across turns, so it
 * does not break prefix-cache hits; new node types only need a registry entry, and this prompt
 * section updates itself with no hand-written text.
 */
function buildMindmapXmlContract(): string {
  return `<MINDLANE_XML_CONTRACT>
## Mindmap XML Contract

- Node: <node id="…" type="text|image|…" content="content" [collapsed="true"]>
- type is required; an unknown type reports invalid_type.
- Subtree: nesting a <node> inside a <node> means parent-child; multiple <node>s at the same level are siblings; multiple at the top level = batch insert.
- Pure tree: no cycles or multiple parents; root cannot be created/deleted/moved.
- content is plain text; when it contains " < > & use the entities &quot; &lt; &gt; &amp;.
- Images: <node type="image" asset="a1" … />, asset must come from context (readMindmap output).
- id: never write an id when creating new nodes; referencing a node requires the id provided by readMindmap.
- Positioning: insertXmlFragment's position uses child (attach to a parent) or after/before (siblings).

### Node Type Registry
${xmlNodeTypeRegistry.describeAll()}

## Failure Recovery

- block_not_found: call readMindmap again to locate before operating.
- xml_parse_error / text_unescaped: fix the XML and retry.
- invalid_type / asset_not_found: switch to a registered type/reference as the error message says.
- tree_invalid: fix into a pure tree (dedupe ids, avoid root, and the target must not be inside the moved subtree).
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
